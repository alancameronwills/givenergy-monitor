export default {
  host: process.env.INVERTER_HOST || '192.168.1.1',
  port: parseInt(process.env.INVERTER_PORT || '8899'),
  isAIO: process.env.INVERTER_AIO === 'true',
  numBatteries: parseInt(process.env.NUM_BATTERIES || '1'),
  apiPort: parseInt(process.env.API_PORT || '6345'),
};
