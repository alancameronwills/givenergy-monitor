/**
 * Read-only history endpoints. Thin wrappers over the reader functions in
 * src/history.js (which owns storage + the sampler).
 *
 *   GET /history/days                      → ["YYYY-MM-DD", ...] available detail days
 *   GET /history/day?date=YYYY-MM-DD       → parsed samples for that day (default today)
 *   GET /history/summary                   → the daily.json array (oldest → newest)
 */

import { Router } from 'express';
import { listDays, readDay, readSummary } from '../history.js';

const router = Router();

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

router.get('/history/days', (req, res) => {
  res.json(listDays());
});

router.get('/history/day', (req, res) => {
  const date = req.query.date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  res.json({ date, samples: readDay(date) });
});

router.get('/history/summary', (req, res) => {
  res.json(readSummary());
});

export default router;
