// Text recognition through Windows' own OCR engine: offline, free, no model to ship.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const sharp = require('sharp');

const SCRIPT = path.join(__dirname, 'native', 'ocr.ps1');
const MAX_SIDE = 9000; // a little under OcrEngine.MaxImageDimension

function runScript(files) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...files],
      { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        let out;
        try { out = JSON.parse(stdout.trim()); } catch { return reject(err || new Error('OCR returned nothing')); }
        out.error ? reject(new Error(out.error)) : resolve(out);
      });
  });
}

// `images` are buffers or paths sharp can read. Each is normalised to a PNG the Windows decoder accepts;
// small images are upscaled, which noticeably helps with tiny UI text in screenshots.
async function recognize(images) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-ocr-'));
  try {
    const files = [];
    for (const [i, input] of images.entries()) {
      const img = sharp(input).rotate();
      const { width, height } = await img.metadata();
      const side = Math.max(width, height);
      const scale = side < 1400 ? 2 : side > MAX_SIDE ? MAX_SIDE / side : 1;
      const file = path.join(dir, `${i}.png`);
      await img.resize(Math.round(width * scale)).flatten({ background: '#fff' }).png().toFile(file);
      files.push(file);
    }
    const { results } = await runScript(files);
    return results.map((r) => r.text);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { recognize };
