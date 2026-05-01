import app from './src/app.js';
import config from './src/config.js';

app.listen(config.apiPort, () => {
  console.log(`GivTCP Node running on port ${config.apiPort}`);
  console.log(`Inverter: ${config.host}:${config.port}${config.isAIO ? ' (AIO)' : ''}`);
  console.log(`Batteries: ${config.numBatteries}`);
});
