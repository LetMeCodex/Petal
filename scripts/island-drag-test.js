// Drags the real island with the real mouse: grab the drop at the top edge, carry it to the middle
// of the screen (it must float there, and stretch while moving), then carry it back up to the top
// edge (it must cling again). Uses its own in-memory settings, so your saved position is untouched.
// MOVES YOUR CURSOR for about 10 seconds; don't touch the mouse while it runs.
// Run: npx electron scripts/island-drag-test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, screen, ipcMain } = require('electron');
const { createIsland, computeLayout, dropRect } = require('../src/island-main');

const OUT = path.join(__dirname, '..', '.snap', 'island-drag');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Real input through user32, in physical pixels. Moves go through mouse_event (absolute, 0..65535)
// rather than SetCursorPos: a teleported cursor generates no input, and click-through windows only
// hear about the mouse from real input. Each step: [x, y, 'down'|'up'|null, sleepMs].
function mouse(steps) {
  const px = screen.dipToScreenPoint({ x: screen.getPrimaryDisplay().bounds.width, y: screen.getPrimaryDisplay().bounds.height });
  const abs = (v, axis) => Math.round((v * 65535) / ((axis === 'w' ? px.x : px.y) - 1));
  const ps = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void][M]::SetProcessDPIAware()   # coordinates below are physical pixels
${steps.map(([x, y, btn, ms]) => `[M]::mouse_event(0x8001, ${abs(x, 'w')}, ${abs(y, 'h')}, 0, [IntPtr]::Zero); ${btn === 'down' ? '[M]::mouse_event(2,0,0,0,[IntPtr]::Zero);' : btn === 'up' ? '[M]::mouse_event(4,0,0,0,[IntPtr]::Zero);' : ''} Start-Sleep -Milliseconds ${ms}`).join('\n')}
`;
  const file = path.join(os.tmpdir(), `petal-drag-${process.pid}.ps1`);
  fs.writeFileSync(file, ps);
  return new Promise((resolve) => spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { stdio: 'inherit' }).on('exit', resolve));
}
const phys = (p) => screen.dipToScreenPoint(p);
// A smooth path from a to b, like a hand would move.
const path2 = (a, b, n, ms) => Array.from({ length: n }, (_, i) => {
  const t = (i + 1) / n, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const p = phys({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });
  return [p.x, p.y, null, ms];
});

const log = (...a) => { const line = a.join(' '); console.log(line); fs.appendFileSync(path.join(OUT, 'result.txt'), `${line}\n`); };
setTimeout(() => { log('FAIL timed out'); app.exit(1); }, 90000);

app.whenReady().then(async () => {
  ipcMain.handle('ask:key', () => ({ key: 'DoubleCtrl', label: 'Ctrl Ctrl' }));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'result.txt'), '');
  const display = screen.getPrimaryDisplay();
  let saved = { island: true, islandPos: { mode: 'top', fx: 0.5, fy: 0 }, widgets: {}, islandPulse: false, motion: 'full' };
  const settings = { get: () => saved, set: (p) => { saved = { ...saved, ...p }; } };
  const island = createIsland({
    recent: { list: () => ({ files: [], texts: [] }) },
    cropBackdrop: () => null, captureBackdrop: () => null, openSettings: () => {}, settings, hook: null,
  });
  const win = island.win;
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await wait(1500);

  const drop = () => dropRect(win.getBounds(), computeLayout(display, saved.islandPos).layout);
  const grabAt = () => { const d = drop(); return { x: d.cx, y: d.top + 28 }; };
  const shot = async (name) => fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const js = (code) => win.webContents.executeJavaScript(code);
  const results = [];
  const check = (name, ok, info) => { results.push(!!ok); log(`${ok ? 'PASS' : 'FAIL'} ${name}`, info ? JSON.stringify(info) : ''); };

  // 1) top edge -> middle of the screen, the way a person does it: rest on the drop (the panel
  //    opens under the cursor), then press and drag. The press lands on whatever is there, even a tab.
  const a = grabAt();
  const mid = { x: display.workArea.x + display.workArea.width * 0.5, y: display.workArea.y + display.workArea.height * 0.45 };
  const pa = phys(a);
  if (process.env.DRAG_DEBUG) {
    const out = require('child_process').execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(os.tmpdir(), 'wfp.ps1'), String(pa.x), String(pa.y)]).toString().trim();
    log('window under grab point:', out, 'island pid', process.pid, win.webContents.getOSProcessId());
  }
  await js(`window.__ev = []; for (const t of ['pointerdown','pointermove','pointerup','mousedown','mousemove','click']) addEventListener(t, (e) => { if (window.__ev.length < 60 && !(t.endsWith('move') && window.__ev.at(-1)?.startsWith(t))) window.__ev.push(t + ' ' + e.clientX + ',' + e.clientY + ' b' + e.buttons + ' ' + document.body.dataset.state + ' dew=' + JSON.stringify(document.getElementById('dew').getBoundingClientRect().toJSON())); }, true); 0`);
  await mouse([[pa.x - 3, pa.y, null, 40], [pa.x, pa.y, null, 450], [pa.x, pa.y, 'down', 60], ...path2(a, { x: a.x + 30, y: a.y + 40 }, 3, 16), ...path2({ x: a.x + 30, y: a.y + 40 }, mid, 24, 16)]);
  await wait(120);
  const midDrag = await js(`({ moving: document.body.classList.contains('moving'), float: document.body.classList.contains('float'), sx: getComputedStyle(document.body).getPropertyValue('--sx') })`);
  check('stretches and floats while being carried', midDrag.moving && midDrag.float, midDrag);
  if (process.env.DRAG_DEBUG) log('window', JSON.stringify({ visible: win.isVisible(), top: win.isAlwaysOnTop(), bounds: win.getBounds(), grabDip: a, grabPhys: pa }));
  if (process.env.DRAG_DEBUG) log('events', JSON.stringify(await js('window.__ev')));
  await shot('1-carrying');
  const pm = phys(mid);
  await mouse([[pm.x, pm.y, 'up', 50]]);
  await wait(800);
  const b = win.getBounds();
  check('lands where it was dropped (floating)', saved.islandPos.mode === 'float' && Math.abs(drop().cx - mid.x) < 6 && Math.abs(drop().top + 28 - mid.y) < 8, { pos: saved.islandPos, drop: drop(), want: mid, bounds: b });
  check('wobbles to rest', await js(`document.body.classList.contains('settle') || !document.body.classList.contains('moving')`));
  await wait(700);
  await shot('2-floating');

  // 2) middle -> back up to the top edge: it previews clinging on the way, then snaps.
  const c = grabAt();
  const top = { x: c.x - 120, y: display.bounds.y + 22 };
  const pc = phys(c);
  if (process.env.DRAG_DEBUG) await js(`window.__ev2 = []; for (const t of ['pointerdown','pointermove','pointerup']) addEventListener(t, (e) => { if (window.__ev2.length < 40 && !(t === 'pointermove' && window.__ev2.at(-1)?.startsWith(t))) window.__ev2.push(t + ' ' + e.clientX + ',' + e.clientY + ' ' + (e.target.className?.baseVal ?? e.target.className) + ' ' + document.body.dataset.state); }, true); 0`);
  await mouse([[pc.x - 3, pc.y, null, 40], [pc.x, pc.y, null, 450], [pc.x, pc.y, 'down', 60], ...path2(c, { x: c.x - 20, y: c.y - 30 }, 3, 16), ...path2({ x: c.x - 20, y: c.y - 30 }, top, 22, 16)]);
  await wait(150);
  if (process.env.DRAG_DEBUG) log('events2', JSON.stringify(await js('window.__ev2')), JSON.stringify({ grab: c, bounds: win.getBounds() }));
  const near = await js(`document.body.classList.contains('near-top')`);
  check('previews clinging near the top edge', near);
  await shot('3-near-top');
  const pt = phys(top);
  await mouse([[pt.x, pt.y, 'up', 50]]);
  await wait(800);
  check('snaps back to the top edge', saved.islandPos.mode === 'top' && win.getBounds().y === display.bounds.y && Math.abs(drop().cx - top.x) < 6, { pos: saved.islandPos, drop: drop() });
  const after = await js(`({ float: document.body.classList.contains('float'), moving: document.body.classList.contains('moving') })`);
  check('looks like the top-edge drop again', !after.float && !after.moving, after);
  await shot('4-snapped');

  // Park the cursor away from the island so it doesn't open on hover after the test.
  const away = phys({ x: display.workArea.x + display.workArea.width * 0.5, y: display.workArea.y + display.workArea.height * 0.8 });
  await mouse([[away.x, away.y, null, 10]]);
  const ok = results.every(Boolean);
  log(ok ? '\nALL OK' : '\nFAILED');
  app.exit(ok ? 0 : 1);
});
