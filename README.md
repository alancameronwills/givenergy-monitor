# GivEnergy Solar Monitor

A local server and web UI for a GivEnergy solar inverter. Reads the inverter over Modbus TCP and displays a Sankey-style power-flow diagram, optimised for a 480×320 Raspberry Pi touchscreen.

## Requirements

- Raspberry Pi (or any Linux machine on the same LAN as the inverter)
- Node.js 22 or later
- GivEnergy inverter connected to the local network via Wi-Fi or Ethernet

## Installation

```bash
git clone https://github.com/alancameronwills/givenergy-monitor.git
cd givenergy-monitor
npm install
```

## Running

### Manual start

```bash
npm start
```

On first run the server scans the local network, finds the inverter, writes `.env`, and starts listening on port 6345. Open `http://localhost:6345/pv.html` in a browser.

### Auto-start on Raspberry Pi

`run.sh` fetches the latest code from GitHub, starts the server, then opens Chromium in kiosk mode pointing at the UI. To launch it automatically on desktop login:

```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/run-monitor.desktop << 'EOF'
[Desktop Entry]
Name=Solar monitor
Exec=/home/alan/givenergy-monitor/run.sh
Type=Application
EOF
```

Adjust the path if your username or install location differs.

## Configuration

`.env` is created automatically on first run. Edit it to override defaults:

```
INVERTER_HOST=192.168.1.x   # written automatically by the network scan
INVERTER_PORT=8899
INVERTER_AIO=false           # set to true for All-in-One models
NUM_BATTERIES=1
API_PORT=6345
```

## How it works

**Inverter discovery** — on startup the server scans the local network for a device listening on port 8899 that responds to the GivEnergy Modbus framing. The found IP is written to `.env` and used for the session. The server exits after 24 hours so the process manager can restart it and re-scan (useful if the inverter's IP changes via DHCP).

**Reconnection** — once the inverter has been contacted successfully, if no response is received for 20 minutes the server re-scans the network and updates its target IP on the fly. If the scan fails it retries every 20 minutes.

**Protocol** — GivEnergy uses a non-standard MBAP+ Modbus framing (magic bytes `0x5959 0x0001`). All protocol and register-map logic is in `src/modbus/` and `src/datamodel.js`; no external Modbus library is used.

**API** — REST endpoints served on port 6345:

| Endpoint | Description |
|---|---|
| `GET /power` | Current power readings (PV, grid, battery, load) |
| `GET /runAll` | Full inverter + battery data, updates cache |
| `GET /getCache` | Last cached result without hitting the inverter |
| `GET /scan` | Trigger a manual network scan |
| `POST /...` | ~25 write endpoints for charge/export/pause control |
