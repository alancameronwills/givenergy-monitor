#!/usr/bin/env node
/**
 * GivEnergy inverter LAN scanner — CLI wrapper.
 * Scanning logic lives in src/scanner.js.
 *
 * Usage:
 *   node scan.js                    auto-detect network
 *   node scan.js 192.168.1.0/24    scan a specific range
 *   node scan.js --dry-run         scan but don't update .env
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { findInverter, getCandidateNetworks } from './src/scanner.js';

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

const args   = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const range  = args.find(a => !a.startsWith('--'));

console.log('GivEnergy inverter scanner\n');

if (!range) {
  for (const n of getCandidateNetworks()) {
    const msg = n.hostCount > 1022
      ? `  Skipping ${n.name} (${n.address}/${n.bits}) — too large (${n.hostCount} hosts), use: node scan.js ${n.address}/${n.bits}`
      : `  Found network: ${n.name}  ${n.address}/${n.bits}  (${n.hostCount} hosts)`;
    console.log(msg);
  }
  console.log();
}

let lastNetwork = '';
const ip = await findInverter({
  range,
  onProgress: (checked, total, network) => {
    if (network !== lastNetwork) {
      if (lastNetwork) process.stdout.write('\n');
      process.stdout.write(`Scanning ${network} (${total} hosts)...\n`);
      lastNetwork = network;
    }
    process.stdout.write(`\r  Checked ${checked}/${total}...`);
  },
});

if (lastNetwork) process.stdout.write('\n');

if (!ip) {
  console.log('\nNo GivEnergy inverter found.');
  console.log('Check that the inverter is powered on and connected to this network.');
  process.exit(1);
}

console.log(`\nInverter found at ${ip}`);

if (dryRun) {
  console.log(`[dry-run] Would set INVERTER_HOST=${ip} in .env`);
} else {
  const env = readEnv();
  const prev = env.INVERTER_HOST;
  env.INVERTER_HOST  = ip;
  env.INVERTER_PORT ??= '8899';
  env.INVERTER_AIO  ??= 'false';
  env.NUM_BATTERIES ??= '1';
  env.API_PORT      ??= '6345';
  writeEnv(env);
  console.log(prev && prev !== ip
    ? `Updated .env: INVERTER_HOST ${prev} → ${ip}`
    : `Updated .env: INVERTER_HOST=${ip}`);
}
