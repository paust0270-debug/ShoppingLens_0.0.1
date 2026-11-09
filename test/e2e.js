const { app } = require('electron');
const path = require('path');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));

app.whenReady().then(async () => {
  const { api } = require('../services/api');
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  const progress = (d) => d.text && log('  ·', d.text);
  const name = 'E2E테스트';
  try {
    log('tools', JSON.stringify(await api.installTools(progress, false)));
    const tr = await api.trends(progress, { period: 'week' });
    log('trends', tr.source, tr.items.length, tr.items.slice(0, 3).map((t) => `${t.views} ${t.dur}s ${t.title}`));
    const found = await api.searchVideos(progress, 'divoom ditoo pro');
    log('search', found.length, found.slice(0, 3).map((v) => `${v.dur}s ${v.title}`));
    const picks = found.filter((v) => v.dur && v.dur <= 60).slice(0, 2);
    const videos = [];
    for (let i = 0; i < picks.length; i++) {
      const r = await api.download(() => {}, name, picks[i], i);
      log('download', r.file, r.dur, r.hasAudio, r.size);
      videos.push({ ...picks[i], ...r, done: true });
    }
    const an = await api.analyzeSources(() => {}, name, videos);
    an.forEach((x, i) => { Object.assign(videos[i], x); log('scenes', i, x.scenes.length, x.scenes.slice(0, 3).map((s) => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`)); });
    const sc = await api.genScript(progress, { length: 15, productName: 'Divoom Ditoo Pro' });
    log('script', sc.fallback, sc.lines);
    const voices = await api.voices(null, 'sapi');
    log('voices', voices.map((v) => v.name));
    const audio = await api.genVoice(() => {}, name, sc.lines, { provider: 'sapi', speed: 'fast' });
    log('audio', audio.map((a) => a.dur.toFixed(2)));
    const prep = await api.prepareEdit(() => {}, name, audio, 'normal');
    log('prepared', prep.voiceFile, prep.audios.map((a) => a.dur.toFixed(2)));
    let t = 0;
    const subs = sc.lines.map((l, i) => { const s = { start: t, end: t + prep.audios[i].dur, text: l.slice(0, 12), line: i }; t = s.end; return s; });
    const scenes = sc.lines.map((_, i) => {
      const v = videos[i % videos.length];
      const c = v.scenes[i % v.scenes.length];
      return { file: v.file, start: c.start, dur: prep.audios[i].dur, hasAudio: v.hasAudio };
    });
    const out = await api.render(progress, name, {
      scenes, subs, voiceFile: prep.voiceFile, voiceOn: true, subOn: true, keepAudio: true,
      edit: { font: 'Malgun Gothic', size: 85, border: true, filter: 'warm', effect: 'zoom', transition: true },
      header: { show: true, top: '리뷰왕', title: '이게 대체 뭐야?', color: '#f5c64a' },
    });
    log('render', out);
    const thumb = await api.makeThumb(null, name, out, 2);
    log('thumb', thumb);
  } catch (e) {
    log('FAILED', e.stack || e.message);
  }
  app.quit();
});
