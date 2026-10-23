// One-time move from the old "dropwheel" data folder: keeps the user's trigger choice and,
// more importantly, the 178 MB background-removal model so nobody downloads it twice.
const fs = require('fs');
const path = require('path');

function migrate(appData, userData) {
  const old = path.join(appData, 'dropwheel');
  if (!fs.existsSync(old) || path.resolve(old) === path.resolve(userData)) return [];
  fs.mkdirSync(userData, { recursive: true });
  const moved = [];
  for (const name of ['settings.json', 'models']) {
    const from = path.join(old, name), to = path.join(userData, name);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    try {
      fs.renameSync(from, to); // same drive, so this is instant even for the model
      moved.push(name);
    } catch {
      // Locked or cross-device: leave it; the model will simply download again on first use.
    }
  }
  return moved;
}

module.exports = { migrate };
