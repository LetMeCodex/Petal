import { row, cols, chips, slider, swatches } from '../ui.js';

const GRADIENTS = [
  { value: 'slate', stops: ['#1a2128', '#4f5c67', '#9aa8b2'] },
  { value: 'pearl', stops: ['#f4f7f8', '#cdd6dc', '#a9b6bf'] },
  { value: 'sunset', stops: ['#ff5f45', '#ffb23e', '#8a6cff'] },
  { value: 'peach', stops: ['#ffd3a5', '#fd6585'] },
  { value: 'candy', stops: ['#ff9a9e', '#fad0c4', '#fbc2eb'] },
  { value: 'grape', stops: ['#a18cd1', '#fbc2eb'] },
  { value: 'aurora', stops: ['#a8edea', '#fed6e3'] },
  { value: 'ocean', stops: ['#4facfe', '#00f2fe'] },
  { value: 'mint', stops: ['#d4fc79', '#96e6a1'] },
  { value: 'dusk', stops: ['#2b5876', '#4e4376'] },
  { value: 'night', stops: ['#0f2027', '#203a43', '#2c5364'] },
];
const SOLIDS = ['#ffffff', '#f4efe6', '#f5d547', '#9be15d', '#2bb5a0', '#5ccfe6', '#3b5bdb', '#7b4fd6', '#ff5a2c', '#1f2328'];
const RATIOS = [
  { value: 'auto', label: 'Auto' }, { value: 1, label: '1:1' }, { value: 16 / 9, label: '16:9' },
  { value: 4 / 3, label: '4:3' }, { value: 4 / 5, label: '4:5' }, { value: 9 / 16, label: '9:16' },
];

// Sizes are fractions of the image's longer side, so one setting looks the same on every file in a batch.
const state = { bg: { kind: 'gradient', id: 'slate' }, pad: 0.1, radius: 0.025, shadow: 0.035, ratio: 'auto' };
let api, gradSw, solidSw;

const gradientCss = (g) => `linear-gradient(135deg, ${g.stops.join(', ')})`;

function layout(img) {
  const w = img.naturalWidth, h = img.naturalHeight, M = Math.max(w, h);
  const pad = Math.round(state.pad * M);
  let W = w + pad * 2, H = h + pad * 2;
  if (state.ratio !== 'auto') {
    if (W / H < state.ratio) W = Math.round(H * state.ratio); else H = Math.round(W / state.ratio);
  }
  return { w, h, M, W, H, x: (W - w) / 2, y: (H - h) / 2, r: state.radius * M, shadow: state.shadow * M };
}

// `k` converts scene px to device px; shadowBlur and filter blur ignore the canvas transform.
function compose(ctx, img, L, k) {
  const { W, H, w, h, x, y, r, shadow, M } = L;
  const bg = state.bg;
  if (bg.kind === 'gradient') {
    const g = GRADIENTS.find((g) => g.value === bg.id);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    g.stops.forEach((c, i) => grad.addColorStop(i / (g.stops.length - 1), c));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else if (bg.kind === 'solid') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, W, H);
  } else {
    // The picture itself, enlarged and blurred, like a frosted backdrop.
    const s = Math.max(W / w, H / h) * 1.15;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.filter = `blur(${M * 0.04 * k}px) saturate(130%)`;
    ctx.drawImage(img, (W - w * s) / 2, (H - h * s) / 2, w * s, h * s);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, 0, W, H);
  }

  if (shadow > 0) {
    ctx.save();
    ctx.shadowColor = 'rgba(20, 10, 0, 0.38)';
    ctx.shadowBlur = shadow * k;
    ctx.shadowOffsetY = shadow * 0.35 * k;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

function meta() {
  const L = layout(api.img);
  api.setMeta(`${L.W} × ${L.H} px${api.images.length > 1 ? `  ·  applies to all ${api.images.length} files` : ''}`);
  api.render();
}

export default {
  title: 'Add background',
  saveLabel: 'Save with Background',
  batch: true,
  outExt: 'png',

  init(a) {
    api = a;
    const M = Math.max(a.img.naturalWidth, a.img.naturalHeight);
    const px = (f) => `${Math.round(f * M)} px`;

    gradSw = swatches(
      [
        ...GRADIENTS.map((g) => ({ value: g.value, css: gradientCss(g), title: g.value })),
        { value: 'blur', css: `center / cover url("${a.file.dataUrl}")`, title: 'Blurred picture' },
      ],
      'slate',
      (v) => { state.bg = v === 'blur' ? { kind: 'blur' } : { kind: 'gradient', id: v }; solidSw.set(null); meta(); },
    );
    solidSw = swatches(
      SOLIDS.map((c) => ({ value: c, css: c })),
      null,
      (c) => { state.bg = { kind: 'solid', color: c }; gradSw.set(null); meta(); },
      { round: true, custom: true },
    );

    a.controls.append(
      row('Background', gradSw.el),
      row('', solidSw.el),
      cols(
        row('Padding', slider({ min: 0, max: 0.3, step: 0.005, value: state.pad, format: px }, (v) => { state.pad = v; meta(); }).el),
        row('Corners', slider({ min: 0, max: 0.1, step: 0.002, value: state.radius, format: px }, (v) => { state.radius = v; meta(); }).el),
        row('Shadow', slider({ min: 0, max: 0.1, step: 0.002, value: state.shadow, format: px }, (v) => { state.shadow = v; meta(); }).el),
        row('Ratio', chips(RATIOS, 'auto', (v) => { state.ratio = v; meta(); }).el),
      ),
    );
    meta();
  },

  render({ ctx, img, fit, applyView, dpr }) {
    const L = layout(img);
    const { scale } = fit(L.W, L.H);
    applyView();
    compose(ctx, img, L, scale * dpr);
  },

  export(img) {
    const L = layout(img);
    const c = document.createElement('canvas');
    c.width = L.W; c.height = L.H;
    compose(c.getContext('2d'), img, L, 1);
    return c;
  },
};
