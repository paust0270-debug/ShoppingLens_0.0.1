const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('native', {
  api: (name, ...args) => ipcRenderer.invoke('api', name, ...args),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, data) => cb(data)),
  onBlast: (cb) => ipcRenderer.on('blast-update', () => cb()),
  pathFor: (file) => webUtils.getPathForFile(file),
});
