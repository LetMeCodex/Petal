// What the native helper costs at each stats level, and whether its numbers make sense.
// Levels: 0 off, 1 the idle pulse (CPU/RAM/battery), 2 the Glance tab (adds GPU + network).
// Run: node scripts/hook-cost-test.js
const { spawn, execFileSync } = require('child_process');
const hook = require('../src/hook');

const SAMPLE_S = 12;
const BUDGET = { 0: 1, 1: 1.5, 2: 6 };     // % of one core
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cpuSeconds = (pid) => parseFloat(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).CPU`]).toString().trim().replace(',', '.'));

async function run(level) {
  const p = spawn(hook.EXE, [String(process.pid)], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const stats = [];
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) if (l.startsWith('stats ')) stats.push(hook.parseStats(l.trim()));
  });
  if (level) p.stdin.write(`stats ${level}\n`);
  await wait(3000);                       // startup and first samples are not steady state
  const a = cpuSeconds(p.pid);
  await wait(SAMPLE_S * 1000);
  const cost = ((cpuSeconds(p.pid) - a) / SAMPLE_S) * 100;
  p.stdin.end();
  return { cost, stats };
}

(async () => {
  hook.ensureBuilt();
  let ok = true;
  for (const level of [0, 1, 2]) {
    const { cost, stats } = await run(level);
    const last = stats[stats.length - 1];
    const problems = [];
    if (cost > BUDGET[level]) problems.push(`costs ${cost.toFixed(2)}% (budget ${BUDGET[level]}%)`);
    if (level === 0 && stats.length) problems.push('sampled while off');
    if (level > 0) {
      if (stats.length < SAMPLE_S) problems.push(`only ${stats.length} samples`);
      if (!last || !(last.cpu >= 0 && last.cpu <= 100)) problems.push('cpu out of range');
      if (!last || !(last.ram > 0 && last.ramTotal > 0)) problems.push('no ram');
      if (!last || !(last.bat === -1 || (last.bat >= 0 && last.bat <= 100))) problems.push('battery out of range');
    }
    if (level === 1 && last && last.gpu !== -1) problems.push('pulse level should not sample the GPU');
    // The first GPU reading is "not ready" (-1, shown as a dash); after that it must be real.
    if (level === 2 && !stats.slice(2).every((s) => s.gpu >= 0 && s.gpu <= 100)) problems.push(`gpu not ready after 2 samples: ${stats.map((s) => s.gpu).join(',')}`);
    if (level === 2 && !stats.slice(2).every((s) => s.rx >= 0 && s.tx >= 0)) problems.push('network negative');
    ok &&= !problems.length;
    console.log(`${problems.length ? 'FAIL' : 'PASS'} level ${level}  ${cost.toFixed(2)}% of one core  ${problems.join('; ')}`);
    if (last) console.log('     last sample', JSON.stringify(last));
  }
  console.log(ok ? '\nALL OK' : '\nFAILED');
  process.exit(ok ? 0 : 1);
})();
