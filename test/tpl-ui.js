const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));
require('../main');

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.setPosition(-3000, 0);
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  await win.webContents.executeJavaScript(`
    state.view='work'; state.workTab=5; state.rightPanel='template';
    state.p.edit.template=5; state.p.edit.headTop='필수템'; state.p.edit.headTitle='이렇게 있습니다';
    state.p.scenes=[{src:0,clip:0,dur:3,text:'자막',line:0}];
    state.userTemplates=[{name:'저장 1', template:9, headTitle:'저장한 제목', thumb:''}];
    render();
  `);
  await new Promise((r) => setTimeout(r, 600));
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 300));
  fs.writeFileSync(path.join(__dirname, 'shots', 'tpl-panel.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`state.modal={type:'prep'}; state.p.edit.effect='float'; render();`);
  await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync(path.join(__dirname, 'shots', 'fx-modal.png'), (await win.webContents.capturePage()).toPNG());
  console.log('errors', errors.length, errors[0] || '');
  app.quit();
});
