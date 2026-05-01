/**
 * GivEnergy Modbus TCP protocol implementation.
 *
 * Frame structure (request):
 *   MBAP+ header (8 bytes): 59 59 00 01 [len_hi][len_lo] 01 02
 *   PDU (26 bytes):
 *     [serial 10] [padding 8] [slave 1] [func 1] [base_reg 2] [count 2] [crc 2]
 *
 * Frame structure (response, 60 registers):
 *   MBAP+ header (8 bytes)
 *   [serial 10] [padding 8] [slave 1] [func 1]   <- common PDU header (20 bytes from offset 8)
 *   [inv_serial 10] [base_reg 2] [count 2] [values N*2] [check 2]
 *
 * Byte map of raw socket buffer:
 *   [0:2]  tid  (0x5959)
 *   [2:4]  pid  (0x0001)
 *   [4:6]  len  (PDU_size + 2)
 *   [6]    uid  (0x01)
 *   [7]    fid  (0x02)
 *   [8:18] data_adapter_serial
 *   [18:26] padding (uint64)
 *   [26]   slave_address
 *   [27]   function_code (3=holdReg, 4=inputReg, 6=writeReg)
 *   [28:38] inverter_serial
 *   [38:40] base_register
 *   [40:42] register_count
 *   [42:42+N*2] register values (uint16 BE each)
 *   [42+N*2:] check CRC
 */

import { crc16modbus } from './crc.js';

const DATA_ADAPTER_SERIAL = Buffer.from('**********', 'ascii');
const PADDING = Buffer.from([0, 0, 0, 0, 0, 0, 0, 8]);

function buildCrc(slaveAddr, funcCode, word1, word2) {
  const raw = crc16modbus(Buffer.from([
    slaveAddr, funcCode,
    (word1 >> 8) & 0xFF, word1 & 0xFF,
    (word2 >> 8) & 0xFF, word2 & 0xFF,
  ]));
  // byte-swap: CRC is stored as little-endian bytes interpreted as big-endian
  return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF);
}

function buildFrame(slaveAddr, funcCode, word1, word2) {
  const body = Buffer.alloc(26);
  DATA_ADAPTER_SERIAL.copy(body, 0);
  PADDING.copy(body, 10);
  body[18] = slaveAddr;
  body[19] = funcCode;
  body.writeUInt16BE(word1, 20);
  body.writeUInt16BE(word2, 22);
  body.writeUInt16BE(buildCrc(slaveAddr, funcCode, word1, word2), 24);

  const header = Buffer.alloc(8);
  header.writeUInt16BE(0x5959, 0);
  header.writeUInt16BE(0x0001, 2);
  header.writeUInt16BE(body.length + 2, 4);
  header[6] = 0x01;
  header[7] = 0x02;

  return Buffer.concat([header, body]);
}

export function buildReadHoldingFrame(slaveAddr, baseRegister, count) {
  return buildFrame(slaveAddr, 0x03, baseRegister, count);
}

export function buildReadInputFrame(slaveAddr, baseRegister, count) {
  return buildFrame(slaveAddr, 0x04, baseRegister, count);
}

export function buildWriteFrame(register, value) {
  return buildFrame(0x11, 0x06, register, value);
}

export function parseResponse(buf) {
  if (buf.length < 8) throw new Error('Buffer too short for MBAP+ header');

  const tid = buf.readUInt16BE(0);
  const pid = buf.readUInt16BE(2);
  const uid = buf[6];
  const fid = buf[7];

  if (tid !== 0x5959 || pid !== 0x0001 || uid !== 0x01) {
    throw new Error(`Invalid MBAP+ header: tid=0x${tid.toString(16)}, pid=0x${pid.toString(16)}, uid=0x${uid.toString(16)}`);
  }

  if (fid === 0x01) {
    const errorCode = buf[18];
    throw new Error(`GivEnergy error response: errorCode=0x${errorCode.toString(16)}`);
  }

  if (fid !== 0x02) {
    throw new Error(`Unexpected fid byte: 0x${fid.toString(16)}`);
  }

  const funcCode = buf[27];

  if (funcCode === 0x03 || funcCode === 0x04) {
    const baseReg = buf.readUInt16BE(38);
    const regCount = buf.readUInt16BE(40);
    const values = {};
    for (let i = 0; i < regCount; i++) {
      values[baseReg + i] = buf.readUInt16BE(42 + i * 2);
    }
    return { funcCode, baseReg, regCount, values };
  }

  if (funcCode === 0x06) {
    const register = buf.readUInt16BE(38);
    const value = buf.readUInt16BE(40);
    return { funcCode, register, value };
  }

  throw new Error(`Unknown function code: 0x${funcCode.toString(16)}`);
}

export function readResponseSize(count) {
  return 44 + count * 2;
}

export const writeResponseSize = 44;
