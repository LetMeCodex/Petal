// Renders the wheel in several states over a fake desktop and saves PNGs to .snap/wheel/.
// Run: npx electron scripts/wheel-snap.js
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', '.snap', 'wheel');
const SIZE = 440;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A busy, colourful "desktop" so the glass has something to refract.
const desktopSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2a6b"/><stop offset=".5" stop-color="#7b3fa0"/><stop offset="1" stop-color="#f08a4b"/></linearGradient></defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
  <circle cx="90" cy="110" r="70" fill="#2fd1c5" opacity=".8"/><circle cx="360" cy="330" r="90" fill="#ffd166" opacity=".85"/>
  <rect x="210" y="40" width="190" height="130" rx="12" fill="#f4f6fb"/><rect x="210" y="40" width="190" height="26" rx="12" fill="#2b2f3a"/>
  <text x="226" y="105" font-family="Segoe UI" font-size="18" fill="#333">Quarterly report</text>
  <text x="226" y="135" font-family="Segoe UI" font-size="14" fill="#777">Revenue up 24%</text>
  <rect x="40" y="260" width="150" height="110" rx="10" fill="#ff5d73" opacity=".9"/>
  <text x="56" y="320" font-family="Segoe UI" font-size="22" font-weight="700" fill="#fff">Photos</text></svg>`;

const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="#1b1b1b"/>
  <rect x="0" y="0" width="${SIZE}" height="54" fill="#202020"/><text x="20" y="34" font-family="Segoe UI" font-size="15" fill="#ddd">Sort    View    Set as background</text>
  <rect x="40" y="90" width="110" height="130" rx="4" fill="#2c2c2c"/><rect x="58" y="104" width="74" height="84" fill="#f4f1ea"/>
  <rect x="180" y="90" width="110" height="130" rx="4" fill="#2c2c2c"/><rect x="214" y="120" width="40" height="52" rx="6" fill="#2f7fd0"/>
  <text x="70" y="208" font-family="Segoe UI" font-size="13" fill="#ddd">Receipt</text><text x="222" y="208" font-family="Segoe UI" font-size="13" fill="#ddd">Mug</text></svg>`;

const SCENES = [
  { name: '1-hover-removebg', types: ['image/jpeg'], hover: 'removebg', at: [130, 300] },
  { name: '2-convert', types: ['image/png'], hover: 'convert', at: [228, 212] },
  { name: '3-merge-dormant', types: ['image/png'], hover: 'merge', at: [150, 110] },
  { name: '4-merge-awake', types: ['image/png', 'application/pdf'], hover: 'merge', at: [150, 110] },
  { name: '5-progress', types: ['image/jpeg'], toast: ['Removing background', 'Dashrath.jpeg', 0.55, ''] },
  { name: '6-success', types: ['image/jpeg'], toast: ['Saved', 'Dashrath No BG.png', 1, 'success'], rain: true },
  { name: '7-dark-desktop', dark: true, types: ['image/jpeg'], hover: 'crop', at: [70, 250] },
];

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const colourful = await sharp(Buffer.from(desktopSvg)).jpeg().toBuffer();
  const dark = await sharp(Buffer.from(darkSvg)).jpeg().toBuffer();
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true, opacity: 0, skipTaskbar: true, focusable: false,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), backgroundThrottling: false },
  });
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log('[page]', e.message); });
  await win.loadFile(path.join(__dirname, '..', 'src', 'wheel', 'wheel.html'));
  win.showInactive();

  for (const s of SCENES) {
    const desktop = s.dark ? dark : colourful;
    win.webContents.send('wheel:open');
    await wait(60);
    win.webContents.send('wheel:backdrop', `data:image/jpeg;base64,${desktop.toString('base64')}`);
    await wait(700);
    await win.webContents.executeJavaScript(`(() => {
      const w = window.__wheel;
      w.describeDrag(${JSON.stringify(s.types)});
      ${s.hover ? `w.track(${s.at[0]}, ${s.at[1]}); w.setHot(${JSON.stringify(s.hover)});` : ''}
      ${s.toast ? `w.pluck('removebg'); document.body.classList.add('dropping'); w.showToast(...${JSON.stringify(s.toast)});` : ''}
      ${s.rain ? 'w.celebrate();' : ''}
    })()`);
    await wait(s.rain ? 420 : 650);
    const shot = (await win.webContents.capturePage()).toPNG();
    await sharp(desktop).composite([{ input: await sharp(shot).resize(SIZE, SIZE).toBuffer() }]).png().toFile(path.join(OUT, `${s.name}.png`));
    console.log('saved', s.name);
  }
  app.exit(0);
});
