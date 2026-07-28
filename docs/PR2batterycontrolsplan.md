# PR2 — Battery controls (follow-up to the read-only dashboard)

> Spec only — not yet implemented. Build this once PR1 (read-only dashboard +
> history) is merged to `main`. All register facts come from the givenergy_modbus
> map this repo mirrors and are **unverified on this specific unit** — treat first
> use of each control cautiously.

## Why timed reverts must be restart-safe
The server calls `process.exit(0)` every 24h so a process manager restarts it. Any
`setTimeout`-based auto-revert (as the current `/forceCharge`, `/forceExport`,
`/tempPause*` endpoints use) is lost on that restart, stranding the inverter in a
changed state. PR2 replaces those timers with mechanisms that survive a restart.

## The three controls

### 1. Pause charge/discharge → native Battery Pause (no server timer)
New `POST /pauseBattery` `{ mode:'charge'|'discharge'|'both'|'off', minutes }`:
- writes **HR318** = `1|2|3|0` (charge/discharge/both/off)
- for a timed pause, **HR319** = now and **HR320** = now+minutes (BCD via the existing
  `timeToBcd` in write.js)
- The **inverter** ends the pause at the slot end — no `setTimeout`, so the periodic
  restart cannot lose it. Remaining time is read back from a new additive
  `control.pause_slot`.
- `mode:'off'` (or `{cancel:true}`) clears HR318.
- The old `setTimeout` `/tempPauseCharge` / `/tempPauseDischarge` stay in place but the
  UI stops using them.

### 2. Charge/discharge-to-grid → persisted revert schedule
Native force-to-grid slots recur daily, so there's no clean one-shot native timer.
Keep `/forceCharge` / `/forceExport`'s register writes, but move the timed revert off
`setTimeout` onto a persisted, read-driven schedule:
- New module **`src/overrides.js`** (mirrors `src/kickstart.js`): record
  `{ action, revertAt }` in `data/overrides.json`.
- At the end of `doRefresh()` in read.js, once `now >= revertAt`, run the revert writes
  and clear the entry. A dedicated module keeps read.js from importing write.js (both
  import overrides.js).
- "Return to default" clears the entry and reverts immediately.

### 3. Restart battery (deep-discharge recovery) → `POST /kickstartCharge`
Persisted `idle→force_adjust→type_swap→revert` state machine (full design in
Appendix A). `kickstart.load()` at startup + `kickstart.advance(cache.inverter)` at the
end of `doRefresh()`; add `kickstart:{phase,since,targetSoc}` to `GET /status`. Guarded
UI button.

## Register plumbing PR2 needs
- **`src/modbus/client.js:92`** — extend `WRITABLE` with `318,319,320` (native pause)
  and `29,54,58` (kickstart). Per-endpoint value validation stays in the endpoints.
- **`src/modbus/client.js` `fetchAllRegisters`** — add one holding read
  `readHoldingRegisters(inverterSlave, 318, 3)` (with the 500ms spacing) merged into
  `holdingRegisters`, **wrapped so a model lacking the block fails soft** (skip, don't
  abort the refresh). HR29/54/58 are already in the fetched 0–59 batch.
- **`src/datamodel.js`** (control block, additive) — `battery_pause_mode: u16(hr,318)`,
  `pause_slot: { start: timeReg(hr,319), end: timeReg(hr,320) }`,
  `soc_force_adjust: u16(hr,29)`, `enable_auto_judge_battery_type: bool(hr,58)`.
- **`public/dashboard.html`** — enable the stubbed controls: 30m/1h/2h button groups for
  pause-charge/discharge and charge/discharge-to-grid; "Return to default"; guarded
  "Restart battery". Confirm before each action, surface JSON `result`/`error`, re-poll
  `/runAll` after, and show any active override from `/getCache`.control +
  `/status`.kickstart.

## Risks
- **Write endpoints have never run against real hardware** — this is their first use.
  `writeHoldingRegister` (client.js:91) whitelists + verifies by read-back (throws on
  mismatch), so a bad write surfaces as an error, not silent corruption. Test each
  control by curl first, watching `/getCache`.control.
- **HR318–320 / HR29·54·58 are model-dependent and unverified** — the HR318–320 read
  must fail soft; first use of each must be cautious.
- **Kickstart cannot rescue a BMS hard-cut** (cell under-voltage opens the contactor,
  pack drops off comms) — only the *soft* 0% lockout. The machine must always revert.

## Verification
- **Native pause:** `POST /pauseBattery`, confirm HR318 set + `control.pause_slot` shows
  now→now+minutes, inverter reverts at slot end, and a mid-pause server restart does
  **not** cancel it.
- **Force-to-grid:** short timer, confirm `data/overrides.json` holds revert-at, reverts
  on schedule, survives a mid-override restart, "Return to default" cancels cleanly.
- **Kickstart** (battery NOT at 0): short `maxDurationMinutes` + high `targetSoc`,
  confirm `/status`.kickstart enters `force_adjust`, then `{cancel:true}` and confirm
  HR54=Lithium, HR58 restored, HR29=0, power mode restored; restart mid-kickstart and
  confirm `kickstart.json` reloads and still reverts. Plus the no-inverter state-machine
  unit script below.

---

## Appendix A — Kickstart-charge design

### Context
When the pack discharges to a reported 0% and the lithium BMS refuses to discharge
further (the *soft* lockout — pack still online, still accepting charge), we want a
one-call way to force it back into charging. A **combined cascade**: try the gentle,
purpose-built mechanism first, escalate to the aggressive one only if the pack shows no
movement. Neither mechanism can rescue a **BMS hard-cut** (no register write reaches a
disconnected pack), so the feature must **fail safe** — revert cleanly, never strand the
inverter — rather than thrash on an offline pack.

### Confirmed register facts (from the givenergy_modbus map this repo mirrors)
- **HR 29** `SOC_FORCE_ADJUST`: `0`=Stop, `1`=Start, **`3`=Charge Only** (gentle).
- **HR 54** `BATTERY_TYPE`: `1`=Lithium, `0`=Lead Acid (aggressive: charges by voltage,
  bypassing the BMS SoC lockout).
- **HR 58** `ENABLE_AUTO_JUDGE_BATTERY_TYPE`: must be `0` during a type swap or the
  inverter re-detects and overwrites HR 54.
- Charge preamble (already writable): **HR 27** power mode (`0`=max/export), **HR 96**
  enable charge, **HR 59** enable discharge.
- Reads in `cache.inverter`: `battery_soc_percent` (IR 59), `battery_voltage_V` (IR 50).
  HR 29/54/58 sit in the already-fetched 0–59 batch.

### State machine (persisted, read-driven — survives the periodic restart)
Persisted to `kickstart.json` (same pattern as the `.env` persistence in read.js); every
successful `doRefresh()` advances it. Phases `idle → force_adjust → type_swap →
(revert) → idle`.
- **Start** (`force_adjust`): capture prior HR 27/54/58/59/96 into state; apply preamble
  (HR 27→0, HR 96→1, HR 59→0) + **HR 29→3**; record `baselineSoc`; persist.
- **Advance** (end of `doRefresh` with fresh `cache.inverter`):
  - **Recovered** (any phase): `battery_soc_percent >= targetSoc` (default 10) → revert.
  - **Safety cap** (any phase): elapsed ≥ `maxDurationMs` (default 180 min) → revert.
  - **Escalate** (`force_adjust` only): phase elapsed ≥ `escalateAfterMs` (default 15 min)
    AND SoC not risen above `baselineSoc + 1` → **type_swap**: HR 58→0, HR 54→0 (keep
    preamble + HR 29→3).
- **Revert**: HR 54→1 (Lithium) *before* HR 58→prior; HR 29→0; restore HR 27/59/96 to
  captured prior; state → `idle`; clear `kickstart.json`. (Order matters: restore Lithium
  before re-enabling auto-judge so they don't fight.)
- **Manual cancel**: same revert path on demand.

### Files
- `src/kickstart.js` (new): `start(opts)`, `cancel()`, `advance(inverter)`,
  `load()`/`persist()`, per-phase write sequences (reuse `writeHoldingRegister`). Keep the
  pure transition logic separate from writes so it's unit-testable with a fake SoC
  sequence.
- `src/routes/write.js`: `POST /kickstartCharge` (start; optional
  `{targetSoc, escalateAfterMinutes, maxDurationMinutes}`; cancel via `{cancel:true}`).
  Per-endpoint validation: HR 54∈{0,1}, HR 58∈{0,1}, HR 29∈{0,1,3}.
- `src/routes/read.js`: `kickstart.load()` at startup; `kickstart.advance(cache.inverter)`
  at end of `doRefresh()`; `kickstart:{phase,since,targetSoc}` on `/status`.
- `src/modbus/client.js` / `src/datamodel.js`: whitelist + surface HR 29/54/58 (shared
  with the register plumbing above).

### Safety
Writes stay gated by the `WRITABLE` whitelist + per-endpoint validation. `maxDurationMs`
is a hard backstop independent of the SoC threshold. Revert always restores *captured
prior* state (not blind "on"). On reload after restart, if the pack is offline (reads
failing) the machine simply doesn't advance until reads resume, then applies the safety
cap — no thrash.

### Kickstart unit test (no inverter)
A small node script feeding `advance()` a scripted SoC sequence: confirm
`force_adjust→type_swap` on flat SoC, revert on reaching `targetSoc`, and revert on
`maxDurationMs`.
