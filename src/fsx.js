// Node side of native/fs.exe (see fs.cs): one request per run, results streamed back line by line.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, execFileSync } = require('child_process');

const SRC = path.join(__dirname, 'native', 'fs.cs');
const EXE = path.join(__dirname, 'native', 'fs.exe');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

function ensureBuilt() {
  if (fs.existsSync(EXE) && fs.statSync(EXE).mtimeMs >= fs.statSync(SRC).mtimeMs) return;
  execFileSync(CSC, ['/nologo', '/optimize', '/r:System.Web.Extensions.dll', `/out:${EXE}`, SRC]);
}

// Runs one request. `onItem` sees each result as it arrives (so lists can fill in live).
// Resolves with { items, done } once the helper finishes; `cancel()` stops it early.
function run(op, request = {}, onItem) {
  ensureBuilt();
  const proc = spawn(EXE, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const items = [];
  let done = null, error = null;
  const promise = new Promise((resolve) => {
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.done) done = msg;
      else if (msg.error) error = msg.error;
      else { items.push(msg); onItem?.(msg); }
    });
    proc.on('close', () => resolve({ items, done, error }));
    proc.on('error', (err) => resolve({ items, done, error: err.message }));
  });
  proc.stdin.end(JSON.stringify({ op, ...request }));
  promise.cancel = () => { try { proc.kill(); } catch { /* already gone */ } };
  return promise;
}

module.exports = { run, ensureBuilt, EXE };
