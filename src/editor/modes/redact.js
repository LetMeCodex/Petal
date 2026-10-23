import { el, row, cols, chips, slider, actions, ICONS } from '../ui.js';

const TOOLS = [
  { value: 'box', icon: ICONS.box, label: 'Black box' },
  { value: 'pixel', icon: ICONS.pixel, label: 'Pixelate' },
  { value: 'blur', icon: ICONS.blur, label: 'Blur' },
];
const HINTS = {
  box: 'Black box fully removes what is underneath. Safest for passwords, card numbers and IDs.',
  pixel: 'Pixelate hides detail, but short text can sometimes be guessed back. Use Black box for secrets.',
  blur: 'Blur looks soft but is the easiest to reverse. Use Black box for secrets.',
};

let api, img, W, H, M;
let tool = 'box', strength = 6;
let regions = [], redoStack = [], current = null, hintEl;
let composite; // full-resolution result, rebuilt only when regions change

function apply(ctx, r) {
  const { x, y, w, h } = r;
  if (w < 1 || h < 1) return;
  if (r.tool === 'box') {
    ctx.fillStyle = '#111';
    ctx.fillRect(x, y, w, h);
  } else if (r.tool === 'pixel') {
    const block = Math.max(4, Math.round(M * 0.0035 * r.strength));
    const tw = Math.max(1, Math.ceil(w / block)), th = Math.max(1, Math.ceil(h / block));
    const tiny = document.createElement('canvas');
    tiny.width = tw; tiny.height = th;
    tiny.getContext('2d').drawImage(img, x, y, w, h, 0, 0, tw, th);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, tw, th, x, y, w, h);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.filter = `blur(${Math.max(2, M * 0.0025 * r.strength)}px)`;
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
}

function rebuild() {
  composite = document.createElement('canvas');
  composite.width = W; composite.height = H;
  const ctx = composite.getContext('2d');
  ctx.drawImage(img, 0, 0);
  for (const r of regions) apply(ctx, r);
  api.setMeta(regions.length ? `${regions.length} area${regions.length > 1 ? 's' : ''} hidden  ·  Ctrl+Z to undo` : 'Drag over anything you want to hide');
  api.render();
}

const normal = (a, b) => ({ x: Math.max(0, Math.min(a.x, b.x)), y: Math.max(0, Math.min(a.y, b.y)), w: Math.min(W, Math.max(a.x, b.x)) - Math.max(0, Math.min(a.x, b.x)), h: Math.min(H, Math.max(a.y, b.y)) - Math.max(0, Math.min(a.y, b.y)) });

export default {
  title: 'Redact',
  saveLabel: 'Save Redacted',

  init(a) {
    api = a; img = a.img; W = img.naturalWidth; H = img.naturalHeight; M = Math.max(W, H);
    hintEl = el('div', { class: 'hint' }, HINTS[tool]);
    const strengthSlider = slider({ min: 1, max: 10, value: strength, format: (v) => `${v}` }, (v) => { strength = v; });
    a.controls.append(
      cols(
        row('Style', chips(TOOLS, tool, (v) => { tool = v; hintEl.textContent = HINTS[v]; }).el),
        row('Strength', strengthSlider.el),
      ),
      row('', hintEl),
      row('History', actions([
        { icon: ICONS.undo, label: 'Undo', title: 'Undo (Ctrl+Z)', onClick: () => this.undo() },
        { icon: ICONS.redo, label: 'Redo', title: 'Redo (Ctrl+Y)', onClick: () => this.redo() },
        { icon: ICONS.reset, label: 'Clear', title: 'Remove all redactions', onClick: () => { regions = []; redoStack = []; rebuild(); } },
      ])),
    );
    rebuild();
  },

  pointer(type, p) {
    if (type === 'hover') return api.setCursor('crosshair');
    if (type === 'down') { current = { from: p, to: p }; return; }
    if (!current) return;
    current.to = p;
    if (type === 'up') {
      const r = normal(current.from, current.to);
      current = null;
      if (r.w * api.view.scale > 3 && r.h * api.view.scale > 3) {
        regions.push({ ...r, tool, strength });
        redoStack = [];
        return rebuild();
      }
    }
    api.render();
  },

  undo() { if (regions.length) { redoStack.push(regions.pop()); rebuild(); } },
  redo() { if (redoStack.length) { regions.push(redoStack.pop()); rebuild(); } },

  render({ ctx, fit, applyView }) {
    fit(W, H);
    ctx.save();
    applyView();
    ctx.drawImage(composite, 0, 0);
    ctx.restore();
    if (current) {
      const r = normal(current.from, current.to);
      const { scale, ox, oy } = api.view;
      ctx.fillStyle = 'rgba(17,17,17,0.35)';
      ctx.strokeStyle = '#e6ecef';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(ox + r.x * scale, oy + r.y * scale, r.w * scale, r.h * scale);
      ctx.strokeRect(ox + r.x * scale, oy + r.y * scale, r.w * scale, r.h * scale);
    }
  },

  export() {
    return composite;
  },
};
