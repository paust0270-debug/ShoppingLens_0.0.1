const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = path.join(os.tmpdir(), 'shoppinglens-blast-test');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.cpSync(path.join(app.getPath('appData'), 'ShoppingLens', 'bin'), path.join(tmp, 'bin'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ threadsToken: 'fake-token', fbPageId: '123', fbPageToken: 'fake-token' }));
app.setPath('userData', tmp);
require('../main');

const out = path.join(__dirname, 'shots');
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const video = fs.readdirSync(path.join(app.getPath('documents'), 'ShoppingLens', 'UI테스트', 'output')).filter((f) => f.endsWith('.mp4')).map((f) => path.join(app.getPath('documents'), 'ShoppingLens', 'UI테스트', 'output', f))[0];

const steps = [
  ['b1-empty', `actions.nav({val:'blast'}); render();`, 1500],
  ['b2-connect-modal', `actions.snsOpen({val:'x'}); render();`, 800],
  ['b3-real-blast', `state.modal=null; setBlastFile(${JSON.stringify(video)}); state.blast.title='디붐 픽셀 스피커 리뷰'; state.blast.desc='레트로 감성 픽셀 스피커 #꿀템 #추천템';
     state.settings.sns = { threads: {name:'@test'}, facebook: {name:'테스트 페이지'} }; state.blast.targets = {threads:true, facebook:true}; render(); setTimeout(() => actions.blastGo(), 600);`, 'task'],
  ['b4-schedule', `state.settings.sns = { youtube:{name:'내 채널'}, tiktok:{name:'틱톡계정'}, instagram:{name:'@shop'}, threads:{name:'@test'}, x:{name:'@me'} };
     state.blast.targets = {tiktok:true, instagram:true, x:true}; state.blast.scheduleOn = true; state.blast.schedule = new Date(Date.now() + 3*3600e3 - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16); render(); setTimeout(() => actions.blastGo(), 600);`, 'task'],
  ['b5-final', `window.scrollTo(0,0); render();`, 800],
  ['b6-jobs', `actions.blastTab({val:'jobs'}); render(); $('#main').scrollTop = 9999;`, 800],
];

app.whenReady().then(async () => {
  await wait(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.setSize(1440, 1300);
  win.setPosition(-3000, 0);
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log('CONSOLE', e.message, e.sourceId, e.lineNumber);
  });
  const ev = (js) => win.webContents.executeJavaScript(js);
  for (const [name, js, w] of steps) {
    const t0 = Date.now();
    try { await ev(js); } catch (e) { console.log('JS ERROR', name, e.message); }
    if (typeof w === 'number') await wait(w);
    else {
      await wait(1500);
      while ((await ev('state.busy')) && Date.now() - t0 < 120000) await wait(500);
      await wait(800);
    }
    win.webContents.invalidate();
    await wait(400);
    fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(name, await ev(`JSON.stringify({status: state.status?.text, jobs: state.blast.jobs.length, hist: state.blast.history.map(h => h.results.map(r => r.platform + ':' + (r.ok?'ok':r.text.slice(0,80))))})`));
  }
  app.quit();
});
