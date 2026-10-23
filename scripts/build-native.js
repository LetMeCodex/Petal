// Compiles the native helpers fresh, for packaging (the installed app ships them prebuilt).
// Run: node scripts/build-native.js
const native = require('../src/native');

for (const [name, args] of [['hook', []], ['fs', ['/r:System.Web.Extensions.dll']]]) {
  console.log('built', native.build(name, args, { force: true }));
}
