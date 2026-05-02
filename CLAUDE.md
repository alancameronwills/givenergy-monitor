# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run server (scans for inverter on startup)
npm run dev        # Run with --watch for auto-reload
npm run scan       # Discover inverter on local network
node scan.js 192.168.1.0/24        # Scan specific CIDR
node scan.js --dry-run             # Scan without updating .env
```

No build step — pure ES modules (`"type": "module"` in package.json), Node.js built-ins only plus `express`.

There is no automated test suite. Test manually via cURL against `http://localhost:6345` or through the web UI at `/pv.html`.

## Environment Setup

`.env` is created/updated automatically — no manual setup required. On first run the server scans the local network, finds the inverter, and writes `.env`. Subsequent runs load `.env` via `--env-file-if-exists=.env` then re-scan to confirm the IP.

Key variables: `INVERTER_HOST`, `INVERTER_PORT` (default 8899), `INVERTER_AIO` (All-in-One model flag), `NUM_BATTERIES`, `API_PORT` (default 6345).

## Inverter discovery and reconnection

`server.js` scans the network at startup (via `src/scanner.js`) before starting Express. If the scan fails, it falls back to the `INVERTER_HOST` already in the environment.

The server calls `process.exit(0)` after 24 hours so a process manager (systemd `Restart=always`, PM2, or a shell loop) restarts it and re-scans.

`src/routes/read.js` runs a background reconnect monitor (`setInterval`, 60 s). Once any modbus read has succeeded (`hasConnected = true`), it watches `lastSuccess`. If more than 20 minutes pass without a successful read it first calls `hasLanConnectivity()` (in `src/scanner.js`) to check whether the Pi can reach its default gateway. If the LAN is unreachable (WiFi dropout), the cycle is skipped without advancing `nextScanAt`, so a scan fires immediately once connectivity returns. If the LAN is up but the inverter is gone, it runs a network scan and updates `config.host` live. On scan failure it retries every 20 minutes.

`hasLanConnectivity()` reads the default gateway from `/proc/net/route` (Linux/Raspberry Pi) and attempts a 2-second TCP connection to it on port 80. `ECONNREFUSED` counts as reachable. Falls back to checking `os.networkInterfaces()` if no gateway is found (e.g. on Windows during development).

## Architecture

**Purpose:** Reads a GivEnergy solar inverter over Modbus TCP on the local network and serves power/battery data to a web UI optimised for a 480×320 Raspberry Pi display.

### Request flow

```
HTTP client → Express (src/app.js) → routes/read.js or routes/write.js
                                          ↓
                                   src/modbus/client.js   (raw TCP socket)
                                          ↓
                                   src/modbus/protocol.js (GivEnergy frame builder/parser)
                                          ↓
                                   src/modbus/crc.js      (CRC16 checksum)
                                          ↓
                                   src/datamodel.js       (register map → structured JSON)
```

### Modbus protocol

GivEnergy uses a non-standard MBAP+ framing: an 8-byte header starting with `0x5959 0x0001`, followed by a 26-byte body with slave address, function code (0x03 read holding, 0x04 read input, 0x06 write single), register address, count, and CRC16. All logic is in `src/modbus/protocol.js` — no npm modbus library is used.

The inverter handles one connection at a time; `client.js` opens a socket per request and inserts 500 ms delays between sequential register reads.

### Register reading

`client.js` reads:
- Holding registers in three batches: 0–59, 60–119, 120–179
- Input registers in two batches: 0–59, 180–239
- Battery slave registers from slaves `0x32`, `0x33`, … for each extra battery (`NUM_BATTERIES > 1`)
- All-in-One models use slave `0x11` instead of `0x31`

### Data model

`src/datamodel.js` maps raw register values to structured JSON. Registers use scaling flags (`deci` ÷10, `centi` ÷100, `u32` for 32-bit pairs, `ascii` for strings, `bcd` for time). The mapping closely mirrors the Python `givenergy_modbus` library.

### Write operations

`src/routes/write.js` exposes ~25 POST endpoints. Force-charge/export and pause operations use `setTimeout` to auto-revert the inverter state after N minutes.

### Caching

`GET /runAll` and `GET /getData` both populate an in-memory cache. `GET /getCache` returns the last cached result without hitting the inverter — used by the UI for polling without hammering the device.

### Web UI

`public/pv.html` is a self-contained Sankey-style power flow diagram for a 480×320 display. It polls `/power` every 60 s and shows an "unavailable" banner on failure. `public/givenergy.js` is the browser ES module that wraps the `/power` fetch.
