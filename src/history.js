/**
 * History logging for the GivEnergy monitor.
 *
 * Samples the inverter on a fixed interval and persists two things with Node `fs`
 * only (no DB, no deps):
 *
 *   data/detail/YYYY-MM-DD.jsonl  — one compact JSON line per sample (local day;
 *                                   energy_today.* resets at local midnight).
 *   data/daily.json               — one running-summary entry per day (array).
 *
 * Detail files older than config.detailRetentionDays and daily entries older than
 * config.summaryRetentionDays are pruned on every sample.
 *
 * Exports: startSampler(), listDays(), readDay(date), readSummary().
 * The sampler is NOT started on import — server.js calls startSampler() after
 * app.listen so it only runs in the real server process.
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync,
  writeFileSync, appendFileSync, renameSync, unlinkSync,
} from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { refreshCache, getCache } from './routes/read.js';

const ROOT       = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR   = resolve(ROOT, config.dataDir);
const DETAIL_DIR = resolve(DATA_DIR, 'detail');
const DAILY_PATH = resolve(DATA_DIR, 'daily.json');

// --- helpers ---------------------------------------------------------------

function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// A YYYY-MM-DD string `daysBack` days before today. Because that format sorts
// lexicographically in chronological order, callers compare it as a plain string.
function cutoffDate(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return localDate(d);
}

function round(v, places = 2) {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

function ensureDirs() {
  if (!existsSync(DETAIL_DIR)) mkdirSync(DETAIL_DIR, { recursive: true });
}

// --- daily summary (in memory, mirrored to disk) ---------------------------

let daily = null;   // array, lazy-loaded

function loadDaily() {
  if (daily) return daily;
  try {
    daily = JSON.parse(readFileSync(DAILY_PATH, 'utf8'));
    if (!Array.isArray(daily)) daily = [];
  } catch {
    daily = [];   // missing or corrupt — start fresh
  }
  return daily;
}

function persistDaily() {
  const tmp = DAILY_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(daily), 'utf8');
  renameSync(tmp, DAILY_PATH);   // atomic replace so a crash can't leave a torn file
}

// Fold one sample into today's summary entry. The energy_today.* accumulators only
// rise until local midnight, so a running max is correct and survives restarts (the
// values live on the inverter, not us). Consumption comes from the energy balance.
function updateDaily(date, s) {
  loadDaily();
  let e = daily.find(d => d.date === date);
  if (!e) { e = { date }; daily.push(e); }

  e.pv_kWh        = round(Math.max(e.pv_kWh        ?? 0, s.e_pv));
  e.import_kWh    = round(Math.max(e.import_kWh    ?? 0, s.e_imp));
  e.export_kWh    = round(Math.max(e.export_kWh    ?? 0, s.e_exp));
  e.charge_kWh    = round(Math.max(e.charge_kWh    ?? 0, s.e_chg));
  e.discharge_kWh = round(Math.max(e.discharge_kWh ?? 0, s.e_dis));
  e.consumption_kWh = round(Math.max(0,
    e.pv_kWh + e.import_kWh + e.discharge_kWh - e.export_kWh - e.charge_kWh));

  e.max_soc = Math.max(e.max_soc ?? -Infinity, s.soc);
  e.min_soc = Math.min(e.min_soc ?? Infinity, s.soc);
}

// --- pruning ---------------------------------------------------------------

function prune() {
  const detailCutoff = cutoffDate(config.detailRetentionDays);
  if (existsSync(DETAIL_DIR)) {
    for (const f of readdirSync(DETAIL_DIR)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (m && m[1] < detailCutoff) {
        try { unlinkSync(resolve(DETAIL_DIR, f)); } catch { /* ignore */ }
      }
    }
  }
  const summaryCutoff = cutoffDate(config.summaryRetentionDays);
  loadDaily();
  const before = daily.length;
  daily = daily.filter(d => d.date >= summaryCutoff);
  if (daily.length !== before) persistDaily();
}

// --- sampling --------------------------------------------------------------

// Fold one full inverter cache (as built by buildInverterData) into storage: append a
// detail line, update today's summary, prune. Exported so it can be exercised
// directly (the sampler is the only caller in normal operation).
export function recordSample(cache) {
  const inv = cache.inverter;
  const et  = inv.energy_today || {};
  const s = {
    t: cache.last_updated,
    pv: inv.solar_power_W,
    grid: inv.grid_power_W,
    batt: inv.battery_power_W,
    load: inv.load_power_W,
    soc: inv.battery_soc_percent,
    status: inv.status,
    fault: inv.fault_code,
    e_pv: et.pv_kWh ?? 0,
    e_imp: et.import_kWh ?? 0,
    e_exp: et.export_kWh ?? 0,
    e_chg: et.battery_charge_kWh ?? 0,
    e_dis: et.battery_discharge_kWh ?? 0,
  };

  const date = localDate();
  ensureDirs();
  appendFileSync(resolve(DETAIL_DIR, `${date}.jsonl`), JSON.stringify(s) + '\n', 'utf8');
  updateDaily(date, s);
  persistDaily();
  prune();
}

async function sample() {
  try {
    await refreshCache();   // serialized in read.js — shares any in-flight read
  } catch {
    return;   // outage — the reconnect monitor owns recovery; skip this tick
  }
  const cache = getCache();
  if (!cache || !cache.inverter) return;
  try {
    recordSample(cache);
  } catch (err) {
    console.error('History sample error:', err.message);
  }
}

let started = false;
export function startSampler() {
  if (started) return;
  started = true;
  ensureDirs();
  loadDaily();
  // First sample shortly after startup so the dashboard has data without waiting a
  // full interval; then on the configured cadence.
  setTimeout(sample, 8000);
  setInterval(sample, config.sampleIntervalMs);
  console.log(`History sampler started (every ${config.sampleIntervalMs} ms → ${DATA_DIR})`);
}

// --- readers (used by src/routes/history.js) -------------------------------

export function listDays() {
  if (!existsSync(DETAIL_DIR)) return [];
  return readdirSync(DETAIL_DIR)
    .map(f => f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/))
    .filter(Boolean)
    .map(m => m[1])
    .sort();
}

export function readDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return [];   // reject anything non-date (path traversal)
  const path = resolve(DETAIL_DIR, `${date}.jsonl`);
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip torn/partial line */ }
  }
  return out;
}

export function readSummary() {
  return loadDaily().slice().sort((a, b) => a.date.localeCompare(b.date));
}
