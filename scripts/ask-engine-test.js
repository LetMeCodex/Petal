// The Ask engine against real files: search, in-use and safety checks, duplicates, caches, and a
// real trip to the Recycle Bin and back. Works only in its own test folder, and puts back
// everything it moves. Run: npx electron scripts/ask-engine-test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell } = require('electron');
const { createEngine } = require('../src/ask/engine');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

app.whenReady().then(async () => {
  // Under the home folder, like real user files (Temp is app data and the cleanup rules treat it so).
  const root = path.join(os.homedir(), `Petal Ask Test ${process.pid}`);
  const dl = path.join(root, 'Downloads');
  fs.mkdirSync(dl, { recursive: true });
  const put = (name, bytes, fill = 0, ageDays = 0) => {
    const p = path.join(root, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const b = Buffer.alloc(bytes, fill);
    b.write(name, 0);   // different content per file unless `fill` and name match on purpose
    fs.writeFileSync(p, b);
    if (ageDays) { const t = new Date(Date.now() - ageDays * 864e5); fs.utimesSync(p, t, t); }
    return p;
  };
  const big1 = put('Big Video.mp4', 3 * MB, 1);
  const big2 = put('Projects/Render.mov', 2 * MB, 2);
  put('notes.txt', 2000, 3);
  const dupA = put('Photos/Trip.jpg', Math.round(1.5 * MB), 7);
  const dupB = path.join(root, 'Downloads', 'Trip.jpg'); fs.copyFileSync(dupA, dupB);
  const locked = put('Locked Export.mp4', Math.round(2.5 * MB), 4);
  put('Downloads/OldSetup.exe', 300 * 1024, 5, 60);
  put('Downloads/NewSetup.exe', 300 * 1024, 6, 1);

  // Another app holding a file open (no sharing), like an editor with a project open.
  const holder = spawn('powershell', ['-NoProfile', '-Command', `$f=[IO.File]::Open('${locked.replace(/'/g, "''")}','Open','Read','None'); Start-Sleep 40; $f.Close()`], { stdio: 'ignore' });
  await wait(2500);

  const engine = createEngine({ dirs: { downloads: dl }, trashItem: (p) => shell.trashItem(p), undoFile: path.join(root, 'undo.json') });
  const results = [];
  const check = (name, ok, info) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, info !== undefined ? JSON.stringify(info) : ''); };
  const names = (items) => items.map((i) => i.name);

  try {
    // 1) The question from the video, aimed at the test folder.
    let snapshots = 0;
    const r = await engine.ask(`show me files over 1.8mb in "${root}"`, {}, (e) => { if (e.type === 'items') snapshots++; });
    check('finds files over 1.8 MB, biggest first', r.intent.kind === 'find' && names(r.items).join() === 'Big Video.mp4,Locked Export.mp4,Render.mov', names(r.items));
    check('streams results while searching', snapshots >= 1, { snapshots });
    const lk = r.items.find((i) => i.name === 'Locked Export.mp4');
    check('marks a file another app has open', lk?.blocked === 'open in another app', lk?.blocked);
    check('counts only what can go', r.count === 2 && r.bytes === 5 * MB, { count: r.count, bytes: r.bytes });

    // 2) Duplicates: byte-identical only, keeps the one outside Downloads.
    const d = await engine.ask(`find duplicate files in "${root}"`, {});
    const g = d.groups?.[0];
    check('finds the duplicate pair', d.groups?.length === 1 && g.copies.length === 1, d.groups?.map((x) => [x.keep.path, x.copies.map((c) => c.path)]));
    check('keeps the original, offers the Downloads copy', g?.keep.path === dupA && g?.copies[0].path === dupB);

    // 3) Caches: only installers over a month old.
    const c = await engine.caches({ only: ['installers'] }, {});
    check('old installers only', c.categories[0]?.items.map((i) => i.name).join() === 'OldSetup.exe', c.categories.map((x) => [x.id, names(x.items)]));

    // 4) Safety: refused before anything is touched.
    const s = await engine.trash([path.join(process.env.WINDIR, 'notepad.exe'), path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'NTUSER.DAT')]);
    check('refuses Windows, main folders and the profile', s.moved.length === 0 && s.failed.length === 3, s.failed.map((f) => f.reason));

    // 5) The real trip: to the Recycle Bin, then Undo puts it back where it was.
    const t = await engine.trash([big1, locked, big2]);
    check('moves files to the Recycle Bin', t.moved.length === 2 && !fs.existsSync(big1) && !fs.existsSync(big2), t);
    check('skips the open file', t.failed.length === 1 && t.failed[0].path === locked && fs.existsSync(locked), t.failed);
    check('reports what it moved', t.bytes === 5 * MB && !!t.batchId);
    const u = await engine.undo(t.batchId);
    check('Undo restores them where they were', u.restored?.length === 2 && fs.statSync(big1).size === 3 * MB && fs.statSync(big2).size === 2 * MB, u);

    // 5b) Free the space now: only this batch leaves the bin for good (the test's own file).
    const t2 = await engine.trash([big2]);
    const p = await engine.purge(t2.batchId);
    const again = await require('../src/fsx').run('restore', { paths: [big2] });
    check('Free now deletes only that batch from the bin', p.purged === 1 && p.bytes === 2 * MB && again.items[0]?.ok === false && !fs.existsSync(big2), { p, again: again.items });
    fs.writeFileSync(big2, Buffer.alloc(2 * MB, 2));

    // 6) An action selection: latest images, nothing to delete.
    const a = await engine.ask(`compress images in "${root}"`, {});
    check('action picks the images', a.intent.kind === 'action' && names(a.items).sort().join() === 'Trip.jpg,Trip.jpg', names(a.items));

    // 7) "here" without a folder says what to do instead of guessing.
    const h = await engine.ask('biggest files here', {});
    check('"here" needs an open folder', h.type === 'error' && /File Explorer/.test(h.error), h.error);
  } catch (err) {
    check('no crash', false, err.stack);
  } finally {
    holder.kill();
    await wait(500);
    fs.rmSync(root, { recursive: true, force: true });   // the test's own folder only
  }
  const ok = results.every(Boolean);
  console.log(ok ? '\nALL OK' : '\nFAILED');
  app.exit(ok ? 0 : 1);
});
