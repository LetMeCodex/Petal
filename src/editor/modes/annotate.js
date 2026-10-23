import { el, row, cols, chips, swatches, actions, ICONS } from '../ui.js';

const TOOLS = [
  { value: 'pen', icon: ICONS.pen, title: 'Pen' },
  { value: 'highlight', icon: ICONS.highlight, title: 'Highlighter' },
  { value: 'arrow', icon: ICONS.arrow, title: 'Arrow' },
  { value: 'rect', icon: ICONS.rect, title: 'Box' },
  { value: 'ellipse', icon: ICONS.ellipse, title: 'Circle' },
  { value: 'text', icon: ICONS.text, title: 'Text' },
];
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#af52de', '#1f2328', '#ffffff'];
const SIZES = [{ value: 1, label: 'S' }, { value: 2, label: 'M' }, { value: 4, label: 'L' }];

let api, img, unit;
let tool = 'arrow', color = COLORS[0], size = 2;
let shapes = [], redoStack = [], current = null, entry = null;

const width = (s) => unit * s;
const fontSize = (s) => unit * s * 7 + unit * 6;

function drawShape(ctx, s) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.lineWidth = width(s.size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (s.tool === 'pen' || s.tool === 'highlight') {
    if (s.tool === 'highlight') {
      ctx.globalAlpha = 0.4;
      ctx.globalCompositeOperation = 'multiply';
      ctx.lineWidth = width(s.size) * 4;
      ctx.lineCap = 'butt';
    }
    const pts = s.points;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    // Midpoint quadratic curves smooth out mouse jitter.
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  } else if (s.tool === 'arrow') {
    const { from: a, to: b } = s;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.min(width(s.size) * 4.5 + unit * 6, Math.hypot(b.x - a.x, b.y - a.y) * 0.6);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x - Math.cos(ang) * head * 0.6, b.y - Math.sin(ang) * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
    ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  } else if (s.tool === 'rect') {
    ctx.strokeRect(Math.min(s.from.x, s.to.x), Math.min(s.from.y, s.to.y), Math.abs(s.to.x - s.from.x), Math.abs(s.to.y - s.from.y));
  } else if (s.tool === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse((s.from.x + s.to.x) / 2, (s.from.y + s.to.y) / 2, Math.abs(s.to.x - s.from.x) / 2, Math.abs(s.to.y - s.from.y) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.tool === 'text') {
    const fs = fontSize(s.size);
    ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    // A contrasting outline keeps text readable on busy screenshots.
    const dark = ['#1f2328', '#0a84ff', '#af52de', '#ff3b30'].includes(s.color);
    ctx.lineWidth = fs / 7;
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)';
    s.text.split('\n').forEach((line, i) => {
      ctx.strokeText(line, s.at.x, s.at.y + i * fs * 1.2);
      ctx.fillText(line, s.at.x, s.at.y + i * fs * 1.2);
    });
  }
  ctx.restore();
}

function commit(shape) {
  shapes.push(shape);
  redoStack = [];
  updateMeta();
}

function updateMeta() {
  api.setMeta(shapes.length ? `${shapes.length} annotation${shapes.length > 1 ? 's' : ''}  ·  Ctrl+Z to undo` : 'Draw on the picture');
  api.render();
}

function openTextEntry(p) {
  closeTextEntry(true);
  const s = api.toScreen(p);
  const input = el('input', { type: 'text', class: 'text-entry', placeholder: 'Type, then Enter', 'aria-label': 'Annotation text' });
  input.style.left = `${s.x}px`;
  input.style.top = `${s.y}px`;
  input.style.color = color;
  input.style.fontSize = `${Math.max(12, fontSize(size) * api.view.scale)}px`;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') closeTextEntry(true);
    if (e.key === 'Escape') { e.stopPropagation(); closeTextEntry(false); }
  });
  // Removing an old box blurs it; only close the entry if this box is still the active one.
  input.addEventListener('blur', () => { if (entry?.input === input) closeTextEntry(true); });
  api.overlay.append(input);
  entry = { input, at: p, color, size };
  setTimeout(() => input.focus(), 0);
}

function closeTextEntry(keep) {
  if (!entry) return;
  const { input, at, color: c, size: sz } = entry;
  entry = null;
  if (keep && input.value.trim()) commit({ tool: 'text', text: input.value, at, color: c, size: sz });
  input.remove();
  api.render();
}

export default {
  title: 'Annotate',

  init(a) {
    api = a; img = a.img;
    unit = Math.max(1.5, Math.max(img.naturalWidth, img.naturalHeight) / 400);
    a.controls.append(
      cols(
        row('Tool', chips(TOOLS, tool, (v) => { tool = v; closeTextEntry(true); }).el),
        row('Size', chips(SIZES, size, (v) => { size = v; }).el),
      ),
      row('Colour', swatches(COLORS.map((c) => ({ value: c, css: c })), color, (c) => { color = c; }, { round: true, custom: true }).el),
      row('History', actions([
        { icon: ICONS.undo, label: 'Undo', title: 'Undo (Ctrl+Z)', onClick: () => { this.undo(); api.render(); } },
        { icon: ICONS.redo, label: 'Redo', title: 'Redo (Ctrl+Y)', onClick: () => { this.redo(); api.render(); } },
        { icon: ICONS.reset, label: 'Clear', title: 'Remove all annotations', onClick: () => { redoStack = []; shapes = []; updateMeta(); } },
      ])),
    );
    updateMeta();
  },

  pointer(type, p) {
    if (type === 'hover') return api.setCursor(tool === 'text' ? 'text' : 'crosshair');
    if (type === 'down') {
      if (tool === 'text') return openTextEntry(p);
      current = tool === 'pen' || tool === 'highlight'
        ? { tool, color, size, points: [p] }
        : { tool, color, size, from: p, to: p };
      return;
    }
    if (!current) return;
    if (current.points) current.points.push(p); else current.to = p;
    if (type === 'up') {
      const big = current.points
        ? current.points.length > 1
        : Math.hypot(current.to.x - current.from.x, current.to.y - current.from.y) > 4 / api.view.scale;
      if (big) commit(current);
      current = null;
    }
    api.render();
  },

  undo() { if (shapes.length) redoStack.push(shapes.pop()); updateMeta(); },
  redo() { if (redoStack.length) shapes.push(redoStack.pop()); updateMeta(); },

  render({ ctx, fit, applyView }) {
    fit(img.naturalWidth, img.naturalHeight);
    applyView();
    ctx.drawImage(img, 0, 0);
    for (const s of shapes) drawShape(ctx, s);
    if (current) drawShape(ctx, current);
  },

  export(source) {
    closeTextEntry(true);
    const c = document.createElement('canvas');
    c.width = source.naturalWidth; c.height = source.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(source, 0, 0);
    for (const s of shapes) drawShape(ctx, s);
    return c;
  },
};
