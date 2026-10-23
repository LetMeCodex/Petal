// Background removal with a local segmentation model (ISNet "general use", Apache-2.0, via the rembg project).
// The ~170 MB model downloads once on first use; after that everything runs offline on the CPU.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MODEL = {
  file: 'isnet-general-use.onnx',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
  size: 1024,
};

let modelDir = null;
let session = null;
let downloading = null;

const init = (userData) => { modelDir = path.join(userData, 'models'); };
const modelPath = () => path.join(modelDir, MODEL.file);
const isReady = () => fs.existsSync(modelPath());

async function download(onProgress) {
  fs.mkdirSync(modelDir, { recursive: true });
  const tmp = `${modelPath()}.part`;
  const res = await fetch(MODEL.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (total) onProgress?.(got / total);
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  fs.renameSync(tmp, modelPath());
}

async function ensureModel(onProgress) {
  if (isReady()) return;
  // Several files dropped at once share one download.
  downloading ??= download(onProgress).finally(() => { downloading = null; });
  await downloading;
}

async function getSession() {
  if (!session) {
    const ort = require('onnxruntime-node'); // loaded lazily: ~30 MB of native code most sessions never need
    session = await ort.InferenceSession.create(modelPath(), { graphOptimizationLevel: 'all' });
  }
  return session;
}

// Returns a PNG buffer of `input` with the background made transparent.
async function removeBackground(input, onProgress) {
  await ensureModel(onProgress);
  const ort = require('onnxruntime-node');
  const s = await getSession();
  const S = MODEL.size;

  const { data: rgb, info } = await sharp(input).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const small = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).resize(S, S, { fit: 'fill' }).raw().toBuffer();

  // NCHW float input, normalised like rembg does for ISNet: x/255 - 0.5 (std 1).
  const plane = S * S;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    tensor[i] = small[i * 3] / 255 - 0.5;
    tensor[plane + i] = small[i * 3 + 1] / 255 - 0.5;
    tensor[2 * plane + i] = small[i * 3 + 2] / 255 - 0.5;
  }
  const result = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, S, S]) });
  const pred = result[s.outputNames[0]].data;

  let lo = Infinity, hi = -Infinity;
  for (const v of pred) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const mask = Buffer.alloc(plane);
  for (let i = 0; i < plane; i++) mask[i] = Math.round(((pred[i] - lo) / (hi - lo || 1)) * 255);

  // extractChannel: sharp promotes a 1-channel raw image to sRGB on output, which would triple the buffer.
  const alpha = refineAlpha(await sharp(mask, { raw: { width: S, height: S, channels: 1 } })
    .resize(w, h, { fit: 'fill' }).extractChannel(0).raw().toBuffer());
  const colour = await decontaminate(rgb, alpha, w, h);
  return sharp(colour, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
}

// The model's soft edge is wider than real hair/fabric edges: drop the faint tail and firm up the rest.
function refineAlpha(alpha, lo = 18, hi = 235) {
  const out = Buffer.alloc(alpha.length);
  for (let i = 0; i < alpha.length; i++) {
    const v = Math.min(1, Math.max(0, (alpha[i] - lo) / (hi - lo)));
    out[i] = Math.round(v * 255);
  }
  return out;
}

const blur = (buf, w, h, channels, sigma) => {
  const img = sharp(buf, { raw: { width: w, height: h, channels } }).blur(sigma);
  return (channels === 1 ? img.extractChannel(0) : img).raw().toBuffer();
};

// Edge pixels are a mix of subject and old background (I = a·F + (1−a)·B), which shows up as a halo on a new
// background. Estimate F and B from nearby solid pixels (alpha-weighted blurs), then solve for F.
async function decontaminate(rgb, alpha, w, h) {
  const n = w * h;
  const sigma = Math.max(2, Math.max(w, h) / 250);
  const fg = Buffer.alloc(n * 3), bg = Buffer.alloc(n * 3), inv = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    inv[i] = 255 - a;
    for (let c = 0; c < 3; c++) {
      fg[i * 3 + c] = Math.round((rgb[i * 3 + c] * a) / 255);
      bg[i * 3 + c] = Math.round((rgb[i * 3 + c] * (255 - a)) / 255);
    }
  }
  const [fgB, bgB, aB, invB] = await Promise.all([
    blur(fg, w, h, 3, sigma), blur(bg, w, h, 3, sigma), blur(alpha, w, h, 1, sigma), blur(inv, w, h, 1, sigma),
  ]);

  const out = Buffer.from(rgb);
  for (let i = 0; i < n; i++) {
    const a = alpha[i] / 255;
    if (a >= 0.98) continue;
    for (let c = 0; c < 3; c++) {
      const k = i * 3 + c;
      const F = aB[i] ? (fgB[k] * 255) / aB[i] : rgb[k];
      if (a <= 0.02) { out[k] = F; continue; } // invisible, but keeps colours sane if someone resizes it later
      const B = invB[i] ? (bgB[k] * 255) / invB[i] : 0;
      const solved = Math.min(255, Math.max(0, (rgb[k] - (1 - a) * B) / a));
      // Solving is noisy where alpha is tiny, so lean on the local foreground colour there.
      const t = Math.min(1, Math.max(0, (a - 0.15) / 0.7));
      out[k] = Math.round(F * (1 - t * t * (3 - 2 * t)) + solved * (t * t * (3 - 2 * t)));
    }
  }
  return out;
}

module.exports = { init, isReady, removeBackground, MODEL };
