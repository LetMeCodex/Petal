import { el, row, chips, actions, number, ICONS } from '../ui.js';

const RATIOS = [
  { value: null, label: 'Free' },
  { value: 'orig', label: 'Original' },
  { value: 1, label: '1:1' },
  { value: 4 / 3, label: '4:3' },
  { value: 3 / 2, label: '3:2' },
  { value: 16 / 9, label: '16:9' },
  { value: 9 / 16, label: '9:16' },
  { value: 4 / 5, label: '4:5' },
];
const GRAB = 10;    // handle hit radius, screen px
const MIN = 8;      // smallest crop, image px
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', new: 'crosshair' };

let api, img, W, H, rect, ratio = null, drag = null, ratioChips, wIn, hIn;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function reset() {
  rect = { x: 0, y: 0, w: W, h: H };
  if (ratio) fitRatio();
}

// Largest rect of the current ratio that fits the image, centred where the crop is now.
function fitRatio() {
  const w = Math.min(W, H * ratio), h = w / ratio;
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  rect = { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h };
}

function hit(p) {
  const tol = GRAB / api.view.scale;
  const { x, y, w, h } = rect;
  const nearL = Math.abs(p.x - x) < tol, nearR = Math.abs(p.x - (x + w)) < tol;
  const nearT = Math.abs(p.y - y) < tol, nearB = Math.abs(p.y - (y + h)) < tol;
  const inX = p.x > x - tol && p.x < x + w + tol, inY = p.y > y - tol && p.y < y + h + tol;
  if (nearT && nearL) return 'nw';
  if (nearT && nearR) return 'ne';
  if (nearB && nearL) return 'sw';
  if (nearB && nearR) return 'se';
  if (nearT && inX) return 'n';
  if (nearB && inX) return 's';
  if (nearL && inY) return 'w';
  if (nearR && inY) return 'e';
  if (p.x > x && p.x < x + w && p.y > y && p.y < y + h) return 'move';
  return 'new';
}

function resize(handle, o, dx, dy) {
  const hasW = handle.includes('w'), hasE = handle.includes('e'), hasN = handle.includes('n'), hasS = handle.includes('s');
  let l = o.x, t = o.y, r = o.x + o.w, b = o.y + o.h;
  if (hasW) l += dx;
  if (hasE) r += dx;
  if (hasN) t += dy;
  if (hasS) b += dy;
  l = clamp(l, 0, W); r = clamp(r, 0, W); t = clamp(t, 0, H); b = clamp(b, 0, H);

  if (!ratio) return { x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) };

  if ((hasW || hasE) && (hasN || hasS)) {
    // Corner: the opposite corner stays put; the dragged one follows the larger of the two moves.
    const ax = hasW ? o.x + o.w : o.x, ay = hasN ? o.y + o.h : o.y;
    const hx = hasW ? l : r, hy = hasN ? t : b;
    const sx = Math.sign(hx - ax) || (hasW ? -1 : 1), sy = Math.sign(hy - ay) || (hasN ? -1 : 1);
    let w = Math.abs(hx - ax), h = Math.abs(hy - ay);
    if (w / ratio >= h) h = w / ratio; else w = h * ratio;
    const s = Math.min(1, (sx > 0 ? W - ax : ax) / w, (sy > 0 ? H - ay : ay) / h);
    w *= s; h *= s;
    return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
  }
  if (hasW || hasE) {
    let w = Math.abs(r - l), h = w / ratio;
    if (h > H) { h = H; w = h * ratio; }
    const y = clamp(o.y + o.h / 2 - h / 2, 0, H - h);
    return { x: hasW ? o.x + o.w - w : o.x, y, w, h };
  }
  let h = Math.abs(b - t), w = h * ratio;
  if (w > W) { w = W; h = w / ratio; }
  const x = clamp(o.x + o.w / 2 - w / 2, 0, W - w);
  return { x, y: hasN ? o.y + o.h - h : o.y, w, h };
}

function sync() {
  wIn.set(rect.w);
  hIn.set(rect.h);
  api.setMeta(`${Math.round(rect.w)} × ${Math.round(rect.h)} px  ·  original ${W} × ${H}`);
  api.render();
}

export default {
  title: 'Crop',
  saveLabel: 'Crop',

  init(a) {
    api = a; img = a.img; W = img.naturalWidth; H = img.naturalHeight;
    reset();
    ratioChips = chips(RATIOS, null, (v) => {
      ratio = v === 'orig' ? W / H : v;
      if (ratio) fitRatio();
      sync();
    });
    wIn = number({ value: W, max: W, label: 'Crop width' }, (w) => {
      rect.w = Math.min(w, W);
      if (ratio) rect.h = Math.min(rect.w / ratio, H), rect.w = rect.h * ratio;
      rect.x = clamp(rect.x, 0, W - rect.w); rect.y = clamp(rect.y, 0, H - rect.h);
      sync();
    });
    hIn = number({ value: H, max: H, label: 'Crop height' }, (h) => {
      rect.h = Math.min(h, H);
      if (ratio) rect.w = Math.min(rect.h * ratio, W), rect.h = rect.w / ratio;
      rect.x = clamp(rect.x, 0, W - rect.w); rect.y = clamp(rect.y, 0, H - rect.h);
      sync();
    });
    api.controls.append(
      row('Aspect ratio', ratioChips.el),
      row('Size', el('div', { class: 'num' }, wIn.el, el('span', {}, '×'), hIn.el, el('span', {}, 'px'),
        actions([{ icon: ICONS.reset, label: 'Reset', title: 'Reset crop', onClick: () => { ratio = null; ratioChips.set(null); reset(); sync(); } }]))),
    );
    sync();
  },

  pointer(type, p) {
    if (type === 'hover') return api.setCursor(CURSORS[hit(p)]);
    if (type === 'down') {
      const handle = hit(p);
      if (handle === 'new') {
        const x = clamp(p.x, 0, W), y = clamp(p.y, 0, H);
        drag = { handle: 'se', start: { x, y }, orig: { x, y, w: 0, h: 0 } };
      } else {
        drag = { handle, start: p, orig: { ...rect } };
      }
      return;
    }
    if (!drag) return;
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (drag.handle === 'move') {
      rect = { ...drag.orig, x: clamp(drag.orig.x + dx, 0, W - drag.orig.w), y: clamp(drag.orig.y + dy, 0, H - drag.orig.h) };
    } else {
      const next = resize(drag.handle, drag.orig, dx, dy);
      if (next.w >= 1 && next.h >= 1) rect = next;
    }
    if (type === 'up') {
      if (rect.w < MIN || rect.h < MIN) rect = { ...drag.orig, w: Math.max(drag.orig.w, MIN), h: Math.max(drag.orig.h, MIN) };
      drag = null;
    }
    sync();
  },

  render({ ctx, fit, applyView }) {
    const { scale, ox, oy } = fit(W, H);
    ctx.save();
    applyView();
    ctx.drawImage(img, 0, 0);
    ctx.restore();

    // Everything below is in screen px so lines stay crisp at any zoom.
    const x = ox + rect.x * scale, y = oy + rect.y * scale, w = rect.w * scale, h = rect.h * scale;
    ctx.fillStyle = 'rgba(10, 14, 18, 0.62)';
    ctx.beginPath();
    ctx.rect(ox, oy, W * scale, H * scale);
    ctx.rect(x, y, w, h);
    ctx.fill('evenodd');

    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) {
      ctx.moveTo(x + w * f, y); ctx.lineTo(x + w * f, y + h);
      ctx.moveTo(x, y + h * f); ctx.lineTo(x + w, y + h * f);
    }
    ctx.stroke();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    const L = Math.min(18, w / 3, h / 3);
    ctx.strokeStyle = '#e6ecef';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.moveTo(cx + sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * L);
    }
    ctx.stroke();
  },

  export(source) {
    const c = document.createElement('canvas');
    c.width = Math.round(rect.w);
    c.height = Math.round(rect.h);
    c.getContext('2d').drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    return c;
  },
};
