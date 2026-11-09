const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));
require('../main');

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 1000));
  const win = BrowserWindow.getAllWindows()[0];
  win.setPosition(-3000, 0);
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  const shot = async (name) => {
    try {
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 400));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(__dirname, 'shots', name), img.toPNG());
      console.log('shot', name);
    } catch (e) { console.log('shot-fail', e.message); }
  };
  const thumb = 'C:/Users/{C/Documents/ShoppingLens/휴대용선풍기/scenes/src1_0.jpg';
  await win.webContents.executeJavaScript(`
    state.view='work'; state.workTab=1;
    state.p.analyzed=true;
    state.p.videos=[{title:'화이트 셔츠', done:true, file:'x', dur:20, size:15000000, thumb:${JSON.stringify(thumb)},
      scenes:[0,1,2,3].map(i => ({start:i, end:i+1.2, dur:1.2, thumb:${JSON.stringify(thumb)}, label:'장면 '+(i+1)}))}];
    render();
  `);
  await shot('prep-scenes.png');
  const info = await win.webContents.executeJavaScript(`({
    clips: document.querySelectorAll('.clip').length,
    next: !!document.querySelector('[data-act="workTab"][data-val="2"]')
  })`);
  console.log('dom', JSON.stringify(info), 'errors', errors.length);
  app.quit();
});
