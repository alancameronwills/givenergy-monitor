import { readFileSync, writeFileSync, existsSync } from 'fs';
import { findInverter } from './src/scanner.js';

function readEnv(path = '.env') {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(l => /^\s*[A-Z_][A-Z0-9_]*=/.test(l))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

function writeEnv(vars, path = '.env') {
  writeFileSync(path, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 'utf8');
}

console.log('Scanning network for GivEnergy inverter...');
let lastNetwork = '';
const ip = await findInverter({
  onProgress: (checked, total, network) => {
    if (network !== lastNetwork) {
      if (lastNetwork) process.stdout.write('\n');
      lastNetwork = network;
    }
    process.stdout.write(`\r  Scanning ${network}: ${checked}/${total}...`);
  },
});
if (lastNetwork) process.stdout.write('\n');

if (ip) {
  process.env.INVERTER_HOST = ip;
  const env = readEnv();
  const prev = env.INVERTER_HOST;
  env.INVERTER_HOST  = ip;
  env.INVERTER_PORT ??= '8899';
  env.INVERTER_AIO  ??= 'false';
  env.NUM_BATTERIES ??= '1';
  env.API_PORT      ??= '6345';
  writeEnv(env);
  console.log(prev && prev !== ip
    ? `Inverter found at ${ip} (was ${prev})`
    : `Inverter found at ${ip}`);
} else {
  const fallback = process.env.INVERTER_HOST;
  if (fallback) {
    console.warn(`No inverter found on scan — using last known host: ${fallback}`);
  } else {
    console.error('No inverter found and INVERTER_HOST not set. Requests will likely fail.');
  }
}

// Dynamic imports so config.js evaluates after INVERTER_HOST is set above
const { default: app }    = await import('./src/app.js');
const { default: config } = await import('./src/config.js');

app.listen(config.apiPort, () => {
  console.log(`GivTCP Node running on port ${config.apiPort}`);
  console.log(`Inverter: ${config.host}:${config.port}${config.isAIO ? ' (AIO)' : ''}`);
  console.log(`Batteries: ${config.numBatteries}`);
});

