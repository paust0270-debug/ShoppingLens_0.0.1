const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));
require('../main');

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  const win = BrowserWindow.getAllWindows()[0];
  win.setPosition(-3000, 0);
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  const shot = async (name) => {
    try {
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 500));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(__dirname, 'shots', name), img.toPNG());
      console.log('shot', name, img.getSize());
    } catch (e) {
      console.log('shot-fail', name, e.message);
    }
  };
  try {
    await shot('warmup.png');
    await win.webContents.executeJavaScript(`
      state.view='lens';
      state.lens.query='다이소';
      state.lens.source='ytdlp';
      state.lens.rows=[
        {id:'a', url:'https://youtu.be/aaaaaaaaaaa', title:'5,000원에 기본템', channel:'다이소', subs:64100, views:6114, date:'2025-03-27', dur:11, likes:225, comments:10, img:'', caption:true},
        {id:'b', url:'https://youtu.be/bbbbbbbbbbb', title:'여름 필수템 실사용', channel:'자취피티', subs:35300, views:537000, date:'2025-08-01', dur:28, likes:17000, comments:170, img:'', caption:false},
        {id:'c', url:'https://youtu.be/ccccccccccc', title:'조회수 낮은 영상', channel:'살림토끼', subs:59800, views:900, date:'2025-01-02', dur:40, likes:3, comments:0, img:''}
      ];
      state.lens.groups=[{id:'g1', name:'임시', channels:[{id:'c1', url:'https://www.youtube.com/@ch', name:'자취피티', subs:35300, videos:153, tag:'쇼핑채널'}]}];
      render();
    `);
    await shot('lens-table.png');
    await win.webContents.executeJavaScript(`state.lens.tab='channels'; render();`);
    await shot('lens-channels.png');
    await win.webContents.executeJavaScript(`
      state.analysis['https://youtu.be/bbbbbbbbbbb']={
        info:{title:'여름 필수템 실사용', channel:'자취피티', views:537000, dur:28, img:''},
        transcript:'물놀이 갔는데 이 제품이 진짜였습니다.',
        report:{points:['가성비와 접근성을 같이 보여 줍니다.','가족이 쓰는 장면을 반복합니다.'], hooks:['물놀이를 좋아하는 공감으로 시작합니다.'], keywords:['물놀이: 제품이 쓰이는 장면'], timeline:[{t:'0:00', text:'문제 제기'}], fallback:true}
      };
      state.lens.pane='report';
      state.modal={type:'lens', url:'https://youtu.be/bbbbbbbbbbb'};
      render();
    `);
    await shot('lens-report.png');
    console.log('dom', JSON.stringify(await win.webContents.executeJavaScript(`({
      nav: !!document.querySelector('.nav[data-val="lens"]'),
      headers: document.querySelector('.lens-table') ? document.querySelector('.lens-table').innerText.slice(0, 40) : '',
      channels: document.querySelectorAll('.ch-item').length,
      modal: document.querySelector('.lens-h') ? document.querySelector('.lens-h').textContent : ''
    })`)));
    console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('FAILED', e.stack || e.message);
  }
  app.quit();
});
