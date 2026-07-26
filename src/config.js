export default {
  // No hardcoded default: an unknown host must be discovered by scanning, not
  // silently pointed at the gateway (192.168.1.1), which never answers Modbus
  // and used to trap the reconnect monitor. Empty host => reads fail => rescan.
  host: process.env.INVERTER_HOST || '',
  port: parseInt(process.env.INVERTER_PORT || '8899'),
  isAIO: process.env.INVERTER_AIO === 'true',
  numBatteries: parseInt(process.env.NUM_BATTERIES || '1'),
  apiPort: parseInt(process.env.API_PORT || '6345'),
};
