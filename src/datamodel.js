/**
 * Converts raw Modbus register maps into a structured data model.
 *
 * Register type conversions mirror the Python givenergy_modbus library:
 *   BOOL      → boolean
 *   INT16     → signed int (subtract 65536 if bit 15 set) / scaling
 *   UINT32    → (highRaw << 16 | lowRaw) / scaling  (paired registers, _H and _L)
 *   ASCII     → two ASCII chars from a single 16-bit register
 *   TIME      → "HH:MM" from BCD integer (e.g. 1430 → "14:30")
 *   DUINT8    → [high byte, low byte]
 *   HEX       → "xxxx" hex string
 *   POWER_FACTOR → (value - 10000) / 10000
 *   others    → value / scaling
 */

function u16(regs, addr) { return regs[addr] ?? 0; }
function i16(regs, addr) { const v = u16(regs, addr); return v > 32767 ? v - 65536 : v; }
function u32(regs, addrH, addrL, scaling = 1) { return ((u16(regs, addrH) << 16) + u16(regs, addrL)) / scaling; }
function bool(regs, addr) { return !!u16(regs, addr); }
function deci(regs, addr) { return u16(regs, addr) / 10; }
function centi(regs, addr) { return u16(regs, addr) / 100; }
function milli(regs, addr) { return u16(regs, addr) / 1000; }
function i16deci(regs, addr) { return i16(regs, addr) / 10; }
function i16centi(regs, addr) { return i16(regs, addr) / 100; }
function ascii(regs, ...addrs) {
  return addrs.map(a => String.fromCharCode((u16(regs, a) >> 8) & 0xFF, u16(regs, a) & 0xFF)).join('');
}
function timeReg(regs, addr) {
  const v = u16(regs, addr);
  const hh = Math.floor(v / 100);
  const mm = v % 100;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const MODEL_MAP = { 2: 'Hybrid', 3: 'AC', 4: 'Hybrid', 5: 'EMS', 6: 'AC', 7: 'Gateway', 8: 'All in One' };
const PHASE_MAP = { 2: 'Single', 3: 'Single', 4: 'Three', 5: 'Single', 6: 'Three', 7: 'Single', 8: 'Single' };
const STATUS_MAP = { 0: 'Waiting', 1: 'Normal', 2: 'Warning', 3: 'Fault', 4: 'Firmware Update' };

export function buildInverterData(hr, ir) {
  const deviceTypeHex = u16(hr, 0).toString(16).padStart(4, '0');
  const dtcPrefix = parseInt(deviceTypeHex[0]);
  const dspFw = u16(hr, 19);
  const armFw = u16(hr, 21);
  const generation = armFw >= 300 ? 'Gen 3' : armFw >= 200 ? 'Gen 2' : 'Gen 1';

  const inverterSerial = ascii(hr, 13, 14, 15, 16, 17);
  const batterySerial = ascii(hr, 8, 9, 10, 11, 12);

  const pvPower = u16(ir, 18) + u16(ir, 20);
  const gridPower = i16(ir, 30);
  const battPower = i16(ir, 52);
  const loadPower = u16(ir, 42);
  const invOutPower = i16(ir, 24);

  return {
    inverter: {
      serial_number: inverterSerial.trim().replace(/\*/g, ''),
      model: MODEL_MAP[dtcPrefix] || 'Unknown',
      generation,
      phase: PHASE_MAP[dtcPrefix] || 'Unknown',
      dsp_firmware: dspFw,
      arm_firmware: armFw,
      status: u16(ir, 0),
      status_text: STATUS_MAP[u16(ir, 0)] || 'Unknown',
      system_mode: u16(ir, 49) === 1 ? 'Grid-tied' : 'Offline',

      pv1_voltage_V: deci(ir, 1),
      pv2_voltage_V: deci(ir, 2),
      pv1_current_A: centi(ir, 8),
      pv2_current_A: centi(ir, 9),
      pv1_power_W: u16(ir, 18),
      pv2_power_W: u16(ir, 20),
      solar_power_W: pvPower,

      grid_voltage_V: deci(ir, 5),
      grid_current_A: i16centi(ir, 10),
      grid_frequency_Hz: centi(ir, 13),
      grid_power_W: gridPower,

      battery_voltage_V: centi(ir, 50),
      battery_current_A: i16centi(ir, 51),
      battery_power_W: battPower,
      battery_soc_percent: u16(ir, 59),

      inverter_out_power_W: invOutPower,
      load_power_W: loadPower,

      temp_inverter_heatsink_C: i16deci(ir, 41),
      temp_charger_C: i16deci(ir, 55),
      temp_battery_C: i16deci(ir, 56),

      battery_nominal_capacity_Ah: u16(hr, 55),
      battery_type: u16(hr, 54) === 1 ? 'Lithium' : 'Lead Acid',
      first_battery_serial: batterySerial.trim().replace(/\*/g, ''),

      control: {
        enable_charge: bool(hr, 96),
        enable_discharge: bool(hr, 59),
        enable_charge_target: bool(hr, 20),
        charge_target_soc: u16(hr, 116),
        battery_reserve_percent: u16(hr, 110),
        charge_limit_percent: u16(hr, 111),
        discharge_limit_percent: u16(hr, 112),
        discharge_min_power_reserve_percent: u16(hr, 114),
        battery_power_mode: u16(hr, 27) === 0 ? 'Max Power / Export' : 'Demand / Self-consumption',
        active_power_rate_percent: u16(hr, 50),
        charge_slot_1: { start: timeReg(hr, 94), end: timeReg(hr, 95) },
        charge_slot_2: { start: timeReg(hr, 31), end: timeReg(hr, 32) },
        discharge_slot_1: { start: timeReg(hr, 56), end: timeReg(hr, 57) },
        discharge_slot_2: { start: timeReg(hr, 44), end: timeReg(hr, 45) },
      },

      energy_today: {
        pv_kWh: round(deci(ir, 17) + deci(ir, 19)),
        import_kWh: deci(ir, 26),
        export_kWh: deci(ir, 25),
        battery_charge_kWh: deci(ir, 36),
        battery_discharge_kWh: deci(ir, 37),
        inverter_out_kWh: deci(ir, 44),
        ac_charge_kWh: deci(ir, 35),
      },

      energy_total: {
        pv_kWh: round(u32(ir, 11, 12, 10)),
        import_kWh: round(u32(ir, 32, 33, 10)),
        export_kWh: round(u32(ir, 21, 22, 10)),
        battery_charge_kWh: round(deci(ir, 181)),
        battery_discharge_kWh: round(deci(ir, 180)),
        inverter_out_kWh: round(u32(ir, 45, 46, 10)),
        ac_charge_kWh: round(u32(ir, 27, 28, 10)),
        battery_throughput_kWh: round(u32(ir, 6, 7, 10)),
      },

      fault_code: (u16(ir, 39) << 16) | u16(ir, 40),
      countdown_s: u16(ir, 38),
    },
  };
}

export function buildBatteryData(regs, index) {
  return {
    index,
    serial_number: ascii(regs, 110, 111, 112, 113, 114).trim().replace(/\*/g, ''),
    soc_percent: u16(regs, 100),
    voltage_V: round(u32(regs, 82, 83, 1000)),
    full_capacity_Ah: round(u32(regs, 84, 85, 100)),
    design_capacity_Ah: round(u32(regs, 86, 87, 100)),
    remaining_capacity_Ah: round(u32(regs, 88, 89, 100)),
    num_cycles: u16(regs, 96),
    num_cells: u16(regs, 97),
    bms_firmware: u16(regs, 98),
    temp_max_C: i16deci(regs, 103),
    temp_min_C: i16deci(regs, 104),
    temp_bms_mos_C: i16deci(regs, 81),
    cell_voltages_V: Array.from({ length: 16 }, (_, i) => milli(regs, 60 + i)),
    cell_temps_C: [
      i16deci(regs, 76),
      i16deci(regs, 77),
      i16deci(regs, 78),
      i16deci(regs, 79),
    ],
    energy_charge_kWh: deci(regs, 106),
    energy_discharge_kWh: deci(regs, 105),
  };
}

function round(v, places = 2) {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
