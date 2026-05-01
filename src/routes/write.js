/**
 * Control endpoints. All POST, body is JSON.
 *
 * Time slots accept { "start": "HH:MM", "end": "HH:MM" }.
 * The inverter stores times as BCD integers: "14:30" → 1430.
 *
 * Holding register addresses (writable):
 *   20  ENABLE_CHARGE_TARGET     96  ENABLE_CHARGE
 *   27  BATTERY_POWER_MODE       59  ENABLE_DISCHARGE
 *   31  CHARGE_SLOT_2_START      56  DISCHARGE_SLOT_1_START
 *   32  CHARGE_SLOT_2_END        57  DISCHARGE_SLOT_1_END
 *   44  DISCHARGE_SLOT_2_START   94  CHARGE_SLOT_1_START
 *   45  DISCHARGE_SLOT_2_END     95  CHARGE_SLOT_1_END
 *   50  ACTIVE_POWER_RATE       110  BATTERY_SOC_RESERVE
 *  111  BATTERY_CHARGE_LIMIT    112  BATTERY_DISCHARGE_LIMIT
 *  114  BATTERY_DISCHARGE_MIN_POWER_RESERVE
 *  116  CHARGE_TARGET_SOC       163  REBOOT_INVERTER
 *  35-40  SYSTEM_TIME_YEAR/MONTH/DAY/HOUR/MINUTE/SECOND
 */

import { Router } from 'express';
import { writeHoldingRegister } from '../modbus/client.js';

const router = Router();

function timeToBcd(str) {
  const [hh, mm] = str.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) throw new Error(`Invalid time format: "${str}". Expected "HH:MM"`);
  return hh * 100 + mm;
}

function ok(res, msg) { res.json({ result: msg }); }
function err(res, e) { res.status(500).json({ error: e.message }); }

async function writeOne(reg, val, res, successMsg) {
  try {
    await writeHoldingRegister(reg, val);
    ok(res, successMsg);
  } catch (e) {
    err(res, e);
  }
}

// --- Charge target ---

router.post('/enableChargeTarget', async (req, res) => {
  const { state } = req.body || {};
  try {
    if (state === 'enable') {
      await writeHoldingRegister(20, 1);
    } else if (state === 'disable') {
      await writeHoldingRegister(20, 0);
      await writeHoldingRegister(116, 100);
    } else {
      return res.status(400).json({ error: 'Body must be { "state": "enable" | "disable" }' });
    }
    ok(res, `Charge target ${state}d`);
  } catch (e) { err(res, e); }
});

router.post('/setChargeTarget', async (req, res) => {
  const target = parseInt((req.body || {}).chargeToPercent);
  if (isNaN(target) || target < 4 || target > 100) {
    return res.status(400).json({ error: 'chargeToPercent must be 4–100' });
  }
  try {
    if (target === 100) {
      await writeHoldingRegister(20, 0);
      await writeHoldingRegister(116, 100);
    } else {
      await writeHoldingRegister(20, 1);
      await writeHoldingRegister(116, target);
    }
    ok(res, `Charge target set to ${target}%`);
  } catch (e) { err(res, e); }
});

// --- Charge / discharge enable ---

router.post('/enableChargeSchedule', async (req, res) => {
  const { state } = req.body || {};
  if (state === 'enable') return writeOne(96, 1, res, 'Charge enabled');
  if (state === 'disable') return writeOne(96, 0, res, 'Charge disabled');
  res.status(400).json({ error: 'Body must be { "state": "enable" | "disable" }' });
});

router.post('/enableDischargeSchedule', async (req, res) => {
  const { state } = req.body || {};
  if (state === 'enable') return writeOne(59, 1, res, 'Discharge enabled');
  if (state === 'disable') return writeOne(59, 0, res, 'Discharge disabled');
  res.status(400).json({ error: 'Body must be { "state": "enable" | "disable" }' });
});

// --- Charge/discharge slots ---

router.post('/setChargeSlot1', async (req, res) => {
  try {
    const { start, end } = req.body || {};
    await writeHoldingRegister(94, timeToBcd(start));
    await writeHoldingRegister(95, timeToBcd(end));
    ok(res, 'Charge slot 1 set');
  } catch (e) { err(res, e); }
});

router.post('/setChargeSlot2', async (req, res) => {
  try {
    const { start, end } = req.body || {};
    await writeHoldingRegister(31, timeToBcd(start));
    await writeHoldingRegister(32, timeToBcd(end));
    ok(res, 'Charge slot 2 set');
  } catch (e) { err(res, e); }
});

router.post('/setDischargeSlot1', async (req, res) => {
  try {
    const { start, end } = req.body || {};
    await writeHoldingRegister(56, timeToBcd(start));
    await writeHoldingRegister(57, timeToBcd(end));
    ok(res, 'Discharge slot 1 set');
  } catch (e) { err(res, e); }
});

router.post('/setDischargeSlot2', async (req, res) => {
  try {
    const { start, end } = req.body || {};
    await writeHoldingRegister(44, timeToBcd(start));
    await writeHoldingRegister(45, timeToBcd(end));
    ok(res, 'Discharge slot 2 set');
  } catch (e) { err(res, e); }
});

// --- Rates and reserves ---

router.post('/setChargeRate', async (req, res) => {
  const rate = parseInt((req.body || {}).chargeRate);
  if (isNaN(rate) || rate < 0 || rate > 50) return res.status(400).json({ error: 'chargeRate must be 0–50' });
  writeOne(111, rate, res, `Charge limit set to ${rate}%`);
});

router.post('/setDischargeRate', async (req, res) => {
  const rate = parseInt((req.body || {}).dischargeRate);
  if (isNaN(rate) || rate < 0 || rate > 50) return res.status(400).json({ error: 'dischargeRate must be 0–50' });
  writeOne(112, rate, res, `Discharge limit set to ${rate}%`);
});

router.post('/setBatteryReserve', async (req, res) => {
  const val = parseInt((req.body || {}).reservePercent);
  if (isNaN(val) || val < 0 || val > 100) return res.status(400).json({ error: 'reservePercent must be 0–100' });
  writeOne(110, val, res, `Battery reserve set to ${val}%`);
});

router.post('/setPowerReserve', async (req, res) => {
  const val = parseInt((req.body || {}).reservePercent);
  if (isNaN(val) || val < 0 || val > 100) return res.status(400).json({ error: 'reservePercent must be 0–100' });
  writeOne(114, val, res, `Power reserve set to ${val}%`);
});

router.post('/setActivePowerRate', async (req, res) => {
  const val = parseInt((req.body || {}).rate);
  if (isNaN(val) || val < 0 || val > 100) return res.status(400).json({ error: 'rate must be 0–100' });
  writeOne(50, val, res, `Active power rate set to ${val}%`);
});

// --- Battery mode ---

router.post('/setBatteryMode', async (req, res) => {
  const { mode } = req.body || {};
  try {
    if (mode === 'Dynamic') {
      await writeHoldingRegister(27, 1);  // demand mode
      await writeHoldingRegister(110, 4); // shallow charge 4%
      await writeHoldingRegister(59, 0);  // disable discharge
      ok(res, 'Mode set to Dynamic');
    } else if (mode === 'Storage' || mode === 'Timed Demand') {
      await writeHoldingRegister(27, 1);  // demand mode
      await writeHoldingRegister(59, 1);  // enable discharge
      ok(res, `Mode set to ${mode}`);
    } else if (mode === 'Timed Export') {
      await writeHoldingRegister(27, 0);  // max power / export
      await writeHoldingRegister(59, 1);  // enable discharge
      ok(res, 'Mode set to Timed Export');
    } else {
      res.status(400).json({ error: 'mode must be "Dynamic", "Storage", "Timed Demand", or "Timed Export"' });
    }
  } catch (e) { err(res, e); }
});

// --- Date/time ---

router.post('/setDateTime', async (req, res) => {
  try {
    const dt = new Date((req.body || {}).datetime || Date.now());
    if (isNaN(dt.getTime())) return res.status(400).json({ error: 'Invalid datetime value' });
    await writeHoldingRegister(35, dt.getFullYear());
    await writeHoldingRegister(36, dt.getMonth() + 1);
    await writeHoldingRegister(37, dt.getDate());
    await writeHoldingRegister(38, dt.getHours());
    await writeHoldingRegister(39, dt.getMinutes());
    await writeHoldingRegister(40, dt.getSeconds());
    ok(res, `Inverter time set to ${dt.toISOString()}`);
  } catch (e) { err(res, e); }
});

// --- Force charge/export (timed, reverts on completion) ---

let forceChargeTimer = null;
let forceExportTimer = null;

router.post('/forceCharge', async (req, res) => {
  const body = req.body || {};
  if (body === 'Cancel' || body.cancel) {
    clearTimeout(forceChargeTimer);
    forceChargeTimer = null;
    try {
      await writeHoldingRegister(27, 1);
      await writeHoldingRegister(59, 0);
      ok(res, 'Force charge cancelled');
    } catch (e) { err(res, e); }
    return;
  }

  const minutes = parseInt(body.timePeriod || 60);
  try {
    await writeHoldingRegister(27, 0);  // max power
    await writeHoldingRegister(96, 1);  // enable charge
    await writeHoldingRegister(59, 0);  // disable discharge
    clearTimeout(forceChargeTimer);
    forceChargeTimer = setTimeout(async () => {
      forceChargeTimer = null;
      await writeHoldingRegister(27, 1).catch(() => {});
    }, minutes * 60 * 1000);
    ok(res, `Force charge started for ${minutes} minutes`);
  } catch (e) { err(res, e); }
});

router.post('/forceExport', async (req, res) => {
  const body = req.body || {};
  if (body === 'Cancel' || body.cancel) {
    clearTimeout(forceExportTimer);
    forceExportTimer = null;
    try {
      await writeHoldingRegister(27, 1);
      await writeHoldingRegister(59, 0);
      ok(res, 'Force export cancelled');
    } catch (e) { err(res, e); }
    return;
  }

  const minutes = parseInt(body.timePeriod || 60);
  try {
    await writeHoldingRegister(27, 0);  // max power / export
    await writeHoldingRegister(59, 1);  // enable discharge
    clearTimeout(forceExportTimer);
    forceExportTimer = setTimeout(async () => {
      forceExportTimer = null;
      await writeHoldingRegister(59, 0).catch(() => {});
    }, minutes * 60 * 1000);
    ok(res, `Force export started for ${minutes} minutes`);
  } catch (e) { err(res, e); }
});

// --- Temp pause (restores previous state after timer) ---

let pauseChargeTimer = null;
let pauseDischargeTimer = null;

router.post('/tempPauseCharge', async (req, res) => {
  const body = req.body || {};
  if (body === 'Cancel' || body.cancel) {
    clearTimeout(pauseChargeTimer);
    pauseChargeTimer = null;
    try {
      await writeHoldingRegister(96, 1);
      ok(res, 'Temp pause charge cancelled');
    } catch (e) { err(res, e); }
    return;
  }

  const minutes = parseInt(body.timePeriod || 60);
  try {
    await writeHoldingRegister(96, 0);
    clearTimeout(pauseChargeTimer);
    pauseChargeTimer = setTimeout(async () => {
      pauseChargeTimer = null;
      await writeHoldingRegister(96, 1).catch(() => {});
    }, minutes * 60 * 1000);
    ok(res, `Charge paused for ${minutes} minutes`);
  } catch (e) { err(res, e); }
});

router.post('/tempPauseDischarge', async (req, res) => {
  const body = req.body || {};
  if (body === 'Cancel' || body.cancel) {
    clearTimeout(pauseDischargeTimer);
    pauseDischargeTimer = null;
    try {
      await writeHoldingRegister(59, 1);
      ok(res, 'Temp pause discharge cancelled');
    } catch (e) { err(res, e); }
    return;
  }

  const minutes = parseInt(body.timePeriod || 60);
  try {
    await writeHoldingRegister(59, 0);
    clearTimeout(pauseDischargeTimer);
    pauseDischargeTimer = setTimeout(async () => {
      pauseDischargeTimer = null;
      await writeHoldingRegister(59, 1).catch(() => {});
    }, minutes * 60 * 1000);
    ok(res, `Discharge paused for ${minutes} minutes`);
  } catch (e) { err(res, e); }
});

// --- Reboot ---

router.get('/reboot', async (req, res) => {
  try {
    await writeHoldingRegister(163, 100);
    ok(res, 'Inverter reboot initiated');
  } catch (e) { err(res, e); }
});

export default router;
