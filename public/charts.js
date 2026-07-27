/**
 * charts.js — tiny self-contained canvas charting for dashboard.html.
 * No external dependencies. Dark theme to match the dashboard.
 *
 *   drawLineChart(canvas, series, opts)
 *     series: [{ label, color, points: [[x, y], ...] }]
 *     opts:   { title, yMin, yMax, xMin, xMax, yUnit, xTicks:[{v,label}], legend }
 *
 *   drawBarChart(canvas, groups, opts)
 *     groups: [{ label, values: [v0, v1, ...] }]
 *     opts:   { title, seriesLabels:[...], colors:[...], yUnit, yMin, yMax }
 */

const AXIS = '#888';
const GRID = '#2a2a2a';
const TEXT = '#bbb';
const BG   = 'transparent';
const FONT = '11px system-ui, sans-serif';

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, rect.width || canvas.width || 300);
  const cssH = Math.max(1, rect.height || canvas.height || 150);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (BG !== 'transparent') { ctx.fillStyle = BG; ctx.fillRect(0, 0, cssW, cssH); }
  ctx.font = FONT;
  return { ctx, W: cssW, H: cssH };
}

function r6(v) { return Math.round(v * 1e6) / 1e6; }

function niceTicks(min, max, count = 5) {
  const span = (max - min) || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(step0)) || 0));
  const norm = step0 / mag;
  let step = mag;
  if (norm >= 7) step = 10 * mag;
  else if (norm >= 3) step = 5 * mag;
  else if (norm >= 1.5) step = 2 * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(r6(v));
  return ticks;
}

function fmt(v) {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(Math.abs(v) < 10 ? 1 : 0);
}

function title(ctx, W, t) {
  if (!t) return;
  ctx.fillStyle = TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(t, W / 2, 2);
}

function empty(ctx, W, H, t) {
  title(ctx, W, t);
  ctx.fillStyle = '#666';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('no data', W / 2, H / 2);
}

function drawLegend(ctx, items, x, y) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.fillRect(x, y - 4, 9, 9);
    ctx.fillStyle = TEXT;
    ctx.fillText(it.label, x + 13, y);
    x += 16 + ctx.measureText(it.label).width + 12;
  }
}

export function drawLineChart(canvas, series, opts = {}) {
  const { ctx, W, H } = setup(canvas);
  const pad = { l: 44, r: 10, t: opts.title ? 20 : 8, b: opts.legend ? 34 : 22 };

  const xs = [], ys = [];
  for (const s of series) for (const p of s.points) { xs.push(p[0]); ys.push(p[1]); }
  if (!xs.length) return empty(ctx, W, H, opts.title);

  const xMin = opts.xMin ?? Math.min(...xs);
  const xMax = opts.xMax ?? Math.max(...xs);
  let yMin = opts.yMin ?? Math.min(0, ...ys);
  let yMax = opts.yMax ?? Math.max(...ys);
  if (yMin === yMax) yMax = yMin + 1;
  const xSpan = (xMax - xMin) || 1;

  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const X = x => pad.l + (x - xMin) / xSpan * plotW;
  const Y = y => pad.t + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  title(ctx, W, opts.title);

  // y gridlines + labels
  ctx.strokeStyle = GRID;
  ctx.fillStyle = TEXT;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of niceTicks(yMin, yMax, 5)) {
    const y = Y(t);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillText(fmt(t) + (opts.yUnit || ''), pad.l - 4, y);
  }

  // x ticks
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xTicks = opts.xTicks || niceTicks(xMin, xMax, 6).map(v => ({ v, label: fmt(v) }));
  for (const t of xTicks) {
    if (t.v < xMin || t.v > xMax) continue;
    const x = X(t.v);
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + plotH); ctx.stroke();
    ctx.fillStyle = TEXT;
    ctx.fillText(t.label, x, pad.t + plotH + 4);
  }

  // axes
  ctx.strokeStyle = AXIS;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + plotH); ctx.lineTo(W - pad.r, pad.t + plotH);
  ctx.stroke();

  // series
  ctx.lineWidth = 1.5;
  for (const s of series) {
    if (!s.points.length) continue;
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const x = X(p[0]), y = Y(p[1]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  if (opts.legend) drawLegend(ctx, series.map(s => ({ label: s.label, color: s.color })), pad.l, H - 8);
}

export function drawBarChart(canvas, groups, opts = {}) {
  const { ctx, W, H } = setup(canvas);
  const pad = { l: 44, r: 10, t: opts.title ? 20 : 8, b: opts.seriesLabels ? 34 : 22 };
  if (!groups.length) return empty(ctx, W, H, opts.title);

  const nSeries = Math.max(1, ...groups.map(g => g.values.length));
  const colors = opts.colors || ['#ffe800', '#009700', '#e53935', '#3ac5f3'];
  let yMax = opts.yMax ?? Math.max(1, ...groups.flatMap(g => g.values));
  let yMin = opts.yMin ?? 0;
  if (yMin === yMax) yMax = yMin + 1;

  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const Y = y => pad.t + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  title(ctx, W, opts.title);

  // y gridlines
  ctx.strokeStyle = GRID;
  ctx.fillStyle = TEXT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of niceTicks(yMin, yMax, 5)) {
    const y = Y(t);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillText(fmt(t) + (opts.yUnit || ''), pad.l - 4, y);
  }

  const gw = plotW / groups.length;         // width per group
  const inner = gw * 0.7;                    // used by bars
  const bw = inner / nSeries;                // per-series bar width
  const y0 = Y(0);

  // x labels: thin out so they don't overlap
  const every = Math.ceil(groups.length / 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  groups.forEach((g, gi) => {
    const gx = pad.l + gi * gw + (gw - inner) / 2;
    g.values.forEach((v, si) => {
      ctx.fillStyle = colors[si % colors.length];
      const y = Y(v);
      ctx.fillRect(gx + si * bw, Math.min(y, y0), Math.max(1, bw - 1), Math.abs(y0 - y));
    });
    if (gi % every === 0) {
      ctx.fillStyle = TEXT;
      ctx.fillText(g.label, pad.l + gi * gw + gw / 2, pad.t + plotH + 4);
    }
  });

  // axes
  ctx.strokeStyle = AXIS;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + plotH); ctx.lineTo(W - pad.r, pad.t + plotH);
  ctx.stroke();

  if (opts.seriesLabels) {
    drawLegend(ctx, opts.seriesLabels.map((label, i) => ({ label, color: colors[i % colors.length] })), pad.l, H - 8);
  }
}
