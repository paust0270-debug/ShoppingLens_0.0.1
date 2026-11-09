const { app, BrowserWindow } = require('electron');
const path = require('path');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));
app.on('window-all-closed', (e) => e.preventDefault());

const KEYWORD = process.argv[2] || '입는전기담요';
const hasHan = (s) => /[\u4e00-\u9fff]/.test(s || '');
const pad = (n) => String(n).padStart(2, '0');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

app.whenReady().then(async () => {
  const hold = new BrowserWindow({ show: false, width: 80, height: 80 });
  const { api } = require('./services/api');
  const media = require('./services/media');
  const presets = require('./src/presets');
  const social = require('./services/socialSearch');
  const progress = (d) => d && d.text && log(' ·', d.text);

  try {
    log('1. 쿠팡에서 제품 찾기', KEYWORD);
    const status = api.aiStatus();
    log('쿠팡API', status.coupang ? '있음' : '없음 → 시크릿 검색');
    let products = [];
    try {
      products = status.coupang
        ? await api.coupangSearch(progress, KEYWORD)
        : await api.coupangBrowse(progress, KEYWORD);
    } catch (e) {
      log('쿠팡 검색 실패, 시크릿으로 재시도', e.message);
      products = await api.coupangBrowse(progress, KEYWORD);
    }
    if (!products.length) throw new Error('쿠팡에서 제품을 찾지 못했습니다.');
    const info = products[0];
    log('쿠팡 상품', (info.title || '').slice(0, 60));
    log('가격', info.price || 0, info.url || '');

    const keyword = (info.title || KEYWORD).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || KEYWORD;
    log('2. 중국어 번역', keyword);
    const zhList = [];
    for (const src of [KEYWORD, keyword, '구름깔창', '푹신한 깔창']) {
      try {
        const z = String(await api.translateZh(progress, src) || '').trim();
        if (hasHan(z) && !zhList.includes(z)) zhList.push(z);
      } catch (e) {
        log('번역 실패', src, e.message);
      }
    }
    for (const extra of ['踩屎感鞋垫', '云朵鞋垫', '缓震鞋垫', '爆米花鞋垫', '4D鞋垫']) {
      if (!zhList.includes(extra)) zhList.push(extra);
    }
    if (!zhList.length) throw new Error('중국어 검색어를 만들지 못했습니다.');
    log('ZH', zhList.join(', '));

    const stamp = new Date();
    const name = `${keyword.slice(0, 16)} ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;

    log('3. 1688 검색·영상');
    let video = null;
    for (const zh of zhList) {
      if (video) break;
      const searchUrl = presets.platforms.find((p) => p.id === 'ali1688').search(zh);
      log(' 검색', zh);
      let items = [];
      try {
        const found = await social.searchSocial('ali1688', searchUrl, '1688');
        items = (found.items || []).filter((it) => /detail\.1688\.com\/offer\/\d+/.test(it.url || ''));
      } catch (e) {
        log(' 검색 실패', e.message);
        continue;
      }
      log(' 1688 상품', items.length);
      for (const it of items.slice(0, 6)) {
        if (video) break;
        log(' 상세', (it.title || '').slice(0, 36), it.url);
        let mediaUrl = '';
        try {
          mediaUrl = await api.grabSocialVideo(progress, it.url, 'ali1688');
        } catch (e) {
          log('  실패', e.message);
          continue;
        }
        const ok = mediaUrl && (/\.(mp4|m3u8)(\?|$)/i.test(mediaUrl) || /cloud\.video\.taobao|cloudvideocdn|video\.alicdn/i.test(mediaUrl));
        log('  영상', ok ? mediaUrl.slice(0, 90) : '(없음)');
        if (!ok) continue;
        log('4. 다운로드');
        try {
          const cand = { ...it, platform: 'ali1688', video: true, media: mediaUrl };
          const dl = await api.download(progress, name, cand, 0);
          if (dl?.file) {
            video = { ...cand, ...dl, done: true };
            break;
          }
        } catch (e) {
          log(' 다운 실패', e.message);
        }
      }
    }
    if (!video?.file) throw new Error('1688에서 영상을 받지 못했습니다.');
    log('파일', video.file, Math.round((video.size || 0) / 1024) + 'KB', (video.dur || 0).toFixed(1) + '초');

    log('5. 소스 분석');
    const analyzed = await api.analyzeSources(progress, name, [{ file: video.file }]);
    Object.assign(video, analyzed[0]);

    log('6. 대본');
    const productName = (info.title || keyword).slice(0, 40);
    let lines = [];
    try {
      lines = (await api.genScript(progress, {
        length: 30,
        product: `${productName}\n검색어: ${keyword}\n원본: ${video.title || ''}\n장면: ${video.summary || ''}`,
        productName,
        sources: `소스1: ${video.title || ''} / ${video.summary || ''}`,
        style: '25~40초, 살짝 빠른 반말, 한 문장 한 장면, 화면에 중국어 금지',
      })).lines || [];
    } catch (e) { log('대본 실패', e.message); }
    if (!lines.length) {
      lines = [
        `${keyword}, 아직 모르는 사람이 많아요.`,
        '이런 거 하나면 생활이 바로 편해집니다.',
        '직접 써보면 왜 찾는지 바로 알아요.',
        '자세한 정보는 프로필 링크에서 확인하세요.',
      ];
    }
    let hook = '일본 천재가 개발해 떼돈 번 제품';
    try {
      const picked = await api.nextHook(progress, { product: productName || keyword });
      if (picked?.text) hook = picked.text;
      log('훅', hook);
    } catch (e) { log('훅 실패', e.message); }
    const compact = (s) => String(s || '').replace(/\s+/g, '');
    lines = [hook, ...lines.map((l) => String(l).trim()).filter((l) => l && compact(l) !== compact(hook))];
    lines.forEach((l, i) => log(' ', i + 1, l));

    log('7. 음성');
    const tts = { provider: 'gemini', voice: 'Kore', model: 'gemini-3.8-flash-lite-tts', emotion: 'normal', speed: 'brisk' };
    let audio;
    try {
      audio = await api.genVoice(progress, name, lines, tts);
    } catch (e) {
      log('Gemini 실패, SAPI', e.message);
      audio = await api.genVoice(progress, name, lines, { provider: 'sapi', speed: 'brisk' });
    }
    if ((audio.reduce((a, x) => a + (x.dur || 0), 0)) > 40) audio = await api.fitVoice(progress, name, audio);
    const prepared = await api.prepareEdit(progress, name, audio, 'none');
    const spoken = prepared.audios.reduce((a, x) => a + (x.dur || 0), 0);
    log('낭독', spoken.toFixed(1) + '초');

    let t = 0;
    const subs = lines.map((text, i) => {
      const dur = prepared.audios[i].dur;
      const s = { start: t, end: t + dur, text, line: i };
      t = s.end;
      return s;
    });
    const clips = video.scenes || [{ start: 0, dur: video.dur || 3 }];
    const scenes = lines.map((_, i) => {
      const clip = clips[i % clips.length];
      return { file: video.file, start: clip.start || 0, dur: prepared.audios[i].dur, hasAudio: false };
    });
    const band = video.captionBand;
    const subY = band && Number(band.h) >= 0.04 ? Math.round((Number(band.y) + Number(band.h) / 2) * 1920) : 1375;

    log('8. 렌더');
    const out = await api.render(progress, name, {
      scenes,
      subs,
      voiceFile: prepared.voiceFile,
      voiceOn: true,
      subOn: true,
      keepAudio: false,
      edit: {
        font: 'Malgun Gothic', size: 85, border: true, filter: 'none', effect: 'none',
        transition: false, bgm: null, sfx: [], captionCover: false, subY,
      },
      header: {
        show: true, top: '꿀템나라', title: hook,
        stat: '조회수 235만 | 댓글 697개', color: '#ffffff', frame: 'bar', bg: '#111111', look: 'reel',
      },
    });
    const meta = await media.probe(out);
    await api.saveProject(progress, {
      name, step: 6,
      product: { name: productName, features: [], kw: { ko: [keyword] }, flow: '' },
      videos: [video], analyzed: true, length: 30, lines, tts, audio, ttsReady: true,
      scenes: lines.map((text, i) => ({ text, line: i, src: 0, clip: i % clips.length, dur: prepared.audios[i].dur })),
      subtitles: subs,
      edit: {
        font: 'Malgun Gothic', size: 85, border: true, header: true,
        headTop: '꿀템나라', headTitle: hook, headStat: '조회수 235만 | 댓글 697개',
        voice: true, sub: true, filter: 'none', effect: 'none', subY,
        prep: { keepAudio: false, silence: 'none' },
      },
      prepared, exported: out,
      coupang: [{ title: info.title, img: info.img, url: info.url, price: info.price }],
      cpKeyword: keyword,
    });
    log('완료', `${meta.width}x${meta.height}`, meta.dur.toFixed(1) + '초');
    log('파일', out);
  } catch (e) {
    log('FAILED', e.stack || e.message);
    process.exitCode = 1;
  }
  try { hold.destroy(); } catch {}
  app.quit();
});
