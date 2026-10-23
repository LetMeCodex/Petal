// Renders every Petal Island state from scripts/mockup/island.html and builds one labelled sheet.
// Run: npx electron scripts/island-mockup.js   (output: .snap/island/)
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', '.snap', 'island');
const STATES = [
  ['idle', '01  Idle — a dewdrop clinging to the screen edge'],
  ['hover', '02  Hover — the drop spreads into a panel'],
  ['drag', '03  File drag — a tendril reaches for your file'],
  ['work', '04  Working — blush liquid rises inside'],
  ['done', '05  Done — the result drips down, grab it'],
  ['suggest', '06  Suggestion — new screenshot, one tap'],
  ['error', '07  Error — the drop clouds over'],
];
const W = 900, H = 330;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, opacity: 0, skipTaskbar: true, focusable: false, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('[page]', e.message); });
  win.showInactive();
  const shots = [];
  for (const [id] of STATES) {
    await win.loadFile(path.join(__dirname, 'mockup', 'island.html'), { query: { state: id } });
    await wait(1400);
    const file = path.join(OUT, `${id}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    shots.push(file);
    console.log('saved', id);
  }

  // Labelled sheet: two columns, each frame with a mono caption above it.
  const cw = 640, ch = Math.round((H / W) * cw), lab = 34, gap = 18, cols = 2;
  const rows = Math.ceil(shots.length / cols);
  const sheetW = cols * cw + (cols + 1) * gap, sheetH = rows * (ch + lab) + (rows + 1) * gap;
  const parts = [];
  for (const [i, file] of shots.entries()) {
    const x = gap + (i % cols) * (cw + gap), y = gap + Math.floor(i / cols) * (ch + lab + gap);
    parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${lab}"><text x="2" y="22" font-family="Consolas" font-size="14" letter-spacing="1.5" fill="#f3c6d6">${STATES[i][1].toUpperCase()}</text></svg>`), left: x, top: y });
    parts.push({ input: await sharp(file).resize(cw).toBuffer(), left: x, top: y + lab });
  }
  await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#160a12' } }).composite(parts).png().toFile(path.join(OUT, 'sheet.png'));
  console.log('sheet saved');
  app.exit(0);
});
