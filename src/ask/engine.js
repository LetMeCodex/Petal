// Petal Ask, the doing part: find files, duplicates, caches, what's taking space; move things to
// the Recycle Bin and put them back. Never deletes anything for good.
// Electron-free so it can be tested on its own: the app passes in `trashItem` and the known folders.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fsx = require('../fsx');
const { parse, KINDS, MB, DAY } = require('./parse');
const { blocked, WALK_SKIP, HOME } = require('./safety');

const lower = (p) => p.toLowerCase();
const extOf = (p) => path.extname(p).toLowerCase();

function createEngine({ dirs = {}, trashItem, undoFile, now = () => Date.now() } = {}) {
  const known = {
    downloads: dirs.downloads || path.join(HOME, 'Downloads'),
    desktop: dirs.desktop || path.join(HOME, 'Desktop'),
    documents: dirs.documents || path.join(HOME, 'Documents'),
    pictures: dirs.pictures || path.join(HOME, 'Pictures'),
    videos: dirs.videos || path.join(HOME, 'Videos'),
    music: dirs.music || path.join(HOME, 'Music'),
    temp: dirs.temp || os.tmpdir(),
    localAppData: process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'),
  };

  // Friendly "Downloads › Games" for a file's folder.
  function where(p) {
    const dir = path.dirname(p);
    for (const [key, d] of Object.entries(known)) {
      if (!['downloads', 'desktop', 'documents', 'pictures', 'videos', 'music'].includes(key)) continue;
      if (lower(dir) === lower(d) || lower(dir).startsWith(`${lower(d)}\\`)) {
        const rest = path.relative(d, dir).split(path.sep).filter(Boolean);
        const name = key[0].toUpperCase() + key.slice(1);
        return [name, ...rest.slice(-2)].join(' › ');
      }
    }
    if (lower(dir).startsWith(`${lower(HOME)}\\`)) return path.relative(HOME, dir).split(path.sep).slice(-3).join(' › ');
    return dir.length > 48 ? `…${dir.slice(-46)}` : dir;
  }

  function otherDrives() {
    const sys = (process.env.SystemDrive || 'C:').toUpperCase();
    const out = [];
    for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      if (`${l}:` === sys) continue;
      try { if (fs.statSync(`${l}:\\`).isDirectory()) out.push(`${l}:\\`); } catch { /* no such drive */ }
    }
    return out;
  }

  // Where to look. Throws a message the panel can show when "here" has no folder behind it.
  function scopes(filters = {}, ctx = {}, { defaults = 'home+drives' } = {}) {
    if (filters.places?.length) {
      return filters.places.map((p) => {
        if (p.key === 'here') { if (!ctx.folder) throw new Error('Open the folder in File Explorer first, then ask again'); return ctx.folder; }
        if (p.key === 'path') return p.path;
        return known[p.key];
      }).filter(Boolean);
    }
    if (filters.screenshots) return [path.join(known.pictures, 'Screenshots'), known.pictures, known.desktop, known.downloads];
    if (defaults === 'actions') return ctx.folder ? [ctx.folder] : [known.downloads, known.desktop, known.pictures, known.documents];
    return defaults === 'home' ? [HOME] : [HOME, ...otherDrives()];
  }

  // ---------- probing: online-only, open in another app, size on disk ----------
  async function probe(list) {
    const items = list.filter((i) => !i.probed);
    for (const i of items) i.probed = true;
    const byPath = new Map(items.map((i) => [lower(i.path), i]));
    for (let i = 0; i < items.length; i += 300) {
      const { items: res } = await fsx.run('probe', { paths: items.slice(i, i + 300).map((x) => x.path), inUse: true });
      for (const r of res) {
        const it = byPath.get(lower(r.path));
        if (!it) continue;
        if (r.missing) { it.blocked = 'gone already'; continue; }
        it.cloud = r.cloud;
        it.onDisk = r.onDisk >= 0 ? r.onDisk : it.size;
        if (r.cloud) it.blocked = 'online-only in OneDrive (frees nothing here)';
        else if (r.inUse === 'open') it.blocked = 'open in another app';
        else if (r.inUse === 'denied') it.blocked = 'Windows won\'t let Petal touch it';
      }
    }
    return items;
  }

  function toItem(r) {
    return { id: lower(r.path), path: r.path, name: path.basename(r.path), where: where(r.path), ext: extOf(r.path).slice(1), size: r.size, onDisk: r.size, mtime: r.mtime, blocked: blocked(r.path) || (r.cloud ? 'online-only in OneDrive (frees nothing here)' : null) };
  }

  // ---------- find ----------
  // Streams snapshots to `emit({ type: 'items', items, scanned, partial })` while searching.
  async function find(filters, ctx, emit, { limit = 200, defaults } = {}) {
    const t0 = now();
    const roots = scopes(filters, ctx, { defaults });
    const found = new Map();
    let scanned = 0, partial = false;
    const matches = (r) => {
      if (filters.minSize && r.size < filters.minSize) return false;
      if (filters.maxSize && r.size > filters.maxSize) return false;
      if (filters.before && r.mtime >= filters.before) return false;
      if (filters.after && r.mtime < filters.after) return false;
      if (filters.exts && !filters.exts.includes(extOf(r.path))) return false;
      if (filters.name && !lower(path.basename(r.path)).includes(filters.name)) return false;
      if (filters.screenshots && !/screenshot|screen shot|capture|snip/i.test(path.basename(r.path)) && !/screenshots/i.test(path.dirname(r.path))) return false;
      return true;
    };
    const add = (r) => { if (r.path && !r.dir && matches(r) && !found.has(lower(r.path))) found.set(lower(r.path), toItem(r)); };
    const sorted = () => {
      const all = [...found.values()];
      all.sort(filters.sort === 'date' ? (a, b) => b.mtime - a.mtime : (a, b) => b.size - a.size);
      return all.slice(0, filters.latest || filters.top || limit);
    };
    let last = 0;
    const tick = (force) => { if (force || now() - last > 120) { last = now(); emit?.({ type: 'items', items: sorted(), scanned, partial: true }); } };

    const request = {
      minSize: filters.minSize || 0, exts: filters.exts || [], before: filters.before || 0, after: filters.after || 0,
      name: filters.name || '', sort: filters.sort === 'date' ? 'date' : 'size',
    };
    // The search index answers first (well under a second); a real walk then fills in what the
    // index doesn't cover (other drives, unindexed folders, files written seconds ago).
    const indexed = roots.filter((r) => lower(r).startsWith(lower(HOME)));
    let indexOk = false;
    if (indexed.length) {
      const res = await fsx.run('index', { ...request, scopes: indexed, top: Math.max(500, limit * 3) }, (r) => { add(r); tick(); });
      indexOk = !res.error;
      if (res.error) partial = true;
    }
    // Ready to act on now: check what the index found (open, online-only) and hand it over. The
    // walk below only adds what the index missed, so nobody waits for it to start cleaning up.
    if (indexOk && found.size) {
      await probe(sorted().filter((i) => !i.blocked));
      emit?.({ type: 'items', ready: true, items: sorted(), scanned, partial: true, ms: now() - t0 });
    } else tick(true);
    // With a working index the walk only fills gaps (unindexed folders, other drives), so keep it short.
    const walkMs = indexOk ? 6000 : roots.length === 1 && roots[0] !== HOME ? 15000 : 25000;
    const res = await fsx.run('walk', { ...request, roots, skip: WALK_SKIP, maxMs: walkMs, max: 50000 }, (r) => {
      if (r.scanned != null) scanned = r.scanned;
      else if (r.partial) partial = true;
      else { add(r); tick(); }
    });
    if (res.error) partial = true;
    const items = await probe(sorted().filter((i) => !i.blocked)).then(() => sorted());
    const result = { type: 'done', items, scanned, partial, ms: now() - t0, ...totals(items) };
    emit?.(result);
    return result;
  }

  const totals = (items) => {
    const ok = items.filter((i) => !i.blocked);
    return { count: ok.length, bytes: ok.reduce((s, i) => s + (i.onDisk ?? i.size), 0) };
  };

  // ---------- duplicates ----------
  // Same size, then same first 64 KB, then the same full SHA-1: only byte-identical files count.
  async function duplicates(filters, ctx, emit) {
    const t0 = now();
    const minSize = filters.minSize || (filters.exts?.every((e) => KINDS.image.includes(e)) ? 50 * 1024 : MB);
    emit?.({ type: 'status', text: 'Listing files…' });
    const { items } = await find({ ...filters, minSize, sort: 'size' }, ctx, null, { limit: 20000, defaults: 'home' });
    const bySize = new Map();
    for (const it of items) if (!it.blocked) (bySize.get(it.size) || bySize.set(it.size, []).get(it.size)).push(it);
    let groups = [...bySize.values()].filter((g) => g.length > 1);
    emit?.({ type: 'status', text: `Comparing ${groups.reduce((s, g) => s + g.length, 0)} look-alikes…` });
    groups = await refine(groups, (f) => hashHead(f));
    groups = await refine(groups, (f) => hashFile(f));
    const out = groups.map((g) => {
      // Keep the copy that looks like the original: not in Downloads/Desktop, oldest, shortest path.
      const score = (i) => (/^(downloads|desktop)/i.test(i.where) ? 1 : 0) * 1e15 + i.mtime / 1e3 + i.path.length;
      const sortedG = [...g].sort((a, b) => score(a) - score(b));
      return { keep: sortedG[0], copies: sortedG.slice(1), bytes: sortedG.slice(1).reduce((s, i) => s + (i.onDisk ?? i.size), 0) };
    }).sort((a, b) => b.bytes - a.bytes);
    const result = { type: 'done', groups: out, ms: now() - t0, count: out.reduce((s, g) => s + g.copies.length, 0), bytes: out.reduce((s, g) => s + g.bytes, 0) };
    emit?.(result);
    return result;
  }
  async function refine(groups, keyOf) {
    const out = [];
    for (const g of groups) {
      const by = new Map();
      for (const it of g) {
        let k;
        try { k = await keyOf(it.path); } catch { continue; }
        (by.get(k) || by.set(k, []).get(k)).push(it);
      }
      for (const sub of by.values()) if (sub.length > 1) out.push(sub);
    }
    return out;
  }
  async function hashHead(file) {
    const fd = await fs.promises.open(file, 'r');
    try {
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      return crypto.createHash('sha1').update(buf.subarray(0, bytesRead)).digest('hex');
    } finally { await fd.close(); }
  }
  function hashFile(file) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha1');
      fs.createReadStream(file, { highWaterMark: 1 << 20 }).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
  }

  // ---------- caches and junk ----------
  // Only things that rebuild themselves or that nobody needs back. Each comes with why it's safe.
  async function caches(intent, ctx, emit) {
    const t0 = now();
    const L = known.localAppData;
    const old = now() - 30 * DAY;
    const cats = [];
    const only = intent.only;
    const want = (id) => !only || only.includes(id);

    if (want('temp')) {
      const entries = safeList(known.temp).filter((e) => e.mtime < now() - DAY);
      cats.push({ id: 'temp', title: 'Temporary files', why: 'Left behind by apps and installers. Anything still in use is skipped.', paths: entries.map((e) => e.path), allow: [known.temp] });
    }
    if (want('devcaches')) {
      const dev = [
        ['npm cache', path.join(L, 'npm-cache')], ['Yarn cache', path.join(L, 'Yarn', 'Cache')], ['pnpm store', path.join(L, 'pnpm', 'store')],
        ['pip cache', path.join(L, 'pip', 'Cache')], ['Gradle caches', path.join(HOME, '.gradle', 'caches')], ['NuGet packages', path.join(HOME, '.nuget', 'packages')],
        ['Go build cache', path.join(L, 'go-build')], ['Electron downloads', path.join(L, 'electron', 'Cache')],
      ].filter(([, p]) => fs.existsSync(p));
      if (dev.length) cats.push({ id: 'devcaches', title: 'Developer caches', why: `${dev.map(([n]) => n).join(', ')}. Downloaded again the next time a build needs them.`, paths: dev.map(([, p]) => p), allow: dev.map(([, p]) => p) });
    }
    if (want('crash')) {
      const crash = [path.join(L, 'CrashDumps'), path.join(L, 'Microsoft', 'Windows', 'WER', 'ReportArchive')].filter((p) => fs.existsSync(p));
      const entries = crash.flatMap((d) => safeList(d).map((e) => e.path));
      cats.push({ id: 'crash', title: 'Crash reports', why: 'Memory dumps and reports from apps that crashed. Only useful to their developers.', paths: entries, allow: crash });
    }
    if (want('installers')) {
      const inst = safeList(known.downloads).filter((e) => !e.dir && KINDS.installer.includes(extOf(e.path)) && e.mtime < old);
      cats.push({ id: 'installers', title: 'Old installers in Downloads', why: 'Setup files over a month old. The apps are installed already; the setup files aren\'t needed.', paths: inst.map((e) => e.path), allow: [] });
    }
    if (want('node_modules')) {
      emit?.({ type: 'status', text: 'Looking for old node_modules…' });
      const { items } = await fsx.run('walk', { roots: [HOME], skip: WALK_SKIP.filter((s) => s !== 'node_modules'), stopAt: ['node_modules'], maxMs: 20000, minSize: Number.MAX_SAFE_INTEGER });
      const dirsFound = items.filter((i) => i.dir && !/node_modules.*node_modules/i.test(i.path));
      const stale = [];
      for (const d of dirsFound) {
        const project = path.dirname(d.path);
        const touched = Math.max(d.mtime, ...['package.json', 'package-lock.json', 'src'].map((f) => { try { return fs.statSync(path.join(project, f)).mtimeMs; } catch { return 0; } }));
        if (touched < old) stale.push(d.path);
      }
      cats.push({ id: 'node_modules', title: 'Old node_modules folders', why: 'From projects untouched for 30+ days. `npm install` brings them back.', paths: stale, allow: [] });
    }

    // Sizes, all folders in one helper run.
    const all = cats.flatMap((c) => c.paths);
    const sizes = new Map();
    if (all.length) {
      const { items } = await fsx.run('du', { paths: all, maxMs: 30000 });
      for (const r of items) sizes.set(lower(r.path), r);
    }
    for (const c of cats) {
      c.items = c.paths.map((p) => {
        const s = sizes.get(lower(p)) || { bytes: 0, files: 0 };
        return { id: lower(p), path: p, name: path.basename(p), where: where(p), size: s.bytes, onDisk: s.bytes, files: s.files, mtime: s.newest, blocked: blocked(p, { allow: c.allow }) };
      }).filter((i) => !i.blocked && i.size > 0).sort((a, b) => b.size - a.size);
      c.bytes = c.items.reduce((s, i) => s + i.size, 0);
      delete c.paths;
    }
    const result = { type: 'done', categories: cats.filter((c) => c.items.length), ms: now() - t0 };
    result.bytes = result.categories.reduce((s, c) => s + c.bytes, 0);
    emit?.(result);
    return result;
  }
  function safeList(dir) {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).map((d) => {
        const p = path.join(dir, d.name);
        let st; try { st = fs.lstatSync(p); } catch { return null; }
        return st.isSymbolicLink() ? null : { path: p, dir: st.isDirectory(), mtime: st.mtimeMs };
      }).filter(Boolean);
    } catch { return []; }
  }

  // ---------- what's taking space ----------
  async function space(ctx, emit) {
    const t0 = now();
    const top = ['downloads', 'desktop', 'documents', 'pictures', 'videos', 'music'].map((k) => [k[0].toUpperCase() + k.slice(1), known[k]]);
    for (const e of safeList(HOME)) if (e.dir && !/^(appdata|downloads|desktop|documents|pictures|videos|music|onedrive.*|ntuser.*)$/i.test(path.basename(e.path)) && !path.basename(e.path).startsWith('.')) top.push([path.basename(e.path), e.path]);
    top.push(['App data', path.join(HOME, 'AppData')]);
    const { items } = await fsx.run('du', { paths: top.map(([, p]) => p), maxMs: 25000 });
    const byPath = new Map(items.map((r) => [lower(r.path), r]));
    const folders = top.map(([name, p]) => ({ name, path: p, bytes: byPath.get(lower(p))?.bytes || 0, partial: byPath.get(lower(p))?.partial })).filter((f) => f.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 8);
    const drives = [process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\', ...otherDrives()].map((d) => {
      try { const s = fs.statfsSync(d); return { drive: d, total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; }
    }).filter(Boolean);
    const big = await find({ minSize: 200 * MB, sort: 'size' }, ctx, null, { limit: 8, defaults: 'home' });
    const result = { type: 'done', folders, drives, items: big.items.slice(0, 8), ms: now() - t0 };
    emit?.(result);
    return result;
  }

  // ---------- one entry point ----------
  async function ask(text, ctx = {}, emit, intent = parse(text)) {
    try {
      emit?.({ type: 'plan', intent });
      if (intent.kind === 'find') return { intent, ...(await find(intent.filters, ctx, emit)) };
      if (intent.kind === 'duplicates') return { intent, ...(await duplicates(intent.filters, ctx, emit)) };
      if (intent.kind === 'caches') return { intent, ...(await caches(intent, ctx, emit)) };
      if (intent.kind === 'space') return { intent, ...(await space(ctx, emit)) };
      if (intent.kind === 'action') {
        // Actions only read the files and write new ones next to them, so a file another app has
        // open is fine; online-only files are left out (reading would download them).
        const r = await find(intent.filters, ctx, null, { limit: intent.filters.latest || 60, defaults: 'actions' });
        for (const i of r.items) if (i.blocked === 'open in another app') i.blocked = null;
        const items = r.items.filter((i) => !i.blocked);
        const out = { ...r, items, ...totals(items) };
        emit?.(out);
        return { intent, ...out };
      }
      return { intent, type: 'done', items: [] };
    } catch (err) {
      const r = { intent, type: 'error', error: err.message };
      emit?.(r);
      return r;
    }
  }

  // ---------- trash and undo ----------
  const batches = loadBatches();
  function loadBatches() { try { return JSON.parse(fs.readFileSync(undoFile, 'utf8')); } catch { return []; } }
  function saveBatches() { if (undoFile) try { fs.writeFileSync(undoFile, JSON.stringify(batches.slice(-10))); } catch { /* best effort */ } }

  // Moves files (or cache folders) to the Recycle Bin, after checking each one again right now.
  // `allow`: app-data paths a cache category vetted. Returns what moved, what didn't and why.
  async function trash(list, { allow = [] } = {}) {
    const items = list.map((x) => (typeof x === 'string' ? { path: x } : { ...x }));
    const moved = [], failed = [];
    for (const it of items) { const why = blocked(it.path, { allow }); if (why) { failed.push({ path: it.path, reason: why }); it.skip = true; } }
    const files = items.filter((i) => !i.skip);
    // Fresh look: still there, not opened since, not online-only.
    const fileOnly = files.filter((i) => { try { return fs.statSync(i.path).isFile(); } catch { failed.push({ path: i.path, reason: 'gone already' }); i.skip = true; return false; } });
    await probe(fileOnly);
    // Will the Recycle Bin really take it? Too big, or a drive with the bin off, means Windows
    // would delete it for good instead, so Petal refuses.
    const drives = [...new Set(files.map((i) => path.parse(i.path).root.toUpperCase()))];
    const { items: bins } = drives.length ? await fsx.run('bin', { drives }) : { items: [] };
    const bin = new Map(bins.map((b) => [b.drive.toUpperCase(), b]));
    for (const it of files) {
      if (it.skip) continue;
      if (it.blocked) { failed.push({ path: it.path, reason: it.blocked }); continue; }
      const b = bin.get(path.parse(it.path).root.toUpperCase());
      const bytes = it.onDisk ?? it.size ?? 0;
      if (b?.nuke) { failed.push({ path: it.path, reason: 'the Recycle Bin is off for this drive, so it would be gone for good' }); continue; }
      if (b && bytes > b.capacity) { failed.push({ path: it.path, reason: 'too big for the Recycle Bin, so it would be gone for good' }); continue; }
      try {
        await trashItem(it.path);
        moved.push({ path: it.path, bytes });
      } catch (err) { failed.push({ path: it.path, reason: err.message }); }
    }
    let batch = null;
    if (moved.length) {
      batch = { id: `b${now().toString(36)}`, at: now(), items: moved };
      batches.push(batch);
      saveBatches();
    }
    return { batchId: batch?.id, moved, failed, bytes: moved.reduce((s, m) => s + m.bytes, 0) };
  }

  async function undo(batchId) {
    const i = batchId ? batches.findIndex((b) => b.id === batchId) : batches.length - 1;
    if (i < 0) return { error: 'Nothing to undo' };
    const batch = batches[i];
    const { items, error } = await fsx.run('restore', { paths: batch.items.map((m) => m.path) });
    if (error) return { error };
    const restored = items.filter((r) => r.ok).map((r) => r.path);
    const failed = items.filter((r) => !r.ok);
    batches.splice(i, 1);
    saveBatches();
    return { restored, failed, bytes: batch.items.filter((m) => restored.includes(m.path)).reduce((s, m) => s + m.bytes, 0) };
  }

  // "Free the space now": delete for good only what this batch put in the Recycle Bin. Asked for
  // explicitly, after Petal's own confirmation; there's no Undo after this.
  async function purge(batchId) {
    const i = batches.findIndex((b) => b.id === batchId);
    if (i < 0) return { error: 'Those items are no longer in the Recycle Bin' };
    const batch = batches[i];
    const { items, error } = await fsx.run('purge', { paths: batch.items.map((m) => m.path), since: batch.at - 60000 });
    if (error) return { error };
    const gone = items.filter((r) => r.ok).map((r) => r.path);
    batches.splice(i, 1);
    saveBatches();
    return { purged: gone.length, failed: items.filter((r) => !r.ok), bytes: batch.items.filter((m) => gone.includes(m.path)).reduce((s, m) => s + m.bytes, 0) };
  }

  return { ask, find, purge, duplicates, caches, space, trash, undo, scopes, where, known, lastBatch: () => batches[batches.length - 1] || null };
}

module.exports = { createEngine };
