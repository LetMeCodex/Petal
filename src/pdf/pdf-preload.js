const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfBridge', {
  onRender: (fn) => ipcRenderer.on('pdf:render', (_e, job) => fn(job)),
  reply: (result) => ipcRenderer.send('pdf:result', result),
});
