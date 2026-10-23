// PDF pages are rasterized with pdf.js inside a hidden window, so we get Chromium's canvas for free.
const fs = require('fs');
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

let win, ready;
const pending = new Map();
let nextId = 1;

function init() {
  win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'pdf', 'pdf-preload.js'), backgroundThrottling: false },
  });
  ready = win.loadFile(path.join(__dirname, 'pdf', 'pdf.html'));
  ipcMain.on('pdf:result', (_e, { id, pages, error }) => {
    const p = pending.get(id);
    pending.delete(id);
    if (!p) return;
    error ? p.reject(new Error(error)) : p.resolve(pages.map((u8) => Buffer.from(u8)));
  });
}

async function render(file, format = 'jpg', scale = 2, maxPages = Infinity) {
  await ready;
  const id = nextId++;
  const bytes = fs.readFileSync(file);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    win.webContents.send('pdf:render', { id, bytes, format, scale, maxPages });
  });
}

module.exports = { init, render };
