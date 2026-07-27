export default {
  // No hardcoded default: an unknown host must be discovered by scanning, not
  // silently pointed at the gateway (192.168.1.1), which never answers Modbus
  // and used to trap the reconnect monitor. Empty host => reads fail => rescan.
  host: process.env.INVERTER_HOST || '',
  port: parseInt(process.env.INVERTER_PORT || '8899'),
  isAIO: process.env.INVERTER_AIO === 'true',
  numBatteries: parseInt(process.env.NUM_BATTERIES || '1'),
  apiPort: parseInt(process.env.API_PORT || '6345'),

  // History logging (src/history.js). Sampler cadence and where data lives, plus how
  // long detail (per-day JSONL) and daily-summary entries are retained before pruning.
  sampleIntervalMs: parseInt(process.env.SAMPLE_INTERVAL_MS || '300000'),
  dataDir: process.env.DATA_DIR || './data',
  detailRetentionDays: parseInt(process.env.DETAIL_RETENTION_DAYS || '7'),
  summaryRetentionDays: parseInt(process.env.SUMMARY_RETENTION_DAYS || '366'),
};
