import net from 'net';
import os from 'os';
import { buildReadHoldingFrame } from './modbus/protocol.js';

const INVERTER_PORT    = 8899;
const CONNECT_TIMEOUT  = 400;
const VERIFY_TIMEOUT   = 2000;
const BATCH_SIZE       = 50;
const MAX_HOSTS        = 1022;  // skip anything larger than /22

function ipToInt(ip) {
  return ip.split('.').reduce((a, o) => ((a << 8) | parseInt(o, 10)) >>> 0, 0) >>> 0;
}

function intToIp(n) {
  return [n >>> 24, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.');
}

function maskToBits(netmask) {
  return netmask.split('.').reduce((a, o) => a + parseInt(o, 10).toString(2).split('1').length - 1, 0);
}

export function getCandidateNetworks() {
  const results = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const bits = maskToBits(addr.netmask);
      const hostCount = 2 ** (32 - bits) - 2;
      results.push({ name, address: addr.address, bits, hostCount });
    }
  }
  return results;
}

export function parseRange(cidr) {
  const [ip, bits] = cidr.includes('/') ? cidr.split('/') : [cidr, '24'];
  const prefixBits = parseInt(bits, 10);
  const mask = prefixBits === 0 ? 0 : (0xFFFFFFFF << (32 - prefixBits)) >>> 0;
  const network   = (ipToInt(ip) & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const hosts = [];
  for (let i = network + 1; i < broadcast; i++) hosts.push(intToIp(i));
  return hosts;
}

function checkPort(host) {
  return new Promise(resolve => {
    const sock = net.createConnection({ host, port: INVERTER_PORT });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, CONNECT_TIMEOUT);
    sock.on('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.on('error',   () => { clearTimeout(timer); resolve(false); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

export async function scanHosts(hosts, onProgress) {
  const found = [];
  for (let i = 0; i < hosts.length; i += BATCH_SIZE) {
    const batch   = hosts.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(h => checkPort(h)));
    batch.forEach((h, j) => { if (results[j]) found.push(h); });
    onProgress?.(Math.min(i + batch.length, hosts.length), hosts.length);
  }
  return found;
}

export function verifyGivEnergy(host) {
  return new Promise(resolve => {
    const frame = buildReadHoldingFrame(0x31, 0, 1);
    let buf = Buffer.alloc(0);
    const sock  = net.createConnection({ host, port: INVERTER_PORT });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, VERIFY_TIMEOUT);
    sock.on('connect', () => sock.write(frame));
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= 4) {
        clearTimeout(timer);
        sock.destroy();
        resolve(buf.readUInt16BE(0) === 0x5959 && buf.readUInt16BE(2) === 0x0001);
      }
    });
    sock.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

/**
 * Scan the local network for a GivEnergy inverter.
 * Returns the confirmed IP address, or null if not found.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.range]      - explicit CIDR to scan, e.g. "192.168.2.0/24"
 * @param {function} [opts.onProgress] - (checked, total, network) => void
 */
export async function findInverter({ range, onProgress } = {}) {
  let networksToScan;

  if (range) {
    networksToScan = [{ label: range, hosts: parseRange(range) }];
  } else {
    const candidates = getCandidateNetworks().filter(n => {
      if (n.hostCount > MAX_HOSTS) return false;
      return true;
    });
    if (candidates.length === 0) return null;
    networksToScan = candidates.map(n => ({
      label: `${n.address}/${n.bits}`,
      hosts: parseRange(`${n.address}/${n.bits}`),
    }));
  }

  for (const { label, hosts } of networksToScan) {
    const hits = await scanHosts(hosts, (checked, total) => {
      onProgress?.(checked, total, label);
    });
    for (const ip of hits) {
      if (await verifyGivEnergy(ip)) return ip;
    }
  }

  return null;
}
