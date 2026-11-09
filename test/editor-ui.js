const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const qr = require('qrcode');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));
require('../main');

const shot = (name) => path.join(__dirname, 'shots', name);
const thumb = 'C:/Users/{C/Documents/ShoppingLens/휴대용선풍기/scenes/src1_0.jpg';

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.setPosition(-3000, 0);
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  const base = `
    state.view='work'; state.workTab=5; state.p.prepared={voiceFile:''};
    state.p.videos=[{file:'', thumb:${JSON.stringify(thumb)}, hasAudio:false, scenes:[{thumb:${JSON.stringify(thumb)}, start:0, dur:3},{thumb:${JSON.stringify(thumb)}, start:3, dur:3}]}];
    state.p.scenes=[{src:0,clip:0,dur:3,text:'장면',line:0},{src:0,clip:1,dur:3,text:'장면2',line:1}];
    state.p.subtitles=[{start:0,end:2,text:'자막 한 줄',line:0}];
    state.p.edit.overlays=[]; state.p.edit.thumbItems=[];
    state.p.edit.topBox={on:true,color:'#000000',height:18,opacity:85,zoom:50};
    state.p.edit.bottomBox={on:true,color:'#1a1a1a',height:16,opacity:70,zoom:50};
    state.p.edit.header=true; state.p.edit.headTop='리뷰왕'; state.p.edit.headTitle='이게 대체 뭐야?';
    state.selectedOverlay=null; state.exportOpen=false; state.modal=null;
  `;
  await win.webContents.executeJavaScript(base + `state.rightPanel='template'; render();`);
  await win.webContents.executeJavaScript(`
    const pv = document.querySelector('.preview');
    const r = pv.getBoundingClientRect();
    pv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.32 }));
    state.p.edit.overlays.length
  `).then((n) => console.log('dblclick layers', n));
  await new Promise((r) => setTimeout(r, 400));
  fs.mkdirSync(path.dirname(shot('x')), { recursive: true });
  const cap = async (name) => {
    win.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 250));
    fs.writeFileSync(shot(name), (await win.webContents.capturePage()).toPNG());
  };
  await cap('ed-template.png');
  await win.webContents.executeJavaScript(`state.rightPanel='thumb'; state.stickerOpen=true; state.exportOpen=false; state.p.edit.thumbItems=[{id:'t1',kind:'text',text:'문구 입력',x:50,y:24,size:70,bold:true,outline:true,shadow:true,opacity:100,color:'#ffffff'}]; state.selectedOverlay='t1'; render();`);
  await cap('ed-thumb.png');
  await win.webContents.executeJavaScript(`state.exportOpen=true; state.modal=null; render();`);
  await cap('ed-export.png');
  await win.webContents.executeJavaScript(`actions.openCal({val:'upload'}); render();`);
  await cap('ed-cal.png');
  await win.webContents.executeJavaScript(`state.modal={type:'intro'}; render();`);
  await cap('ed-intro.png');
  await win.webContents.executeJavaScript(`state.sfxDraft={make:'plastic film peel, click', remove:'music, speech', volume:40, log:'효과음을 만들면 진행'}; state.modal={type:'sfxai'}; render();`);
  await cap('ed-sfx.png');
  const qrUrl = await qr.toDataURL('http://192.168.0.12:53682/final.mp4', { margin: 1, width: 280 });
  await win.webContents.executeJavaScript(`state.p.thumbnail='x'; state.p.edit.thumbLead=true; state.share={qr:${JSON.stringify(qrUrl)}, url:'http://192.168.0.12:53682/final.mp4'}; state.modal={type:'done', file:'C:/out/final.mp4'}; render();`);
  await cap('ed-done.png');
  console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
  app.quit();
});
