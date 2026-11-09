const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { api } = require('./services/api');
const { resetCancel } = require('./services/run');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#f4f1ec',
    title: '쇼핑렌즈',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

ipcMain.handle('api', async (e, name, ...args) => {
  const fn = api[name];
  if (!fn) return { ok: false, error: `알 수 없는 기능: ${name}` };
  if (name !== 'cancel') resetCancel();
  const progress = (data) => {
    if (!e.sender.isDestroyed()) e.sender.send('progress', data);
  };
  try {
    return { ok: true, data: await fn(progress, ...args) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

app.whenReady().then(() => {
  createWindow();
  require('./services/blast').start();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
