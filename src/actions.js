const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { clipboard } = require('electron');
const { PDFDocument } = require('pdf-lib');
const pdf = require('./pdf');
const ocr = require('./ocr');
const bgremove = require('./bgremove');

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'tif', 'tiff', 'svg']);
// What "Convert" turns each type into when the user doesn't pick a target.
const DEFAULT_TARGET = { png: 'jpg', jpg: 'png', jpeg: 'png', webp: 'png', gif: 'png', avif: 'jpg', tif: 'jpg', tiff: 'jpg', svg: 'png', pdf: 'jpg' };

const extOf = (file) => path.extname(file).slice(1).toLowerCase();
const kindOf = (file) => (extOf(file) === 'pdf' ? 'pdf' : IMAGE_EXT.has(extOf(file)) ? 'image' : 'other');

// Never overwrite: "Photo.jpg" -> "Photo Compressed.jpg" -> "Photo Compressed (2).jpg"
function outPath(src, suffix, ext) {
  const dir = path.dirname(src);
  const name = suffix ? `${path.parse(src).name} ${suffix}` : path.parse(src).name;
  let p = path.join(dir, `${name}.${ext}`);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${name} (${i}).${ext}`);
  return p;
}

function encode(img, ext, quality = 92) {
  switch (ext) {
    case 'jpg': case 'jpeg': return img.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true });
    case 'png': return img.png({ compressionLevel: 9 });
    case 'webp': return img.webp({ quality });
    case 'avif': return img.avif({ quality: Math.round(quality * 0.6) });
    case 'gif': return img.gif();
    case 'tif': case 'tiff': return img.tiff({ quality });
    default: throw new Error(`Can't write .${ext}`);
  }
}

const skip = (reason) => ({ skipped: reason });

// Wheel slices that open an editor window instead of running straight away, with their output suffix.
const EDITORS = { crop: 'Cropped', addbg: 'With Background', edit: 'Edited', annotate: 'Annotated', redact: 'Redacted' };
// Formats the editor can write back as-is; anything else comes out as PNG.
const EDITOR_OUT = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp' };

async function loadForEditor(file) {
  const kind = kindOf(file);
  const name = path.basename(file);
  if (kind === 'pdf') {
    const [page] = await pdf.render(file, 'png', 2, 1);
    return { path: file, name, ext: 'png', dataUrl: `data:image/png;base64,${page.toString('base64')}` };
  }
  if (kind !== 'image') return null;
  // Normalise through sharp: bakes in EXIF rotation and turns TIFF/AVIF/GIF/SVG into something every canvas reads.
  const buf = await sharp(file, { animated: false }).rotate().png().toBuffer();
  return { path: file, name, ext: EDITOR_OUT[extOf(file)] || 'png', dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
}

function saveEdited(mode, outputs) {
  return outputs.map(({ src, bytes, ext }) => {
    const out = outPath(src, EDITORS[mode], ext);
    fs.writeFileSync(out, Buffer.from(bytes));
    return out;
  });
}

const ACTIONS = {
  async convert(file, { to } = {}) {
    const kind = kindOf(file);
    const target = to || DEFAULT_TARGET[extOf(file)];
    if (!target) return skip('Unsupported file type');

    if (kind === 'pdf') {
      const pages = await pdf.render(file, target === 'png' ? 'png' : 'jpg');
      const single = pages.length === 1;
      return {
        saved: pages.map((buf, i) => {
          const out = outPath(file, single ? '' : `- Page ${String(i + 1).padStart(3, '0')}`, target === 'png' ? 'png' : 'jpg');
          fs.writeFileSync(out, buf);
          return out;
        }),
      };
    }
    if (kind !== 'image') return skip('Unsupported file type');
    const out = outPath(file, '', target);
    await encode(sharp(file, { animated: false }).rotate(), target).toFile(out);
    return { saved: [out] };
  },

  async compress(file) {
    if (kindOf(file) !== 'image') return skip('Compress supports images for now');
    const ext = extOf(file);
    let img = sharp(file).rotate();
    if (ext === 'jpg' || ext === 'jpeg') img = img.jpeg({ quality: 72, mozjpeg: true });
    else if (ext === 'png') img = img.png({ palette: true, quality: 80, compressionLevel: 9, effort: 8 });
    else if (ext === 'webp') img = img.webp({ quality: 70, effort: 6 });
    else if (ext === 'avif') img = img.avif({ quality: 45 });
    else return skip(`Can't compress .${ext} yet`);

    const buf = await img.toBuffer();
    const before = fs.statSync(file).size;
    if (buf.length >= before) return skip('Already optimized');
    const out = outPath(file, 'Compressed', ext);
    fs.writeFileSync(out, buf);
    return { saved: [out], note: `${Math.round((1 - buf.length / before) * 100)}% smaller` };
  },

  async metadata(file) {
    if (kindOf(file) !== 'image') return skip('Metadata supports images for now');
    const meta = await sharp(file).metadata();
    const found = ['exif', 'xmp', 'iptc', 'icc'].filter((k) => meta[k]).map((k) => k.toUpperCase());
    if (!found.length) return skip('No metadata found');
    const ext = extOf(file);
    const out = outPath(file, 'Clean', ext);
    // sharp drops metadata on output by default; .rotate() bakes in EXIF orientation first.
    await encode(sharp(file).rotate(), ext, 95).toFile(out);
    return { saved: [out], note: `Removed ${found.join(', ')}` };
  },

  async removebg(file, _options, progress) {
    const kind = kindOf(file);
    if (kind === 'other') return skip('Remove BG works on images and PDFs');
    const input = kind === 'pdf' ? (await pdf.render(file, 'png', 2, 1))[0] : file;
    const png = await bgremove.removeBackground(input, (frac) => progress?.({ download: frac }));
    const out = outPath(file, 'No BG', 'png');
    fs.writeFileSync(out, png);
    return { saved: [out] };
  },
};

// Actions that take every dropped file at once and produce a single result.
const BATCH = {
  // Recognise text in every image / PDF page and put it all on the clipboard.
  async ocr(paths, progress) {
    const pages = [];
    for (const file of paths) {
      const kind = kindOf(file);
      if (kind === 'image') pages.push(file);
      else if (kind === 'pdf') pages.push(...(await pdf.render(file, 'png', 2)));
    }
    if (!pages.length) return { error: 'Copy Text works on images and PDFs' };
    progress?.({ done: 0, total: pages.length });
    const text = (await ocr.recognize(pages)).map((t) => t.trim()).filter(Boolean).join('\n\n');
    if (!text) return { error: 'No text found' };
    clipboard.writeText(text);
    const words = text.split(/\s+/).filter(Boolean).length;
    return { copied: { words, text, preview: text.replace(/\s+/g, ' ').slice(0, 80) } };
  },

  // Images and PDFs, in natural file-name order ("Page 2" before "Page 10"), into one PDF.
  async merge(paths, progress) {
    const files = paths.filter((f) => kindOf(f) !== 'other')
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));
    if (files.length < 2) return { error: 'Drop two or more images or PDFs to merge' };
    const doc = await PDFDocument.create();
    for (const [i, file] of files.entries()) {
      if (kindOf(file) === 'pdf') {
        const src = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
        for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page);
      } else {
        const img = sharp(file, { animated: false }).rotate();
        const { hasAlpha } = await img.metadata();
        const { data, info } = await (hasAlpha ? img.png() : img.jpeg({ quality: 90 })).toBuffer({ resolveWithObject: true });
        const embedded = hasAlpha ? await doc.embedPng(data) : await doc.embedJpg(data);
        // 96 dpi -> PDF points, so a screenshot prints at the size it shows on screen.
        const w = info.width * 0.75, h = info.height * 0.75;
        doc.addPage([w, h]).drawImage(embedded, { x: 0, y: 0, width: w, height: h });
      }
      progress?.({ done: i + 1, total: files.length });
    }
    const out = outPath(files[0], 'Merged', 'pdf');
    fs.writeFileSync(out, await doc.save());
    return { results: [{ file: files[0], saved: [out], note: `${files.length} files, ${doc.getPageCount()} pages` }] };
  },
};

async function run(action, paths, options, progress) {
  if (BATCH[action]) {
    try { return await BATCH[action](paths, progress); } catch (err) { return { error: err.message }; }
  }
  const fn = ACTIONS[action];
  if (!fn) return { error: `Unknown action: ${action}` };
  const results = [];
  for (const [i, file] of paths.entries()) {
    try {
      results.push({ file, ...(await fn(file, options, progress)) });
    } catch (err) {
      results.push({ file, skipped: err.message });
    }
    progress?.({ done: i + 1, total: paths.length });
  }
  return { results };
}

function init(userData) {
  pdf.init();
  bgremove.init(userData);
}

module.exports = { init, run, kindOf, DEFAULT_TARGET, EDITORS, loadForEditor, saveEdited };
