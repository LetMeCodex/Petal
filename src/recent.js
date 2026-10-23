// What Petal made lately, for the island's Recent and Copied text tabs. Kept small and on disk
// so it survives restarts; files that no longer exist are dropped when listed.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_FILES = 12;
const MAX_TEXTS = 8;
let file = null;
let data = { files: [], texts: [] };

function init(userData) {
  file = path.join(userData, 'recent.json');
  try { data = { files: [], texts: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
}

function save() {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch { /* best effort */ }
}

// `res` is whatever actions.run returned.
function record(action, res) {
  const saved = (res?.results || []).flatMap((r) => r.saved || []);
  if (saved.length) {
    data.files = [...saved.map((f) => ({ file: f, action, at: Date.now() })), ...data.files.filter((x) => !saved.includes(x.file))].slice(0, MAX_FILES);
  }
  if (res?.copied?.text) {
    data.texts = [{ text: res.copied.text, at: Date.now() }, ...data.texts].slice(0, MAX_TEXTS);
  }
  save();
}

function list() {
  const files = data.files.filter((x) => fs.existsSync(x.file)).slice(0, 6).map((x) => ({
    ...x, name: path.basename(x.file), url: pathToFileURL(x.file).href, ext: path.extname(x.file).slice(1).toLowerCase(),
  }));
  return { files, texts: data.texts };
}

module.exports = { init, record, list };
