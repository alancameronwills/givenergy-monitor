import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { fetchAllRegisters } from '../modbus/client.js';
import { buildInverterData, buildBatteryData } from '../datamodel.js';
import { findInverter, hasLanConnectivity } from '../scanner.js';
import config from '../config.js';

const ENV_PATH = resolve(fileURLToPath(new URL('../..', import.meta.url)), '.env');

function readEnv() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, 'utf8')
      .split('\n')
      .filter(l => /^\s*[A-Z_][A-Z0-9_]*=/.test(l))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

function persistHost(ip) {
  const env = readEnv();
  env.INVERTER_HOST = ip;
  writeFileSync(ENV_PATH, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 'utf8');
}

const router = Router();

let cache = null;

// Reconnect monitor state
let hasConnected = false;
let lastSuccess  = null;
let scanning     = false;
let nextScanAt   = null;
const CONTACT_TIMEOUT_MS = 20 * 60 * 1000;
const FAST_RESCAN_FAILURES = 3;   // consecutive failed reads (~3 min of polling) before a rescan

// Diagnostic state — surfaced via GET /status so the UI can tell whether a
// dropout is the Pi's own LAN/WiFi or the link to the inverter.
let consecutiveFailures = 0;
let lastLanUp           = null;   // result of the most recent connectivity check
let lastError           = null;   // { message, code, layer, at }

// On a failed read, work out which layer broke: if the Pi cannot reach its own
// default gateway the fault is local networking (WiFi); otherwise the LAN is up
// but the inverter is unreachable/unresponsive.
async function classifyFailure(err) {
  let lanUp = null;
  try { lanUp = await hasLanConnectivity(); } catch { /* leave null */ }
  lastLanUp = lanUp;
  lastError = {
    message: err.message,
    code: err.code || null,
    layer: lanUp === false ? 'wifi' : 'inverter',
    at: new Date().toISOString(),
  };
  return lastError;
}

async function doRefresh() {
  let raw;
  try {
    raw = await fetchAllRegisters(config.numBatteries);
  } catch (err) {
    consecutiveFailures++;
    await classifyFailure(err);
    throw err;
  }
  const { holdingRegisters, inputRegisters, batteries } = raw;
  hasConnected        = true;
  lastSuccess         = Date.now();
  consecutiveFailures = 0;
  lastLanUp           = true;
  lastError           = null;
  cache = {
    ...buildInverterData(holdingRegisters, inputRegisters),
    batteries: batteries.map((regs, i) => buildBatteryData(regs, i + 1)),
    last_updated: new Date().toISOString(),
  };
  return cache;
}

// The inverter handles one connection at a time and a full read is ~3s. Concurrent
// callers (the Pi's /power poll, the dashboard, the history sampler) would otherwise
// each open overlapping sockets and interfere. Share one in-flight read instead.
let inFlight = null;
export function refreshCache() {
  if (inFlight) return inFlight;
  inFlight = doRefresh().finally(() => { inFlight = null; });
  return inFlight;
}

// Last cached model without hitting the inverter — used by the history sampler
// after it awaits a serialized refreshCache().
export function getCache() {
  return cache;
}

async function runReconnectScan() {
  if (scanning) return;
  scanning = true;
  console.log('Scanning network for GivEnergy inverter...');
  try {
    const ip = await findInverter({
      onProgress: (checked, total, network) =>
        process.stdout.write(`\r  Reconnect scan: ${network} ${checked}/${total}...`),
    });
    process.stdout.write('\n');
    if (ip) {
      console.log(`Inverter found at ${ip}`);
      config.host              = ip;
      process.env.INVERTER_HOST = ip;
      persistHost(ip);
      nextScanAt          = null;
      // Confirm the corrected host with a real read so hasConnected flips true.
      // Without this, a scan that runs before we've ever connected would leave
      // hasConnected false and the monitor would keep rescanning every minute
      // until something else happened to poll the server.
      try { await refreshCache(); } catch { /* transient — next cycle retries */ }
    } else {
      console.log('Inverter not found. Will retry in 20 minutes.');
      nextScanAt = Date.now() + CONTACT_TIMEOUT_MS;
    }
  } catch (err) {
    console.error('Reconnect scan error:', err.message);
    nextScanAt = Date.now() + CONTACT_TIMEOUT_MS;
  } finally {
    scanning = false;
  }
}

setInterval(async () => {
  if (scanning) return;
  const now = Date.now();

  if (hasConnected) {
    const stale       = now - lastSuccess >= CONTACT_TIMEOUT_MS;
    const failingFast = consecutiveFailures >= FAST_RESCAN_FAILURES;
    // Rescan either when a client is actively polling and getting errors
    // (failingFast) or, as a fallback when nothing is polling, once reads have
    // been stale for 20 minutes.
    if (!stale && !failingFast) return;
  }
  // When we've never connected (hasConnected === false) the configured host may
  // simply be wrong — e.g. a failed startup scan left us on the default gateway
  // IP — so keep rescanning on the nextScanAt schedule until the inverter is
  // found, rather than staying stuck on a host that never answers.

  const lanUp = await hasLanConnectivity();
  lastLanUp = lanUp;
  if (!lanUp) {
    // Pi is off the LAN (WiFi noise/dropout) — don't scan, don't advance nextScanAt.
    // The check will retry next minute; once connectivity returns we'll scan immediately.
    return;
  }

  if (nextScanAt === null || now >= nextScanAt) {
    await runReconnectScan();
  }
}, 60_000);

router.get('/runAll', async (req, res) => {
  try {
    const data = await refreshCache();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/getData', async (req, res) => {
  try {
    await refreshCache();
    res.json({ result: 'Cache updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', (req, res) => {
  res.json({
    host: config.host,
    connected: lastError === null && lastSuccess !== null,
    hasConnected,
    scanning,
    lanUp: lastLanUp,
    // Which layer is at fault while disconnected: 'wifi' (Pi off the LAN),
    // 'inverter' (LAN up but inverter unreachable), or null when connected.
    layer: lastError ? lastError.layer : null,
    consecutiveFailures,
    lastSuccess: lastSuccess ? new Date(lastSuccess).toISOString() : null,
    secondsSinceSuccess: lastSuccess ? Math.round((Date.now() - lastSuccess) / 1000) : null,
    nextScanAt: nextScanAt ? new Date(nextScanAt).toISOString() : null,
    lastError,
  });
});

router.get('/getCache', (req, res) => {
  if (!cache) return res.status(503).json({ error: 'No data cached yet. Call /runAll or /getData first.' });
  res.json(cache);
});

router.get('/power', async (req, res) => {
  try {
    const data = await refreshCache();
    const { pv1_power_W, pv2_power_W, grid_power_W, battery_power_W, battery_soc_percent, load_power_W } = data.inverter;
    res.json({ pv1_power_W, pv2_power_W, grid_power_W, battery_power_W, battery_soc_percent, load_power_W });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/scan', async (req, res) => {
  const range = req.query.range;  // optional: ?range=192.168.2.0/24
  try {
    const ip = await findInverter({
      range,
      onProgress: (checked, total, network) =>
        process.stdout.write(`\r  /scan: ${network} ${checked}/${total}...`),
    });
    process.stdout.write('\n');
    if (!ip) return res.status(404).json({ error: 'No GivEnergy inverter found on local network' });
    config.host = ip;
    persistHost(ip);
    res.json({ host: ip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
