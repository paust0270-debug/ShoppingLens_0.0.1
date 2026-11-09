const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));
require('../main');

const out = path.join(__dirname, 'shots');
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// [name, js, waitForTaskDone]
const steps = [
  ['01-trend', '', 'trends'],
  ['02-trend-modal', `actions.openTrend({url: state.trends[0].url}); render();`, 6000],
  ['03-find', `state.modal=null; actions.findProduct({url: state.trends[0].url}); render();`, 1500],
  ['04-find-results', `state.findQ1='Divoom Ditoo'; actions.searchSources();`, 'find'],
  ['05-work1-download', `state.added = state.findResults.filter(v => v.dur > 15 && v.dur <= 60).slice(0, 2); state.p.name = 'UI테스트'; actions.toPrepare();`, 'task'],
  ['06-work1-analyzed', `actions.analyzeSources();`, 'task'],
  ['07-work2-script', `actions.workTab({val:'2'}); actions.genScript();`, 'task'],
  ['08-work2-voice', `state.p.tts.provider='sapi'; actions.genVoice();`, 'task'],
  ['09-work3-scenes', `actions.workTab({val:'3'}); actions.matchScenes();`, 'task'],
  ['10-work4-subs', `actions.workTab({val:'4'}); render();`, 1500],
  ['11-work5-prep', `actions.workTab({val:'5'}); actions.startPrep();`, 'task'],
  ['12-work5-export', `actions.export();`, 'task'],
  ['13-work6', `actions.workTab({val:'6'}); render();`, 1500],
  ['14-work7', `actions.workTab({val:'7'}); render();`, 1500],
  ['15-projects', `actions.nav({val:'projects'}); render();`, 2000],
  ['16-tools', `actions.nav({val:'tools'}); render();`, 1500],
  ['17-settings', `actions.nav({val:'settings'}); render();`, 1500],
];

app.whenReady().then(async () => {
  await wait(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.setPosition(-3000, 0);
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log('CONSOLE', e.message, e.sourceId, e.lineNumber);
  });
  const ev = (js) => win.webContents.executeJavaScript(js);
  for (const [name, js, w] of steps) {
    const t0 = Date.now();
    if (js) {
      try { await ev(js); } catch (e) { console.log('JS ERROR', name, e.message); }
    }
    if (typeof w === 'number') await wait(w);
    else {
      await wait(800);
      const cond = { trends: 'state.trends.length > 0 || !!state.trendsError', find: '!state.findLoading', task: '!state.busy' }[w];
      while (!(await ev(cond)) && Date.now() - t0 < 300000) await wait(500);
      await wait(800);
    }
    win.webContents.invalidate();
    await wait(400);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
    const st = await ev(`JSON.stringify({view:state.view, tab:state.workTab, status:state.status?.text, videos:state.p.videos.length, lines:state.p.lines.length, scenes:state.p.scenes.length, exported:state.p.exported})`);
    console.log(name, `${((Date.now() - t0) / 1000).toFixed(0)}s`, st);
  }
  app.quit();
});
