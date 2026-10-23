import { el, row, cols, chips, slider, actions, number, ICONS } from '../ui.js';

const DEFAULTS = { rot: 0, flipH: false, flipV: false, brightness: 100, contrast: 100, saturation: 100, warmth: 0, scale: 100 };
const state = { ...DEFAULTS };
let api, sliders, scaleChips, widthIn;

const pct = (v) => `${v}%`;
const signed = (v) => (v > 0 ? `+${v}` : `${v}`);

function rotatedSize(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  return state.rot % 2 ? { w: h, h: w } : { w, h };
}

// Renders the edited picture at `s` × its rotated size. Used for both the preview and the export.
function build(img, s) {
  const { w: rw, h: rh } = rotatedSize(img);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(rw * s));
  c.height = Math.max(1, Math.round(rh * s));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const place = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((state.rot * Math.PI) / 2);
    ctx.scale((state.flipH ? -1 : 1) * s, (state.flipV ? -1 : 1) * s);
  };
  place();
  ctx.filter = `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%)`;
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.filter = 'none';

  if (state.warmth) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'soft-light';
    const a = (Math.abs(state.warmth) / 100) * 0.6;
    ctx.fillStyle = state.warmth > 0 ? `rgba(255, 138, 20, ${a})` : `rgba(20, 120, 255, ${a})`;
    ctx.fillRect(0, 0, c.width, c.height);
    // Put the original alpha back so transparent pixels stay transparent.
    ctx.globalCompositeOperation = 'destination-in';
    place();
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.globalCompositeOperation = 'source-over';
  }
  return c;
}

function update() {
  const { w, h } = rotatedSize(api.img);
  const ow = Math.round((w * state.scale) / 100), oh = Math.round((h * state.scale) / 100);
  widthIn.set(ow);
  api.setMeta(`${ow} × ${oh} px${api.images.length > 1 ? `  ·  applies to all ${api.images.length} files` : ''}`);
  api.render();
}

function resetAll() {
  Object.assign(state, DEFAULTS);
  for (const [k, s] of Object.entries(sliders)) s.set(state[k]);
  scaleChips.set(100);
  update();
}

export default {
  title: 'Edit',
  batch: true,

  init(a) {
    api = a;
    const s = (key, min, max, format) => slider({ min, max, value: state[key], format }, (v) => { state[key] = v; update(); });
    sliders = {
      brightness: s('brightness', 0, 200, pct),
      contrast: s('contrast', 0, 200, pct),
      saturation: s('saturation', 0, 200, pct),
      warmth: s('warmth', -100, 100, signed),
    };
    scaleChips = chips([100, 75, 50, 25].map((v) => ({ value: v, label: `${v}%` })), 100, (v) => { state.scale = v; update(); });
    widthIn = number({ value: a.img.naturalWidth, max: 20000, label: 'Output width' }, (px) => {
      state.scale = (px / rotatedSize(api.img).w) * 100;
      scaleChips.set(null);
      update();
    });

    a.controls.append(
      row('Transform', actions([
        { icon: ICONS.rotL, title: 'Rotate left', onClick: () => { state.rot = (state.rot + 3) % 4; update(); } },
        { icon: ICONS.rotR, title: 'Rotate right', onClick: () => { state.rot = (state.rot + 1) % 4; update(); } },
        { icon: ICONS.flipH, title: 'Flip horizontal', onClick: () => { state.flipH = !state.flipH; update(); } },
        { icon: ICONS.flipV, title: 'Flip vertical', onClick: () => { state.flipV = !state.flipV; update(); } },
        { icon: ICONS.reset, label: 'Reset all', title: 'Reset all edits', onClick: resetAll },
      ])),
      cols(
        row('Brightness', sliders.brightness.el),
        row('Contrast', sliders.contrast.el),
        row('Saturation', sliders.saturation.el),
        row('Warmth', sliders.warmth.el),
      ),
      row('Resize', el('div', { class: 'num' }, scaleChips.el, widthIn.el, el('span', {}, 'px wide'))),
    );
    update();
  },

  render({ ctx, img, fit, dpr }) {
    const { w, h } = rotatedSize(img);
    const { scale, ox, oy } = fit(w, h);
    // Build at screen resolution so slider drags stay smooth even on 40-megapixel photos.
    ctx.drawImage(build(img, scale * dpr), ox, oy, w * scale, h * scale);
  },

  export(img) {
    return build(img, state.scale / 100);
  },
};
