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

async function refreshCache() {
  const { holdingRegisters, inputRegisters, batteries } = await fetchAllRegisters(config.numBatteries);
  hasConnected = true;
  lastSuccess  = Date.now();
  cache = {
    ...buildInverterData(holdingRegisters, inputRegisters),
    batteries: batteries.map((regs, i) => buildBatteryData(regs, i + 1)),
    last_updated: new Date().toISOString(),
  };
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
      lastSuccess = Date.now();
      nextScanAt  = null;
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
  if (!hasConnected || scanning) return;
  const now = Date.now();
  if (now - lastSuccess < CONTACT_TIMEOUT_MS) return;

  if (!await hasLanConnectivity()) {
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
