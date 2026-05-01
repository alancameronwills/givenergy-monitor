import net from 'net';
import config from '../config.js';
import {
  buildReadHoldingFrame,
  buildReadInputFrame,
  buildWriteFrame,
  parseResponse,
  readResponseSize,
  writeResponseSize,
} from './protocol.js';

const CONNECT_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;
const SLEEP_BETWEEN_QUERIES_MS = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendAndReceive(frame, expectedBytes) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const sock = net.createConnection({ port: config.port, host: config.host });

    const reqTimer = setTimeout(() => sock.destroy(new Error('Request timeout')), REQUEST_TIMEOUT_MS);

    sock.setTimeout(CONNECT_TIMEOUT_MS);
    sock.on('timeout', () => sock.destroy(new Error('Connect timeout')));

    sock.on('connect', () => {
      sock.setTimeout(0);
      sock.write(frame);
    });

    sock.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= expectedBytes) {
        clearTimeout(reqTimer);
        sock.destroy();
        try {
          resolve(parseResponse(buffer));
        } catch (e) {
          reject(e);
        }
      }
    });

    sock.on('error', err => {
      clearTimeout(reqTimer);
      reject(err);
    });

    sock.on('close', () => clearTimeout(reqTimer));
  });
}

export async function readHoldingRegisters(slaveAddr, baseRegister, count = 60) {
  const frame = buildReadHoldingFrame(slaveAddr, baseRegister, count);
  const result = await sendAndReceive(frame, readResponseSize(count));
  return result.values;
}

export async function readInputRegisters(slaveAddr, baseRegister, count = 60) {
  const frame = buildReadInputFrame(slaveAddr, baseRegister, count);
  const result = await sendAndReceive(frame, readResponseSize(count));
  return result.values;
}

export async function writeHoldingRegister(register, value) {
  const WRITABLE = new Set([20, 27, 31, 32, 35, 36, 37, 38, 39, 40, 44, 45, 50, 56, 57, 59, 94, 95, 96, 110, 111, 112, 114, 116, 163]);
  if (!WRITABLE.has(register)) throw new Error(`Register ${register} is not safe to write`);
  if (value < 0 || value > 0xFFFF) throw new Error(`Value ${value} must be an unsigned 16-bit integer`);

  const frame = buildWriteFrame(register, value);
  const result = await sendAndReceive(frame, writeResponseSize);
  if (result.value !== value) {
    throw new Error(`Write verification failed: wrote 0x${value.toString(16)}, read back 0x${result.value.toString(16)}`);
  }
  return result;
}

export async function fetchAllRegisters(numBatteries = 1) {
  const inverterSlave = config.isAIO ? 0x11 : 0x31;

  // Sequential reads with sleep between each — the inverter handles one connection at a time
  const hr0   = await readHoldingRegisters(inverterSlave, 0);   await sleep(SLEEP_BETWEEN_QUERIES_MS);
  const hr60  = await readHoldingRegisters(inverterSlave, 60);  await sleep(SLEEP_BETWEEN_QUERIES_MS);
  const hr120 = await readHoldingRegisters(inverterSlave, 120); await sleep(SLEEP_BETWEEN_QUERIES_MS);
  const ir0   = await readInputRegisters(inverterSlave, 0);     await sleep(SLEEP_BETWEEN_QUERIES_MS);
  const ir180 = await readInputRegisters(inverterSlave, 180);

  const holdingRegisters = { ...hr0, ...hr60, ...hr120 };
  const inputRegisters = { ...ir0, ...ir180 };

  const batteries = [];
  for (let i = 0; i < numBatteries; i++) {
    await sleep(SLEEP_BETWEEN_QUERIES_MS);
    const battRegs = await readInputRegisters(0x32 + i, 60);
    batteries.push(battRegs);
  }

  return { holdingRegisters, inputRegisters, batteries };
}
