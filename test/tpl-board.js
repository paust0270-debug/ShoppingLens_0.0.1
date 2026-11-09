const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const tmp = path.join(os.tmpdir(), 'sl-tpl-board');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.cpSync(path.join(app.getPath('appData'), 'ShoppingLens', 'bin'), path.join(tmp, 'bin'), { recursive: true });
app.setPath('userData', tmp);
require('../main');

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 800));
  const win = BrowserWindow.getAllWindows()[0];
  win.setPosition(80, 40);
  win.show();
  const info = await win.webContents.executeJavaScript(`(async()=>{
    state.view='work'; state.workTab=5; state.rightPanel='template';
    state.p.subtitles=[{start:0,end:2,text:'이거 진짜 좋아요',line:0}];
    state.p.edit.template=0;
    render();
    return document.querySelectorAll('.tpl-grid .tpl').length;
  })()`);
  console.log('cards', info);
  await new Promise((r) => setTimeout(r, 400));
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(path.join(shots, 'tpl-board.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`state.p.edit.template=4;render();`);
  await new Promise((r) => setTimeout(r, 200));
  fs.writeFileSync(path.join(shots, 'tpl-glass.png'), (await win.webContents.capturePage()).toPNG());
  app.quit();
});
