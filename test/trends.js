const { app } = require('electron');
const path = require('path');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));

app.whenReady().then(async () => {
  const { api } = require('../services/api');
  const t0 = Date.now();
  try {
    for (const period of ['today', 'week']) {
      const r = await api.trends(() => {}, { period });
      console.log(period, r.items.length, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
      r.items.slice(0, 5).forEach((v) => console.log('  ', v.views, v.dur, v.title.slice(0, 40)));
    }
    const k = await api.trends(() => {}, { query: '픽셀 스피커' });
    console.log('keyword', k.items.length, k.items.slice(0, 3).map((v) => v.title.slice(0, 30)));
    const s = await api.searchVideos(() => {}, 'Divoom Ditoo');
    console.log('search', s.length, s.slice(0, 3).map((v) => `${v.dur}s ${v.title.slice(0, 30)}`));
    const a = await api.analyzeVideo((d) => d.text && console.log('  ·', d.text), s[0].url);
    console.log('analyze', a.info.title, a.info.likes, '| transcript:', a.transcript.slice(0, 80), '| fallback', a.analysis.fallback);
  } catch (e) {
    console.log('FAILED', e.stack);
  }
  app.quit();
});
