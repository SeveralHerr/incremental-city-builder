// Skyline: an SVG city that grows with state.buildings.
//
// Three stacked SVGs share one viewBox so continuous animation never repaints the heavy layer:
//   sky  — gradient, stars, sun/moon, drifting parallax clouds (CSS animated, few nodes)
//   city — hills, silhouettes in three depth rows, ground, night overlay, window lights
//          (rebuilt only when building counts change; two attributes touched at ~2.5 Hz)
//   fx   — windmill blades, smoke, reactor glow (CSS animated, few nodes)
// Silhouettes are per building id (fallback per category) tinted with the category accent,
// count-scaled on a log curve so one cottage and a thousand towers both read well, placed with
// a seeded PRNG so buying more never reshuffles what is already standing.
//
// Landmarks (LANDMARKS) are one-off set pieces keyed by owned upgrade id: a ferris wheel, a
// monorail, pylons, a ringworld arc.
//
// Public shape: createSkyline(host, ui) -> { el, update(rows, ownedUpgradeIds), tick(dt), setPhase(p), phase() }
import { svg, clear, prefersReducedMotion } from './dom.js';

const W = 480;
const H = 240;
const GROUND = 202;
const DAY_SEC = 480; // one full day/night cycle in real seconds
const START_PHASE = 0.34; // open on a bright morning
const TINT_EVERY = 0.4; // seconds between sky writes
const MAX_SHAPES = 140;
const MAX_WINDOWS = 900;
const MAX_SMOKE = 6;

const BASE = '#0c1230'; // silhouette base (category color is mixed into this)
const HAZE = '#4a63a8'; // atmospheric haze mixed into the back rows (lifts them toward the sky)
const TREE = '#3f9d68';
const LIGHT = { residential: '#ffd98a', commercial: '#ffe9ae', industrial: '#ffb56e', power: '#fff4bd', civic: '#ffd98a' };

// Sky keyframes across one day. `night` drives overlay/lights/stars; `warm` the horizon glow.
const SKY = [
  { p: 0.0, top: '#04060f', mid: '#0a1128', hor: '#161d3d', night: 1, warm: 0, cloud: '#3a4470' },
  { p: 0.14, top: '#0a0f2c', mid: '#2a2452', hor: '#5a3a5e', night: 0.85, warm: 0.3, cloud: '#5b5a86' },
  { p: 0.22, top: '#1d2b63', mid: '#5b4a86', hor: '#e9a077', night: 0.45, warm: 1, cloud: '#f2c7b0' },
  { p: 0.32, top: '#2456a8', mid: '#5f97d8', hor: '#b9d5ee', night: 0.05, warm: 0.3, cloud: '#ffffff' },
  { p: 0.5, top: '#2a63bd', mid: '#6ea5e3', hor: '#c6dff3', night: 0, warm: 0, cloud: '#ffffff' },
  { p: 0.64, top: '#24479a', mid: '#7a6fb0', hor: '#f0b27a', night: 0.15, warm: 0.7, cloud: '#ffd9c2' },
  { p: 0.72, top: '#151a4f', mid: '#6d3f75', hor: '#f0844f', night: 0.45, warm: 1, cloud: '#e9a78f' },
  { p: 0.8, top: '#080b26', mid: '#1f1c48', hor: '#4a2f55', night: 0.85, warm: 0.35, cloud: '#5b5a86' },
  { p: 0.88, top: '#04060f', mid: '#0a1128', hor: '#161d3d', night: 1, warm: 0, cloud: '#3a4470' },
  { p: 1.0, top: '#04060f', mid: '#0a1128', hor: '#161d3d', night: 1, warm: 0, cloud: '#3a4470' },
];

// Depth rows: back → front. Scale, ground offset, haze mix, edge-line opacity.
const DEPTH = [
  { scale: 0.66, dy: -14, haze: 0.5, edge: 0.3 },
  { scale: 0.84, dy: -7, haze: 0.24, edge: 0.55 },
  { scale: 1, dy: 0, haze: 0, edge: 0.85 },
];
// Per tier: [wMin, wMax, hMin, hMax], silhouette cap, horizontal spread (1 = full width).
const SIZE = { 1: [17, 24, 20, 32], 2: [22, 32, 48, 74], 3: [26, 36, 86, 128], 4: [38, 54, 128, 172] };
const CAP = { 1: 10, 2: 8, 3: 6, 4: 4 };
const SPREAD = { 1: 1, 2: 0.92, 3: 0.72, 4: 0.5 };

// ---------- small utils ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const f1 = (n) => (Math.round(n * 10) / 10).toString();

function hash(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return x >>> 0;
}
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexOf(c) {
  return '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
function mixHex(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  return hexOf([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]);
}
function shade(hex, amt) {
  return mixHex(hex, amt > 0 ? '#ffffff' : '#000000', Math.abs(amt));
}

function skyAt(p) {
  p = ((p % 1) + 1) % 1;
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1].p <= p) i++;
  const a = SKY[i];
  const b = SKY[i + 1];
  const t = smooth(clamp((p - a.p) / (b.p - a.p), 0, 1));
  return {
    top: mixHex(a.top, b.top, t),
    mid: mixHex(a.mid, b.mid, t),
    hor: mixHex(a.hor, b.hor, t),
    cloud: mixHex(a.cloud, b.cloud, t),
    night: lerp(a.night, b.night, t),
    warm: lerp(a.warm, b.warm, t),
  };
}

function silhouetteCount(count, tier) {
  return clamp(1 + Math.floor(Math.log2(count + 1) * 0.9), 1, CAP[tier]);
}

// ---------- silhouette drawing ----------
// Every shape function receives a context: { x, gy, w, h, body, edge, rnd, rect, path, win, glow, fx }.
// `win` adds a lit window to the night layer; `glow` adds a colored night light; `fx` adds an
// animated element to the fx layer. Coordinates: x left, gy ground baseline, shapes grow upward.

function makeCtx(shape, layers, budget) {
  const D = DEPTH[shape.depth];
  const w = shape.w * D.scale;
  const h = shape.h * D.scale;
  const x = shape.cx - w / 2;
  const gy = GROUND + D.dy;
  const rnd = prng(shape.seed);
  const cat = shape.color;
  const body = mixHex(mixHex(cat, BASE, 0.62 + rnd() * 0.08), HAZE, D.haze);
  const g = svg('g', { class: 'sk-b' });
  const lights = svg('g');
  const light = mixHex(LIGHT[shape.cat] || '#ffd98a', '#ffffff', 0.1);
  const ctx = {
    x,
    gy,
    w,
    h,
    body,
    edge: cat,
    edgeOp: D.edge,
    depth: shape.depth,
    rnd,
    g,
    lights,
    light,
    rect(rx, ry, rw, rh, fill = body, extra = null) {
      g.append(svg('rect', { x: f1(rx), y: f1(ry), width: f1(Math.max(0.5, rw)), height: f1(Math.max(0.5, rh)), fill, ...(extra || {}) }));
    },
    path(d, fill = body, extra = null) {
      g.append(svg('path', { d, fill, ...(extra || {}) }));
    },
    top(rx, ry, rw) {
      g.append(svg('rect', { x: f1(rx), y: f1(ry), width: f1(rw), height: 1.2, fill: cat, opacity: D.edge }));
    },
    win(wx, wy, ww, wh, prob = 0.7, color = light) {
      if (budget.windows <= 0) return;
      if (rnd() > prob) return;
      budget.windows--;
      lights.append(svg('rect', { x: f1(wx), y: f1(wy), width: f1(ww), height: f1(wh), fill: color, opacity: (0.6 + rnd() * 0.4).toFixed(2) }));
    },
    // Window grid inside a box; subsampled to keep at most `max` lit windows per building.
    grid(bx, by, bw, bh, cw, ch, gx, gy2, prob = 0.7, max = 18) {
      const cols = Math.max(1, Math.floor((bw - gx) / (cw + gx)));
      const rows = Math.max(1, Math.floor((bh - gy2) / (ch + gy2)));
      const total = cols * rows;
      const stride = total > max ? Math.ceil(total / max) : 1;
      const ox = bx + (bw - (cols * (cw + gx) - gx)) / 2;
      const oy = by + gy2;
      let k = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++, k++) {
          if (stride > 1 && k % stride !== 0) continue;
          ctx.win(ox + c * (cw + gx), oy + r * (ch + gy2), cw, ch, prob);
        }
      }
    },
    glow(cx, cy, r, color, cls = '') {
      lights.append(svg('circle', { cx: f1(cx), cy: f1(cy), r: f1(r), fill: color, class: cls || null }));
    },
    fx(el) {
      layers.fx.append(el);
    },
    smoke(sx, sy, scale = 1) {
      if (budget.smoke <= 0 || prefersReducedMotion()) return;
      budget.smoke--;
      for (let i = 0; i < 3; i++) {
        const c = svg('circle', { cx: f1(sx), cy: f1(sy), r: f1((2.2 + i * 0.6) * scale), fill: '#c9d0e6', class: 'sk-smoke' });
        c.style.setProperty('--delay', `${(-i * 1.7 - rnd() * 1.5).toFixed(2)}s`);
        layers.fx.append(c);
      }
    },
  };
  return ctx;
}

const SHAPES = {
  house(c) {
    const bh = c.h * 0.6;
    c.rect(c.x, c.gy - bh, c.w, bh);
    c.path(`M${f1(c.x - 1)} ${f1(c.gy - bh)} L${f1(c.x + c.w / 2)} ${f1(c.gy - c.h)} L${f1(c.x + c.w + 1)} ${f1(c.gy - bh)} Z`, shade(c.body, 0.14));
    c.rect(c.x + c.w * 0.66, c.gy - c.h + (c.h - bh) * 0.3, c.w * 0.12, (c.h - bh) * 0.6, shade(c.body, -0.1));
    c.rect(c.x + c.w * 0.42, c.gy - bh * 0.5, c.w * 0.16, bh * 0.5, shade(c.body, -0.25));
    c.win(c.x + c.w * 0.14, c.gy - bh * 0.78, c.w * 0.2, bh * 0.3, 0.8);
    c.win(c.x + c.w * 0.66, c.gy - bh * 0.78, c.w * 0.2, bh * 0.3, 0.55);
  },
  apartment(c) {
    c.rect(c.x, c.gy - c.h, c.w, c.h);
    c.top(c.x, c.gy - c.h - 1, c.w);
    c.rect(c.x + c.w * 0.3, c.gy - c.h - 3, c.w * 0.4, 3, shade(c.body, 0.1));
    c.grid(c.x, c.gy - c.h, c.w, c.h, 2.6, 3.2, 2.4, 3, 0.7, 16);
  },
  tower(c) {
    const bw = c.w * 0.82;
    const bx = c.x + (c.w - bw) / 2;
    c.rect(bx, c.gy - c.h * 0.86, bw, c.h * 0.86);
    c.rect(bx + bw * 0.2, c.gy - c.h, bw * 0.6, c.h * 0.15, shade(c.body, 0.08));
    c.top(bx, c.gy - c.h * 0.86 - 1, bw);
    c.rect(bx + bw / 2 - 0.6, c.gy - c.h - 12, 1.2, 12, c.edge, { opacity: c.edgeOp });
    c.grid(bx, c.gy - c.h * 0.86, bw, c.h * 0.86, 2.4, 3, 2.2, 3.4, 0.68, 20);
    c.glow(bx + bw / 2, c.gy - c.h - 12, 1.1, '#ff6b6b');
  },
  arcology(c) {
    const th = c.h * 0.78;
    const tw = c.w * 0.62;
    c.path(`M${f1(c.x)} ${f1(c.gy)} L${f1(c.x + (c.w - tw) / 2)} ${f1(c.gy - th)} L${f1(c.x + (c.w + tw) / 2)} ${f1(c.gy - th)} L${f1(c.x + c.w)} ${f1(c.gy)} Z`);
    c.path(`M${f1(c.x + (c.w - tw) / 2)} ${f1(c.gy - th)} A${f1(tw / 2)} ${f1(c.h - th)} 0 0 1 ${f1(c.x + (c.w + tw) / 2)} ${f1(c.gy - th)} Z`, shade(c.body, 0.16));
    c.top(c.x + (c.w - tw) / 2, c.gy - th - 1, tw);
    for (let i = 0; i < 6; i++) {
      const y = c.gy - th * 0.12 - i * (th * 0.14);
      const inset = (c.w - tw) / 2 * (1 - (c.gy - y) / th) + 3;
      c.win(c.x + inset, y, c.w - inset * 2, 1.8, 0.9);
    }
    c.glow(c.x + c.w / 2, c.gy - c.h + 4, 2, '#b8f0ff');
  },
  shop(c) {
    const bh = c.h * 0.85;
    c.rect(c.x, c.gy - bh, c.w, bh);
    c.rect(c.x + c.w * 0.2, c.gy - c.h, c.w * 0.6, c.h - bh + 1, shade(c.body, 0.18));
    c.rect(c.x - 1, c.gy - bh * 0.6, c.w + 2, 2.2, c.edge, { opacity: c.edgeOp });
    c.win(c.x + c.w * 0.12, c.gy - bh * 0.5, c.w * 0.5, bh * 0.4, 0.95);
    c.win(c.x + c.w * 0.68, c.gy - bh * 0.5, c.w * 0.18, bh * 0.4, 0.7);
    c.win(c.x + c.w * 0.25, c.gy - c.h + 1, c.w * 0.5, c.h - bh - 1, 0.8, '#ff9ad5');
  },
  office(c) {
    c.rect(c.x, c.gy - c.h, c.w, c.h);
    c.rect(c.x + c.w * 0.3, c.gy - c.h, c.w * 0.08, c.h, shade(c.body, 0.12));
    c.rect(c.x + c.w * 0.62, c.gy - c.h, c.w * 0.08, c.h, shade(c.body, 0.12));
    c.top(c.x, c.gy - c.h - 1, c.w);
    c.grid(c.x, c.gy - c.h, c.w, c.h, 3, 2.6, 2, 3, 0.75, 18);
  },
  mall(c) {
    const bh = c.h * 0.42;
    const mw = c.w * 1.5;
    const mx = c.x - (mw - c.w) / 2;
    c.rect(mx, c.gy - bh, mw, bh);
    c.rect(mx + mw * 0.32, c.gy - c.h * 0.62, mw * 0.36, c.h * 0.62 - bh + 1, shade(c.body, 0.08));
    c.top(mx, c.gy - bh - 1, mw);
    c.rect(mx + mw * 0.4, c.gy - c.h * 0.62 - 4, mw * 0.2, 4, c.edge, { opacity: c.edgeOp * 0.8 });
    c.win(mx + 3, c.gy - bh * 0.72, mw - 6, bh * 0.28, 0.98);
    c.win(mx + mw * 0.4, c.gy - c.h * 0.62 - 4, mw * 0.2, 3, 0.9, '#9fe8ff');
  },
  financial(c) {
    const bw = c.w * 0.72;
    const bx = c.x + (c.w - bw) / 2;
    const bh = c.h * 0.84;
    c.rect(bx, c.gy - bh, bw, bh);
    c.path(`M${f1(bx)} ${f1(c.gy - bh)} L${f1(bx + bw / 2)} ${f1(c.gy - c.h)} L${f1(bx + bw)} ${f1(c.gy - bh)} Z`, shade(c.body, 0.14));
    c.rect(bx + bw / 2 - 0.6, c.gy - c.h - 14, 1.2, 14, c.edge, { opacity: c.edgeOp });
    c.rect(bx + bw * 0.46, c.gy - bh, bw * 0.08, bh, shade(c.body, 0.1));
    c.grid(bx, c.gy - bh, bw, bh, 2.2, 2.6, 1.8, 2.6, 0.8, 24);
    c.glow(bx + bw / 2, c.gy - c.h - 14, 1.2, '#ff6b6b');
  },
  factory(c) {
    const bh = c.h * 0.5;
    c.rect(c.x, c.gy - bh, c.w, bh);
    const teeth = 3;
    const tw = c.w / teeth;
    let d = `M${f1(c.x)} ${f1(c.gy - bh)}`;
    for (let i = 0; i < teeth; i++) d += ` L${f1(c.x + i * tw)} ${f1(c.gy - bh - c.h * 0.16)} L${f1(c.x + (i + 1) * tw)} ${f1(c.gy - bh)}`;
    c.path(d + ' Z', shade(c.body, 0.14));
    const sx = c.x + c.w * 0.78;
    c.rect(sx, c.gy - c.h, c.w * 0.12, c.h, shade(c.body, -0.12));
    c.top(sx, c.gy - c.h - 1, c.w * 0.12);
    c.smoke(sx + c.w * 0.06, c.gy - c.h, c.w / 18);
    for (let i = 0; i < 3; i++) c.win(c.x + 2 + i * (c.w * 0.26), c.gy - bh * 0.7, c.w * 0.18, bh * 0.28, 0.6);
  },
  refinery(c) {
    const cw = c.w * 0.3;
    c.rect(c.x, c.gy - c.h * 0.48, cw, c.h * 0.48, c.body, { rx: 3 });
    c.rect(c.x + cw * 1.15, c.gy - c.h * 0.4, cw, c.h * 0.4, shade(c.body, 0.06), { rx: 3 });
    const sx = c.x + c.w * 0.8;
    c.rect(sx, c.gy - c.h, c.w * 0.07, c.h, shade(c.body, -0.1));
    c.rect(c.x + cw * 2.3, c.gy - c.h * 0.6, c.w * 0.05, c.h * 0.6, shade(c.body, 0.05));
    c.glow(sx + c.w * 0.035, c.gy - c.h - 1.5, 1.8, '#ffa54a');
    c.smoke(sx + c.w * 0.035, c.gy - c.h, c.w / 26);
    c.win(c.x + 2, c.gy - c.h * 0.3, cw - 4, 1.5, 0.8);
  },
  techpark(c) {
    const bh = c.h * 0.46;
    const bw = c.w * 1.35;
    const bx = c.x - (bw - c.w) / 2;
    c.rect(bx, c.gy - bh, bw, bh, c.body, { rx: 4 });
    c.rect(bx + bw * 0.55, c.gy - c.h * 0.7, bw * 0.3, c.h * 0.7 - bh + 2, shade(c.body, 0.08), { rx: 2 });
    c.top(bx + 2, c.gy - bh - 1, bw - 4);
    c.rect(bx + bw * 0.7, c.gy - c.h * 0.7 - 8, 1, 8, c.edge, { opacity: c.edgeOp });
    c.win(bx + 3, c.gy - bh * 0.75, bw * 0.5, bh * 0.5, 0.98, '#b8ecff');
    c.grid(bx + bw * 0.55, c.gy - c.h * 0.7, bw * 0.3, c.h * 0.7 - bh, 2.4, 2.2, 2, 2.4, 0.8, 8);
  },
  windmill(c) {
    const cx = c.x + c.w / 2;
    const ph = c.h * 1.15;
    c.path(`M${f1(cx - 1.6)} ${f1(c.gy)} L${f1(cx - 0.7)} ${f1(c.gy - ph)} L${f1(cx + 0.7)} ${f1(c.gy - ph)} L${f1(cx + 1.6)} ${f1(c.gy)} Z`, shade(c.body, 0.25));
    c.rect(cx - 1.4, c.gy - ph - 1.2, 2.8, 2.4, shade(c.body, 0.35), { rx: 1 });
    const blades = svg('g', { class: 'sk-blades' });
    const len = c.h * 0.42;
    for (let i = 0; i < 3; i++) {
      const r = svg('rect', { x: f1(-0.7), y: f1(-len), width: 1.4, height: f1(len), rx: 0.7, fill: shade(c.body, 0.55), transform: `rotate(${i * 120})` });
      blades.append(r);
    }
    blades.append(svg('circle', { cx: 0, cy: 0, r: 1.3, fill: shade(c.body, 0.6) }));
    blades.style.setProperty('--spin', `${(5.5 + c.rnd() * 3).toFixed(1)}s`);
    // The hub sits at the wrapper's origin so the CSS rotation composes with the placement.
    const wrap = svg('g', { transform: `translate(${f1(cx)} ${f1(c.gy - ph)})` });
    wrap.append(blades);
    c.fx(wrap);
  },
  coal(c) {
    const bh = c.h * 0.42;
    c.rect(c.x, c.gy - bh, c.w, bh);
    c.top(c.x, c.gy - bh - 1, c.w);
    for (const f of [0.58, 0.8]) {
      const sx = c.x + c.w * f;
      c.rect(sx, c.gy - c.h, c.w * 0.14, c.h, shade(c.body, -0.1));
      c.rect(sx - 0.5, c.gy - c.h, c.w * 0.14 + 1, 2, shade(c.body, 0.1));
      c.glow(sx + c.w * 0.07, c.gy - c.h - 1, 0.9, '#ff6b6b');
      c.smoke(sx + c.w * 0.07, c.gy - c.h, c.w / 16);
    }
    c.win(c.x + 3, c.gy - bh * 0.7, c.w * 0.4, bh * 0.3, 0.7);
  },
  solar(c) {
    const pw = c.w * 0.36;
    const ph = c.h * 0.32;
    const n = 4;
    const span = c.w * 1.5;
    const sx = c.x - (span - c.w) / 2;
    for (let i = 0; i < n; i++) {
      const px = sx + (i * span) / n;
      c.path(`M${f1(px)} ${f1(c.gy)} L${f1(px + pw * 0.3)} ${f1(c.gy - ph)} L${f1(px + pw * 1.1)} ${f1(c.gy - ph)} L${f1(px + pw * 0.8)} ${f1(c.gy)} Z`, mixHex(c.body, '#8fd6ff', 0.18));
      c.path(`M${f1(px + pw * 0.34)} ${f1(c.gy - ph + 1)} L${f1(px + pw * 1.04)} ${f1(c.gy - ph + 1)} L${f1(px + pw * 0.98)} ${f1(c.gy - ph + 2.2)} L${f1(px + pw * 0.3)} ${f1(c.gy - ph + 2.2)} Z`, '#cfefff', { opacity: 0.5 });
    }
  },
  nuclear(c) {
    const tw = c.w * 0.62;
    const tx = c.x + c.w * 0.36;
    const d = `M${f1(tx)} ${f1(c.gy)} C${f1(tx + tw * 0.28)} ${f1(c.gy - c.h * 0.5)} ${f1(tx + tw * 0.28)} ${f1(c.gy - c.h * 0.62)} ${f1(tx + tw * 0.18)} ${f1(c.gy - c.h)} L${f1(tx + tw * 0.82)} ${f1(c.gy - c.h)} C${f1(tx + tw * 0.72)} ${f1(c.gy - c.h * 0.62)} ${f1(tx + tw * 0.72)} ${f1(c.gy - c.h * 0.5)} ${f1(tx + tw)} ${f1(c.gy)} Z`;
    c.path(d, shade(c.body, 0.05));
    c.rect(tx + tw * 0.18, c.gy - c.h, tw * 0.64, 1.4, c.edge, { opacity: c.edgeOp * 0.7 });
    c.rect(c.x, c.gy - c.h * 0.3, c.w * 0.4, c.h * 0.3);
    c.rect(c.x + c.w * 0.1, c.gy - c.h * 0.42, c.w * 0.2, c.h * 0.12, shade(c.body, 0.08), { rx: 2 });
    c.glow(tx + tw * 0.5, c.gy - c.h - 1.5, 1.2, '#ff5c5c');
    c.win(c.x + 2, c.gy - c.h * 0.22, c.w * 0.36, 1.6, 0.9);
    if (!prefersReducedMotion() && c.depth === 2) c.smoke(tx + tw * 0.5, c.gy - c.h, c.w / 14);
  },
  fusion(c) {
    const r = c.w / 2;
    const cx = c.x + r;
    const dh = c.h * 0.7;
    c.path(`M${f1(c.x)} ${f1(c.gy)} A${f1(r)} ${f1(dh)} 0 0 1 ${f1(c.x + c.w)} ${f1(c.gy)} Z`, shade(c.body, 0.06));
    c.path(`M${f1(c.x + r * 0.25)} ${f1(c.gy - dh * 0.5)} A${f1(r * 0.75)} ${f1(dh * 0.5)} 0 0 1 ${f1(c.x + c.w - r * 0.25)} ${f1(c.gy - dh * 0.5)}`, 'none', { stroke: c.edge, 'stroke-width': 1, opacity: c.edgeOp * 0.7 });
    c.rect(cx - 1, c.gy - c.h, 2, c.h - dh + 2, shade(c.body, 0.2));
    c.glow(cx, c.gy - dh * 0.55, r * 0.22, '#9be7ff');
    const core = svg('circle', { cx: f1(cx), cy: f1(c.gy - dh * 0.55), r: f1(r * 0.42), fill: '#7fd9ff', class: 'sk-core' });
    c.fx(core);
    for (let i = 0; i < 4; i++) c.win(c.x + r * 0.35 + i * (r * 0.33), c.gy - dh * 0.18, r * 0.18, 1.6, 0.9, '#b8f0ff');
  },
  park(c) {
    const n = 2 + (c.rnd() < 0.5 ? 1 : 0);
    const span = c.w * 1.3;
    const sx = c.x - (span - c.w) / 2;
    for (let i = 0; i < n; i++) {
      const tx = sx + (i + 0.5) * (span / n);
      const th = c.h * (0.7 + c.rnd() * 0.5);
      const cr = c.w * (0.22 + c.rnd() * 0.1);
      const green = mixHex(mixHex(TREE, BASE, 0.35 + c.rnd() * 0.15), HAZE, DEPTH[c.depth].haze);
      c.rect(tx - 0.9, c.gy - th * 0.55, 1.8, th * 0.55, shade(c.body, -0.15));
      c.g.append(svg('circle', { cx: f1(tx), cy: f1(c.gy - th * 0.62), r: f1(cr), fill: green }));
      c.g.append(svg('circle', { cx: f1(tx - cr * 0.35), cy: f1(c.gy - th * 0.62 + cr * 0.25), r: f1(cr * 0.75), fill: shade(green, -0.12) }));
    }
    const lx = c.x + c.w * 0.92;
    c.rect(lx - 0.5, c.gy - c.h * 0.5, 1, c.h * 0.5, shade(c.body, 0.3));
    c.glow(lx, c.gy - c.h * 0.5 - 1, 1.3, '#ffe9a8');
  },
  school(c) {
    const bh = c.h * 0.55;
    const bw = c.w * 1.3;
    const bx = c.x - (bw - c.w) / 2;
    c.rect(bx, c.gy - bh, bw, bh);
    c.top(bx, c.gy - bh - 1, bw);
    const tx = bx + bw * 0.08;
    c.rect(tx, c.gy - c.h, bw * 0.16, c.h, shade(c.body, 0.08));
    c.path(`M${f1(tx - 1)} ${f1(c.gy - c.h)} L${f1(tx + bw * 0.08)} ${f1(c.gy - c.h - 6)} L${f1(tx + bw * 0.16 + 1)} ${f1(c.gy - c.h)} Z`, shade(c.body, 0.18));
    c.rect(tx + bw * 0.08 - 0.4, c.gy - c.h - 13, 0.8, 8, c.edge, { opacity: c.edgeOp });
    c.rect(tx + bw * 0.08, c.gy - c.h - 13, 4, 2.4, c.edge, { opacity: c.edgeOp });
    c.grid(bx + bw * 0.28, c.gy - bh, bw * 0.68, bh, 3, 2.6, 2.4, 3, 0.65, 12);
    c.win(tx + 1.5, c.gy - c.h * 0.85, bw * 0.16 - 3, 2, 0.7);
  },
  hospital(c) {
    c.rect(c.x, c.gy - c.h * 0.9, c.w, c.h * 0.9);
    c.rect(c.x + c.w * 0.32, c.gy - c.h * 0.9 - 3, c.w * 0.36, 3, shade(c.body, 0.1));
    c.top(c.x, c.gy - c.h * 0.9 - 1, c.w);
    const cx = c.x + c.w / 2;
    const cy = c.gy - c.h + 2;
    const s = Math.max(3, c.w * 0.16);
    c.rect(cx - s / 2, cy - s * 1.5, s, s * 3, '#ff7b7b');
    c.rect(cx - s * 1.5, cy - s / 2, s * 3, s, '#ff7b7b');
    c.lights.append(svg('rect', { x: f1(cx - s / 2), y: f1(cy - s * 1.5), width: f1(s), height: f1(s * 3), fill: '#ff8f8f' }));
    c.lights.append(svg('rect', { x: f1(cx - s * 1.5), y: f1(cy - s / 2), width: f1(s * 3), height: f1(s), fill: '#ff8f8f' }));
    c.grid(c.x, c.gy - c.h * 0.9 + s * 2, c.w, c.h * 0.9 - s * 2, 2.6, 2.8, 2.2, 3, 0.85, 18);
  },
  stadium(c) {
    const aw = c.w * 1.7;
    const ax = c.x - (aw - c.w) / 2;
    const ah = c.h * 0.55;
    c.path(`M${f1(ax)} ${f1(c.gy)} A${f1(aw / 2)} ${f1(ah)} 0 0 1 ${f1(ax + aw)} ${f1(c.gy)} Z`, shade(c.body, 0.02));
    c.path(`M${f1(ax + aw * 0.12)} ${f1(c.gy)} A${f1(aw * 0.38)} ${f1(ah * 0.72)} 0 0 1 ${f1(ax + aw * 0.88)} ${f1(c.gy)} Z`, shade(c.body, -0.2));
    c.path(`M${f1(ax)} ${f1(c.gy)} A${f1(aw / 2)} ${f1(ah)} 0 0 1 ${f1(ax + aw)} ${f1(c.gy)}`, 'none', { stroke: c.edge, 'stroke-width': 1.2, opacity: c.edgeOp * 0.8 });
    for (const f of [0.18, 0.82]) {
      const px = ax + aw * f;
      c.rect(px - 0.7, c.gy - c.h, 1.4, c.h, shade(c.body, 0.3));
      c.rect(px - 4, c.gy - c.h - 2, 8, 2.4, shade(c.body, 0.4), { rx: 1 });
      c.glow(px, c.gy - c.h - 1, 3.2, '#fff7d6');
      const beam = svg('path', { d: `M${f1(px - 4)} ${f1(c.gy - c.h)} L${f1(px + 4)} ${f1(c.gy - c.h)} L${f1(ax + aw / 2 + (f < 0.5 ? 12 : -12))} ${f1(c.gy - ah * 0.6)} Z`, fill: '#fff7d6', opacity: 0.09 });
      c.lights.append(beam);
    }
    for (let i = 0; i < 8; i++) c.win(ax + aw * 0.16 + i * (aw * 0.087), c.gy - ah * 0.42, aw * 0.05, 1.6, 0.85);
  },
};

// Fallbacks for unknown ids, by category, then a plain block.
const BY_CATEGORY = {
  residential: SHAPES.apartment,
  commercial: SHAPES.office,
  industrial: SHAPES.factory,
  power: SHAPES.coal,
  civic: SHAPES.school,
};
function block(c) {
  c.rect(c.x, c.gy - c.h, c.w, c.h);
  c.top(c.x, c.gy - c.h - 1, c.w);
  c.grid(c.x, c.gy - c.h, c.w, c.h, 2.6, 3, 2.4, 3, 0.7, 14);
}

// ---------- planning ----------
function plan(rows, colorOf) {
  const shapes = [];
  // A young town huddles around the center; the spread opens up as the city fills in.
  let total = 0;
  for (const b of rows) if (b.count > 0) total += silhouetteCount(b.count, clamp(b.tier | 0 || 1, 1, 4));
  const spreadScale = clamp(0.4 + total / 20, 0.4, 1);
  for (const b of rows) {
    if (!(b.count > 0)) continue;
    const tier = clamp(b.tier | 0 || 1, 1, 4);
    const n = silhouetteCount(b.count, tier);
    const grow = 1 + 0.22 * Math.min(1, Math.log10(b.count + 1) / 3);
    const base = hash(b.id);
    for (let i = 0; i < n; i++) {
      const rnd = prng((base + Math.imul(i + 1, 0x9e3779b1)) >>> 0);
      const [wMin, wMax, hMin, hMax] = SIZE[tier];
      const u = rnd();
      const r2 = rnd();
      // Tall tiers sit further back (distance), small ones mostly up front, some back for texture.
      // The first few buildings of a new plot all stand up front so they read crisply.
      const depth = total < 6 ? 2 : tier >= 3 ? (r2 < 0.55 ? 0 : 1) : tier === 2 ? (r2 < 0.3 ? 0 : r2 < 0.65 ? 1 : 2) : r2 < 0.2 ? 0 : r2 < 0.5 ? 1 : 2;
      shapes.push({
        id: b.id,
        cat: b.category,
        color: colorOf(b.category),
        tier,
        idx: i,
        depth,
        cx: W * (0.5 + (u - 0.5) * SPREAD[tier] * spreadScale),
        w: wMin + rnd() * (wMax - wMin),
        h: (hMin + rnd() * (hMax - hMin)) * grow,
        seed: (base ^ Math.imul(i + 7, 2654435761)) >>> 0,
      });
    }
  }
  if (shapes.length > MAX_SHAPES) {
    shapes.sort((a, b) => a.idx - b.idx);
    shapes.length = MAX_SHAPES;
  }
  // Back rows first; within a row taller first so short fronts overlap.
  shapes.sort((a, b) => a.depth - b.depth || b.h - a.h);
  return shapes;
}

// ---------- landmarks ----------
// One-off set pieces unlocked by owning an upgrade. Each entry: which depth row it lives in,
// whether it goes under (`behind`) or over the buildings of that row, and a draw function that
// receives a light-weight context { g, lights, rnd, motion, rect, path, win, glow, fx }.
// Keyed by upgrade id; `ui.test.mjs` asserts every key is a real upgrade so a rename can't
// silently orphan a set piece.
export const LANDMARKS = {
  // A roadside billboard on two posts at the town's edge.
  'welcome-sign': {
    depth: 2,
    draw(c) {
      const x = 22;
      const y = GROUND - 30;
      c.rect(x + 3, y + 12, 1.6, GROUND - y - 12, '#22284a');
      c.rect(x + 27, y + 12, 1.6, GROUND - y - 12, '#22284a');
      c.rect(x, y, 32, 13, '#f3e7c5', { rx: 1 });
      c.rect(x + 1, y + 1, 30, 11, '#2b3a7a', { rx: 0.6 });
      const t = svg('text', { x: f1(x + 16), y: f1(y + 9.2), 'text-anchor': 'middle', 'font-size': 6.4, 'font-weight': 700, 'font-family': 'var(--font)', fill: '#fff2c8', 'letter-spacing': 0.4 });
      t.textContent = 'WELCOME';
      c.g.append(t);
      c.glow(x + 16, y + 6.5, 12, '#ffe4a0', 'sk-sign-glow');
    },
  },
  // Neon strip along the strip: three pulsing tubes in the front row.
  'neon-signage': {
    depth: 2,
    draw(c) {
      const colors = ['#ff4fa3', '#37e6ff', '#ffe14a'];
      for (let i = 0; i < 3; i++) {
        const x = 300 + i * 46 + c.rnd() * 10;
        const y = GROUND - 32 - c.rnd() * 18;
        c.rect(x, y, 14, 4.5, '#1a1f3d', { rx: 1 });
        c.rect(x + 6.5, y + 4.5, 1, GROUND - y - 4.5, '#1a1f3d');
        const tube = svg('rect', { x: f1(x + 1.5), y: f1(y + 1.5), width: 11, height: 1.5, rx: 0.75, fill: colors[i], class: 'sk-neon' });
        tube.style.setProperty('--delay', `${(-i * 0.9).toFixed(1)}s`);
        c.lights.append(tube);
        c.glow(x + 7, y + 2.2, 7, colors[i], 'sk-neon-glow');
      }
    },
  },
  // Green belts: a hedgerow of round trees along the front of the plot.
  'green-belts': {
    depth: 2,
    behind: true,
    draw(c) {
      for (let i = 0; i < 16; i++) {
        const x = 8 + i * 30 + c.rnd() * 12;
        const r = 3 + c.rnd() * 2.2;
        c.rect(x - 0.6, GROUND - r * 1.6, 1.2, r * 1.6, '#2a3a2e');
        c.g.append(svg('circle', { cx: f1(x), cy: f1(GROUND - r * 1.7), r: f1(r), fill: mixHex(TREE, '#1d3f36', 0.25 + c.rnd() * 0.3) }));
      }
    },
  },
  // Elevated monorail across the mid row with a train that glides through.
  'express-transit': {
    depth: 1,
    draw(c) {
      const y = GROUND - 44;
      for (let x = 30; x < W; x += 60) c.rect(x - 1.2, y + 2, 2.4, GROUND - y - 2, '#1c2244');
      c.rect(0, y, W, 2.4, '#2c3568');
      c.rect(0, y - 0.8, W, 0.8, '#5c6ab3', { opacity: 0.8 });
      const train = svg('g', { class: 'sk-train' });
      for (let k = 0; k < 3; k++) {
        train.append(svg('rect', { x: f1(k * 15), y: f1(y - 6.5), width: 14, height: 6, rx: 1.6, fill: '#d8e2ff' }));
        for (let w = 0; w < 4; w++) train.append(svg('rect', { x: f1(k * 15 + 1.8 + w * 3.1), y: f1(y - 5), width: 2, height: 2.2, fill: '#3d64c9', opacity: 0.85 }));
      }
      train.append(svg('rect', { x: 0, y: f1(y - 3.6), width: 1.6, height: 1.4, fill: '#ffd98a' }));
      if (!c.motion) train.setAttribute('transform', 'translate(180 0)');
      c.fx(train);
    },
  },
  // A dockside gantry crane and stacked containers at the right-hand edge.
  'container-port': {
    depth: 0,
    draw(c) {
      const x = W - 92;
      const h = 58;
      c.rect(x + 4, GROUND - h, 2.2, h, '#2a3260');
      c.rect(x + 42, GROUND - h, 2.2, h, '#2a3260');
      c.rect(x - 8, GROUND - h - 2, 70, 2.4, '#3a4478');
      c.rect(x + 20, GROUND - h - 1, 6, 4, '#3a4478');
      c.rect(x + 22.5, GROUND - h + 2, 1, 22, '#4b5691');
      c.rect(x + 18, GROUND - h + 24, 10, 4.5, '#ef7a3a');
      const cols = ['#ef7a3a', '#3d8ef0', '#39b26f', '#e0c341'];
      for (let i = 0; i < 6; i++) {
        const cx = x - 6 + i * 11;
        const stack = 1 + Math.floor(c.rnd() * 3);
        for (let k = 0; k < stack; k++) c.rect(cx, GROUND - 5 * (k + 1), 10, 4.5, cols[(i + k) % 4], { rx: 0.4 });
      }
      c.glow(x + 23, GROUND - h - 3, 1.4, '#ff6b6b', 'sk-beacon');
    },
  },
  // A slowly turning ferris wheel for the tourists.
  'tourism-board': {
    depth: 1,
    draw(c) {
      const cx = 92;
      const r = 24;
      const cy = GROUND - r - 8;
      c.path(`M${f1(cx - 14)} ${f1(GROUND)} L${f1(cx)} ${f1(cy)} L${f1(cx + 14)} ${f1(GROUND)} Z`, '#2a3260');
      const wheel = svg('g', { class: 'sk-wheel' });
      wheel.append(svg('circle', { cx: 0, cy: 0, r, fill: 'none', stroke: '#8a93c9', 'stroke-width': 1.4 }));
      wheel.append(svg('circle', { cx: 0, cy: 0, r: r * 0.62, fill: 'none', stroke: '#8a93c9', 'stroke-width': 0.8, opacity: 0.7 }));
      const cars = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#f78fd0', '#ffa552'];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        wheel.append(svg('line', { x1: 0, y1: 0, x2: f1(Math.cos(a) * r), y2: f1(Math.sin(a) * r), stroke: '#8a93c9', 'stroke-width': 0.7 }));
        wheel.append(svg('rect', { x: f1(Math.cos(a) * r - 2.2), y: f1(Math.sin(a) * r - 1.6), width: 4.4, height: 3.6, rx: 1, fill: cars[i % 6] }));
      }
      wheel.append(svg('circle', { cx: 0, cy: 0, r: 2.4, fill: '#c7cdf2' }));
      wheel.style.setProperty('--spin', '48s');
      const wrap = svg('g', { transform: `translate(${cx} ${f1(cy)})` });
      wrap.append(wheel);
      c.fx(wrap);
      c.glow(cx, cy, r + 3, '#ffd166', 'sk-wheel-glow');
    },
  },
  // Control tower with a beacon and a small plane on approach across the sky.
  'regional-airport': {
    depth: 0,
    draw(c) {
      const x = 34;
      c.rect(x, GROUND - 54, 6, 54, '#2a3260');
      c.path(`M${f1(x - 6)} ${f1(GROUND - 54)} L${f1(x + 12)} ${f1(GROUND - 54)} L${f1(x + 10)} ${f1(GROUND - 66)} L${f1(x - 4)} ${f1(GROUND - 66)} Z`, '#3a4478');
      c.win(x - 3, GROUND - 64, 12, 6, 1, '#b8ecff');
      c.glow(x + 3, GROUND - 68, 1.6, '#ff6b6b', 'sk-beacon');
      const plane = svg('g', { class: 'sk-plane' });
      plane.append(svg('path', { d: 'M0 0 L14 0 L17 1.4 L14 2.8 L0 2.8 L-3 1.4 Z', fill: '#e6ecff' }));
      plane.append(svg('path', { d: 'M5 1.4 L9 -4 L11 -4 L8.5 1.4 Z', fill: '#c3ccf5' }));
      plane.append(svg('path', { d: 'M5 1.4 L9 6.5 L11 6.5 L8.5 1.4 Z', fill: '#aeb8ea' }));
      plane.append(svg('circle', { cx: 16.5, cy: 1.4, r: 0.9, fill: '#ff6b6b', class: 'sk-beacon' }));
      if (!c.motion) plane.setAttribute('transform', 'translate(300 40)');
      c.fx(plane);
    },
  },
  // Transmission pylons strung across the back row.
  'grid-substations': {
    depth: 0,
    behind: true,
    draw(c) {
      const xs = [70, 190, 310, 430];
      const top = GROUND - 78;
      for (const x of xs) {
        c.path(`M${f1(x - 7)} ${f1(GROUND)} L${f1(x - 1.6)} ${f1(top)} L${f1(x + 1.6)} ${f1(top)} L${f1(x + 7)} ${f1(GROUND)} Z`, '#3a4478');
        c.rect(x - 9, top + 8, 18, 1.2, '#3a4478');
        c.rect(x - 6, top + 18, 12, 1.2, '#3a4478');
      }
      const sag = 9;
      const d = xs.slice(0, -1).map((x, i) => `M${f1(x - 9)} ${f1(top + 8)} Q ${f1((x + xs[i + 1]) / 2)} ${f1(top + 8 + sag)} ${f1(xs[i + 1] - 9)} ${f1(top + 8)}`).join(' ');
      c.g.append(svg('path', { d, fill: 'none', stroke: '#5c6ab3', 'stroke-width': 0.6, opacity: 0.8 }));
    },
  },
  // A satellite glinting as it crosses the night sky.
  'orbital-solar': {
    depth: 0,
    draw(c) {
      const sat = svg('g', { class: 'sk-sat' });
      sat.append(svg('rect', { x: -7, y: -1, width: 5, height: 2, fill: '#5aa0ff', opacity: 0.9 }));
      sat.append(svg('rect', { x: 2, y: -1, width: 5, height: 2, fill: '#5aa0ff', opacity: 0.9 }));
      sat.append(svg('rect', { x: -1.2, y: -1.4, width: 2.4, height: 2.8, rx: 0.5, fill: '#e6ecff' }));
      if (!c.motion) sat.setAttribute('transform', 'translate(360 40)');
      c.fx(sat);
    },
  },
  // The ringworld: a vast pale arc spanning the sky behind everything.
  'ringworld-district': {
    depth: 0,
    behind: true,
    draw(c) {
      const d = `M-40 ${GROUND + 20} Q ${W / 2} -150 ${W + 40} ${GROUND + 20}`;
      c.g.append(svg('path', { d, fill: 'none', stroke: '#c9d3ff', 'stroke-width': 4, opacity: 0.22 }));
      c.g.append(svg('path', { d, fill: 'none', stroke: '#eef2ff', 'stroke-width': 1.2, opacity: 0.35 }));
      c.lights.append(svg('path', { d, fill: 'none', stroke: '#9fb4ff', 'stroke-width': 1.6, opacity: 0.6 }));
    },
  },
};

function drawLandmarks(ownedUpgrades, layers, rows, lightRows) {
  const motion = !prefersReducedMotion();
  for (const id of ownedUpgrades) {
    const lm = LANDMARKS[id];
    if (!lm) continue;
    const g = svg('g', { class: 'sk-lm', 'data-landmark': id });
    const lights = svg('g');
    const rnd = prng(hash(id));
    const c = {
      g,
      lights,
      rnd,
      motion,
      rect(rx, ry, rw, rh, fill, extra = null) {
        g.append(svg('rect', { x: f1(rx), y: f1(ry), width: f1(Math.max(0.5, rw)), height: f1(Math.max(0.5, rh)), fill, ...(extra || {}) }));
      },
      path(d, fill, extra = null) {
        g.append(svg('path', { d, fill, ...(extra || {}) }));
      },
      win(wx, wy, ww, wh, prob = 1, color = '#ffd98a') {
        if (rnd() > prob) return;
        lights.append(svg('rect', { x: f1(wx), y: f1(wy), width: f1(ww), height: f1(wh), fill: color, opacity: 0.85 }));
      },
      glow(cx, cy, r, color, cls = '') {
        lights.append(svg('circle', { cx: f1(cx), cy: f1(cy), r: f1(r), fill: color, class: cls || null }));
      },
      fx(el) {
        layers.fx.append(el);
      },
    };
    lm.draw(c);
    if (lm.behind) rows[lm.depth].prepend(g);
    else rows[lm.depth].append(g);
    if (lights.childNodes.length) lightRows[lm.depth].append(lights);
  }
}

// ---------- component ----------
export function createSkyline(host, ui) {
  const mk = (cls) => svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMax slice', class: `skyline ${cls}`, 'aria-hidden': 'true' });
  const sky = mk('sk-sky');
  const city = mk('sk-city');
  const fx = mk('sk-fx');

  // --- sky ---
  const defs = svg('defs');
  defs.innerHTML = `
    <linearGradient id="sk-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2456a8"/><stop offset="0.55" stop-color="#5f97d8"/><stop offset="1" stop-color="#b9d5ee"/>
    </linearGradient>
    <linearGradient id="sk-warm" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff9a5c" stop-opacity="0"/><stop offset="1" stop-color="#ff9a5c" stop-opacity="0.9"/>
    </linearGradient>
    <radialGradient id="sk-sun"><stop offset="0" stop-color="#fff6d0"/><stop offset="0.35" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff9d4d" stop-opacity="0"/></radialGradient>
    <radialGradient id="sk-moon"><stop offset="0" stop-color="#f1f4ff"/><stop offset="0.5" stop-color="#d8def7"/><stop offset="1" stop-color="#b7c1ea" stop-opacity="0"/></radialGradient>
    <linearGradient id="sk-ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0e1530"/><stop offset="1" stop-color="#070a12"/>
    </linearGradient>`;
  sky.append(defs);
  const stops = Array.from(defs.querySelectorAll('#sk-grad stop'));
  sky.append(svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#sk-grad)' }));
  const warm = svg('rect', { x: 0, y: GROUND - 110, width: W, height: 110, fill: 'url(#sk-warm)', opacity: 0 });
  sky.append(warm);

  const stars = svg('g', { opacity: 0 });
  const srnd = prng(777);
  for (let i = 0; i < 46; i++) {
    const r = srnd() < 0.15 ? 0.9 : 0.55;
    stars.append(svg('circle', { cx: f1(srnd() * W), cy: f1(srnd() * GROUND * 0.7), r, fill: '#ffffff', opacity: (0.35 + srnd() * 0.65).toFixed(2) }));
  }
  sky.append(stars);
  const sun = svg('circle', { r: 26, fill: 'url(#sk-sun)', opacity: 0 });
  const moon = svg('circle', { r: 13, fill: 'url(#sk-moon)', opacity: 0 });
  sky.append(sun, moon);

  const clouds = svg('g', { class: 'sk-clouds' });
  const crnd = prng(4242);
  const CLOUDS = [
    { y: 34, s: 1.15, o: 0.3, dur: 210 },
    { y: 62, s: 0.8, o: 0.22, dur: 150 },
    { y: 48, s: 1.35, o: 0.26, dur: 260 },
    { y: 84, s: 0.65, o: 0.18, dur: 120 },
    { y: 22, s: 0.9, o: 0.2, dur: 180 },
  ];
  CLOUDS.forEach((cd, i) => {
    const g = svg('g', { class: 'sk-cloud', opacity: cd.o });
    const puffs = 3 + Math.floor(crnd() * 2);
    for (let k = 0; k < puffs; k++) {
      g.append(svg('ellipse', { cx: f1(k * 14 * cd.s), cy: f1(cd.y - (k % 2) * 3 * cd.s), rx: f1((10 + crnd() * 8) * cd.s), ry: f1((5 + crnd() * 3) * cd.s), fill: 'var(--sk-cloud, #fff)' }));
    }
    if (prefersReducedMotion()) g.setAttribute('transform', `translate(${f1(20 + i * 95)} 0)`);
    else {
      g.style.setProperty('--dur', `${cd.dur}s`);
      g.style.setProperty('--delay', `${(-cd.dur * (0.12 + i * 0.19)).toFixed(0)}s`);
    }
    clouds.append(g);
  });
  sky.append(clouds);

  // --- city ---
  // Hills: a daytime blue underneath, the night indigo on top fading in with the dark.
  const farHill = `M0 ${GROUND - 30} C 70 ${GROUND - 62}, 130 ${GROUND - 26}, 210 ${GROUND - 48} S 370 ${GROUND - 70}, ${W} ${GROUND - 34} V ${GROUND} H 0 Z`;
  const nearHill = `M0 ${GROUND - 18} C 90 ${GROUND - 34}, 160 ${GROUND - 12}, 250 ${GROUND - 26} S 400 ${GROUND - 40}, ${W} ${GROUND - 16} V ${GROUND} H 0 Z`;
  city.append(svg('path', { d: farHill, fill: '#3b5aa6', opacity: 0.9 }), svg('path', { d: nearHill, fill: '#2b4287' }));
  const hillsNight = svg('g', { opacity: 0 });
  hillsNight.append(svg('path', { d: farHill, fill: '#182452', opacity: 0.85 }), svg('path', { d: nearHill, fill: '#121b40' }));
  city.append(hillsNight);
  const rows = [svg('g', { class: 'sk-row-back' }), svg('g', { class: 'sk-row-mid' }), svg('g', { class: 'sk-row-front' })];
  city.append(...rows);
  city.append(svg('rect', { x: 0, y: GROUND, width: W, height: H - GROUND, fill: 'url(#sk-ground)' }));
  city.append(svg('rect', { x: 0, y: GROUND, width: W, height: 1.5, fill: '#ffffff', opacity: 0.12 }));
  city.append(svg('rect', { x: 0, y: GROUND + 9, width: W, height: 7, fill: '#0a0e1d' }));
  city.append(svg('path', { d: `M0 ${GROUND + 12.5} H ${W}`, stroke: '#3b4470', 'stroke-width': 0.8, 'stroke-dasharray': '6 5', opacity: 0.6 }));
  const nightRect = svg('rect', { x: 0, y: 0, width: W, height: H, fill: '#03061a', opacity: 0 });
  city.append(nightRect);
  const lights = svg('g', { class: 'sk-lights', opacity: 0 });
  city.append(lights);
  const lamps = svg('g');
  for (let i = 0; i < 9; i++) lamps.append(svg('circle', { cx: f1(26 + i * 53.5), cy: GROUND + 5, r: 1.1, fill: '#ffe4a0', opacity: 0.85 }));
  const lampsGlow = svg('g');
  for (let i = 0; i < 9; i++) lampsGlow.append(svg('ellipse', { cx: f1(26 + i * 53.5), cy: GROUND + 9, rx: 9, ry: 3.5, fill: '#ffe4a0', opacity: 0.08 }));

  const emptyLabel = svg('text', { x: W / 2, y: GROUND - 26, 'text-anchor': 'middle', class: 'skyline-empty' });
  emptyLabel.textContent = 'An empty plot. Build a cottage to break ground.';
  const plot = svg('rect', { x: W / 2 - 70, y: GROUND - 8, width: 140, height: 8, rx: 2, fill: 'none', stroke: 'rgba(255,255,255,0.3)', 'stroke-dasharray': '4 4' });
  const survey = svg('g', { class: 'sk-survey' });
  survey.append(plot, emptyLabel);
  city.append(survey);

  host.append(sky, city, fx);

  // --- rebuild on count change ---
  let signature = '';
  function update(list, upgradeIds) {
    const owned = (list || []).filter((b) => b && b.count > 0);
    const marks = (upgradeIds || []).filter((id) => LANDMARKS[id]);
    const sig = owned.map((b) => b.id + ':' + b.count).join('|') + '#' + marks.join('|');
    if (sig === signature) return;
    signature = sig;
    for (const r of rows) clear(r);
    clear(lights);
    clear(fx);
    const empty = owned.length === 0;
    survey.style.display = empty ? '' : 'none';
    if (empty) return;
    const colorOf = (cat) => ui.content.category(cat).color;
    const budget = { windows: MAX_WINDOWS, smoke: MAX_SMOKE };
    const lightRows = [svg('g'), svg('g'), svg('g')];
    for (const shape of plan(owned, colorOf)) {
      const ctx = makeCtx(shape, { fx }, budget);
      const draw = SHAPES[shape.id] || BY_CATEGORY[shape.cat] || block;
      draw(ctx);
      rows[shape.depth].append(ctx.g);
      if (ctx.lights.childNodes.length) lightRows[shape.depth].append(ctx.lights);
    }
    drawLandmarks(marks, { fx }, rows, lightRows);
    lightRows[0].setAttribute('opacity', 0.55);
    lightRows[1].setAttribute('opacity', 0.8);
    lights.append(lampsGlow, ...lightRows, lamps);
  }

  // --- day/night ---
  let phase = START_PHASE;
  let acc = TINT_EVERY; // write immediately on first tick
  let lastKey = '';
  function apply(p) {
    const c = skyAt(p);
    stops[0].setAttribute('stop-color', c.top);
    stops[1].setAttribute('stop-color', c.mid);
    stops[2].setAttribute('stop-color', c.hor);
    warm.setAttribute('opacity', (c.warm * 0.42).toFixed(3));
    nightRect.setAttribute('opacity', (c.night * 0.58).toFixed(3));
    hillsNight.setAttribute('opacity', smooth(clamp(c.night * 1.4, 0, 1)).toFixed(3));
    const lit = smooth(clamp((c.night - 0.2) / 0.5, 0, 1));
    lights.setAttribute('opacity', lit.toFixed(3));
    stars.setAttribute('opacity', Math.pow(c.night, 1.6).toFixed(3));
    host.style.setProperty('--sk-cloud', c.cloud);
    host.style.setProperty('--sk-night', c.night.toFixed(3));
    // Sun: up between 0.20 and 0.76. Moon: up between 0.74 and 1.22 (wrapping).
    const su = (p - 0.2) / 0.56;
    if (su > 0 && su < 1) {
      sun.setAttribute('cx', f1(-20 + su * (W + 40)));
      sun.setAttribute('cy', f1(GROUND - 6 - Math.sin(su * Math.PI) * 150));
      sun.setAttribute('opacity', Math.min(1, Math.sin(su * Math.PI) * 2 + 0.15).toFixed(3));
    } else sun.setAttribute('opacity', 0);
    const mu = (((p - 0.74) % 1) + 1) % 1 / 0.48;
    if (mu < 1) {
      moon.setAttribute('cx', f1(W + 20 - mu * (W + 40)));
      moon.setAttribute('cy', f1(GROUND - 20 - Math.sin(mu * Math.PI) * 120));
      moon.setAttribute('opacity', Math.min(1, Math.sin(mu * Math.PI) * 2).toFixed(3));
    } else moon.setAttribute('opacity', 0);
  }

  function tick(dt) {
    if (!(dt > 0)) return;
    phase = (phase + dt / DAY_SEC) % 1;
    acc += dt;
    if (acc < TINT_EVERY) return;
    acc = 0;
    const key = phase.toFixed(4);
    if (key === lastKey) return;
    lastKey = key;
    apply(phase);
  }

  function setPhase(p) {
    if (!Number.isFinite(p)) return;
    phase = ((p % 1) + 1) % 1;
    acc = 0;
    lastKey = '';
    apply(phase);
  }

  apply(phase);
  return { el: city, update, tick, setPhase, phase: () => phase };
}
