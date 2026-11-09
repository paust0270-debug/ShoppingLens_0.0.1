const { app } = require('electron');
const path = require('path');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));

app.whenReady().then(async () => {
  const { api } = require('../services/api');
  const p = await api.loadProject(null, 'E2E전체실험');
  const url = p.videos.find((v) => v.url).url;
  const good = await api.analyzeVideo(() => {}, url);
  console.log('GOOD', good.info.title.slice(0, 40), '| subs', good.transcript.length, '| fallback', good.analysis.fallback, '| hook', good.analysis.hook?.ment?.slice(0, 30));
  const style = await api.analyzeStyle(() => {}, url);
  console.log('STYLE', style.summary.length, style.summary.guide);
  try {
    await api.analyzeVideo(() => {}, 'https://www.youtube.com/watch?v=c2p3kbcbNEc');
    console.log('BAD unexpectedly succeeded');
  } catch (e) {
    console.log('BAD', e.message);
  }
  app.quit();
});
