const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));

const NAME = '휴대용선풍기';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

app.whenReady().then(async () => {
  const { api } = require('../services/api');
  const media = require('../services/media');
  fs.rmSync(path.join(app.getPath('documents'), 'ShoppingLens', NAME), { recursive: true, force: true });
  try {
    const found = await api.searchVideos(null, '휴대용 선풍기 추천');
    log('검색', found.length);
    const videos = [];
    for (const p of found.filter((v) => v.dur >= 12 && v.dur <= 60)) {
      if (videos.length >= 2) break;
      try {
        const r = await api.download((d) => d.progress && process.stdout.write(`\r  다운로드 ${videos.length + 1} ${Math.round(d.progress * 100)}%   `), NAME, p, videos.length);
        console.log('');
        videos.push({ ...p, ...r, done: true });
        log('받음', r.dur.toFixed(0) + '초', p.title.slice(0, 36));
      } catch (e) {
        console.log('');
        log('건너뜀', e.message.slice(0, 50));
      }
    }
    if (videos.length < 1) throw new Error('받을 수 있는 영상이 없습니다.');
    const analyzed = await api.analyzeSources((d) => d.text && log(' ·', d.text), NAME, videos);
    analyzed.forEach((x, i) => { videos[i].scenes = x.scenes; videos[i].summary = x.summary; });
    log('장면', analyzed.map((x) => x.scenes.length).join(', '));

    const script = await api.genScript(null, { length: 18, productName: '휴대용 선풍기' });
    log('대본', script.lines.join(' / '));
    const audio = await api.genVoice((d) => d.text && log(' ·', d.text), NAME, script.lines, { provider: 'sapi', speed: 'fast' });
    const prep = await api.prepareEdit(() => {}, NAME, audio, 'light');

    let t = 0;
    const subs = script.lines.map((l, i) => {
      const s = { start: t, end: t + prep.audios[i].dur, text: l.slice(0, 16), line: i };
      t = s.end;
      return s;
    });
    const scenes = script.lines.map((_, i) => {
      const v = videos[i % videos.length];
      const c = v.scenes[i % v.scenes.length];
      return { file: v.file, start: c.start, dur: prep.audios[i].dur, hasAudio: v.hasAudio };
    });
    const out = await api.render((d) => d.text && log(' ·', d.text), NAME, {
      scenes, subs, voiceFile: prep.voiceFile, voiceOn: true, subOn: true, keepAudio: false,
      edit: { font: 'Malgun Gothic', size: 82, border: true, filter: 'cool', effect: 'zoom', transition: true, bgm: null, sfx: [] },
      header: { show: true, top: '여름필수템', title: '가방에 쏙 들어가요', color: '#4fd1c5' },
    });
    const meta = await media.probe(out);
    const thumb = await api.makeThumb(null, NAME, out, Math.min(3, meta.dur / 2));
    await api.saveProject(null, {
      name: NAME, step: 5, product: { name: '휴대용 선풍기' }, lines: script.lines,
      videos, scenes: script.lines.map((text, i) => ({ text, line: i, src: i % videos.length, clip: i % videos[i % videos.length].scenes.length, dur: prep.audios[i].dur })),
      subtitles: subs, audio, prepared: prep, exported: out, coverThumb: thumb, thumbnail: thumb,
      analyzed: true, ttsReady: true, styleKey: 'lens-0',
      edit: { header: true, headTop: '여름필수템', headTitle: '가방에 쏙 들어가요', filter: 'cool', effect: 'zoom', transition: true, prep: { silence: 'light', keepAudio: false } },
    });
    log('완료', `${meta.width}x${meta.height}`, meta.dur.toFixed(1) + '초', (fs.statSync(out).size / 1048576).toFixed(1) + 'MB');
    log('파일', out);
    log('썸네일', thumb);
  } catch (e) {
    log('FAILED', e.stack || e.message);
  }
  app.quit();
});
