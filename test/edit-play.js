const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));
require('../main');

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 900));
  const win = BrowserWindow.getAllWindows()[0];
  win.setPosition(-3000, 0);
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  const file = 'C:/Users/{C/Documents/ShoppingLens/새 프로젝트/videos/src1_mvp0lj5n.mp4';
  const thumb = 'C:/Users/{C/Documents/ShoppingLens/새 프로젝트/scenes/src1_0.jpg';
  try {
    const info = await win.webContents.executeJavaScript(`
      state.view='work'; state.workTab=5;
      state.p.scenes=[];
      state.p.prepared=null;
      state.p.subtitles=[{start:0,end:2,text:'이거 진짜 모르면',line:0},{start:2,end:4,text:'처음 보면',line:0}];
      state.p.videos=[{file:${JSON.stringify(file)}, thumb:${JSON.stringify(thumb)}, hasAudio:true, done:true, title:'세탁', dur:31,
        scenes:[{start:1,end:2.2,dur:1.2,thumb:${JSON.stringify(thumb)},label:'a'},{start:4,end:6,dur:2,thumb:${JSON.stringify(thumb)},label:'b'}]}];
      render();
      ({
        scenes: state.p.scenes.length,
        src: document.querySelector('#pv-video')?.getAttribute('src') || document.querySelector('#pv-video')?.src || '',
        disabled: document.querySelector('[data-act="toggleExport"]')?.disabled,
        note: document.querySelector('.player .muted, .player .small')?.textContent || ''
      })
    `);
    console.log('ui', JSON.stringify(info), 'errors', errors.length);
    const media = require('../services/media');
    const dir = path.join(app.getPath('temp'), 'sl-edit-play');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const out = await media.render(dir, {
      scenes: [{ file, start: 1, dur: 1.2, hasAudio: true }, { file, start: 4, dur: 1.2, hasAudio: true }],
      subs: [{ start: 0.2, end: 1.8, text: '이거 진짜 모르면' }],
      edit: { font: 'Malgun Gothic', size: 72, border: true, filter: 'warm', effect: 'zoom', overlays: [], topBox: { on: false }, bottomBox: { on: false } },
      header: { show: true, top: '리뷰왕', title: '이게 대체 뭐야?', color: '#f5c64a' },
      voiceOn: false, subOn: true, keepAudio: true,
    }, () => {});
    const meta = await media.probe(out);
    console.log('export', meta.width, meta.height, meta.hasAudio, +meta.dur.toFixed(1));
  } catch (e) {
    console.log('FAILED', e.stack || e.message);
  }
  app.quit();
});
