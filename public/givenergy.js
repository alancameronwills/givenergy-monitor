/**
 * givenergy.js — browser ES module for reading GivEnergy inverter power data.
 *
 * Fetches the six power fields from the giv-tcp-node API server.
 * Network scanning runs on the server (GET /scan); this module just reads data.
 *
 * Usage — same origin (page served by the API server):
 *   import { getPowerData } from '/givenergy.js';
 *   const data = await getPowerData();
 *
 * Usage — different origin:
 *   import { getPowerData } from '/givenergy.js';
 *   const data = await getPowerData({ baseUrl: 'http://192.168.1.x:6345' });
 *
 * Returns:
 *   { pv1_power_W, pv2_power_W, grid_power_W,
 *     battery_power_W, battery_soc_percent, load_power_W }
 */

/**
 * Fetch the six power fields from the API server.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl] - Server base URL. Defaults to same origin.
 * @param {number} [options.timeout] - Request timeout in ms. Default 5000.
 */
export async function getPowerData({ baseUrl = '', timeout = 10000 } = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${baseUrl}/power`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
