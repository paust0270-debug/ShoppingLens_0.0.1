const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));
app.on('window-all-closed', (e) => e.preventDefault());

const RAW = process.argv[2] || 'https://www.coupang.com/vp/products/6542739738?itemId=20461740729&vendorItemId=81816101818&q=%EC%8B%B1%ED%81%AC%EB%8C%80%20%EC%B9%B8%EB%A7%89%EC%9D%B4';
const ZH_FALLBACK = ['水槽挡水板', '厨房挡水条', '洗碗池挡水板', '水槽挡水条'];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const hasHan = (s) => /[\u4e00-\u9fff]/.test(s || '');
const pad = (n) => String(n).padStart(2, '0');
const noteId = (url) => {
  const m = String(url || '').match(/\/(?:explore|discovery\/item|search_result)\/([0-9a-f]{16,})/i);
  return m ? m[1].toLowerCase() : '';
};

app.whenReady().then(async () => {
  const hold = new BrowserWindow({ show: false, width: 80, height: 80 });
  const { api } = require('./services/api');
  const media = require('./services/media');
  const progress = (d) => d && d.text && log(' ·', d.text);
  const href = /https?:\/\//i.test(RAW) ? RAW : `https://${String(RAW).replace(/^\/+/, '')}`;
  try {
    log('1. 쿠팡 상품 추출', href);
    const info = await api.coupangProductInfo(progress, href);
    let q = '';
    try { q = decodeURIComponent(new URL(href).searchParams.get('q') || ''); } catch {}
    const keyword = (q || info.query || info.title || '').replace(/\s+/g, ' ').trim().slice(0, 28) || '싱크대 칸막이';
    const images = [...new Set([...(info.imgs || []), info.img].filter(Boolean))];
    log('상품', info.title || '');
    log('검색어', keyword);
    log('이미지', images.length, images[0] || '');

    log('2. 중국어 번역');
    const zhList = [];
    try {
      const zh = String(await api.translateZh(progress, keyword) || '').trim();
      if (hasHan(zh)) zhList.push(zh);
    } catch (e) {
      log('번역 실패', e.message);
    }
    for (const z of ZH_FALLBACK) if (!zhList.includes(z)) zhList.push(z);
    log('검색어 ZH', zhList.join(', '));

    const stamp = new Date();
    const name = `${keyword.slice(0, 16)} ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
    const pool = [];
    const seen = new Set();

    log('3. 타오바오·천묘 영상');
    const priorityUrl = 'https://detail.tmall.com/item.htm?id=1088339409800';
    try {
      log('  tmall 지정 상품 영상 확인');
      const mediaUrl = await api.grabSocialVideo(progress, priorityUrl, 'taobao');
      if (mediaUrl) {
        log('  영상 OK', mediaUrl.slice(0, 80));
        pool.push({ url: priorityUrl, title: '天猫 싱크대 물막이', platform: 'taobao', video: true, media: mediaUrl });
      } else log('  영상 없음');
    } catch (e) {
      log('  실패', e.message);
    }
    for (const plat of ['taobao', 'ali1688']) {
      if (plat === 'ali1688' && pool.some((v) => v.media)) break;
      let products = [];
      for (const img of images.slice(0, 2)) {
        try {
          const r = await api.searchByImage(progress, plat, img);
          log(' ', plat, '이미지 결과', (r.items || []).length);
          if (r.items?.length) { products = r.items; break; }
        } catch (e) {
          log(' ', plat, '이미지 실패', e.message);
        }
      }
      let got = 0;
      for (const item of products.slice(0, 6)) {
        if (got >= 3) break;
        try {
          log(' ', plat, '영상 확인', String(item.title || '').slice(0, 24));
          const mediaUrl = await api.grabSocialVideo(progress, item.url, plat);
          if (mediaUrl) {
            log('  영상 OK', mediaUrl.slice(0, 80));
            pool.push({ ...item, platform: plat, video: true, media: mediaUrl });
            got += 1;
          } else log('  영상 없음');
        } catch (e) {
          log('  실패', e.message);
        }
      }
    }

    if (!pool.some((v) => v.media)) {
      log('4. 샤오홍슈 영상');
      for (const zh of zhList.slice(0, 2)) {
        try {
          const found = await api.searchSocial(progress, 'xhs', zh);
          log(' XHS', zh, (found.items || []).length, found.needLogin ? '로그인필요' : '');
          for (const v of found.items || []) {
            const id = noteId(v.url) || v.url;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            pool.push({ ...v, platform: 'xhs' });
          }
        } catch (e) {
          log(' XHS 실패', e.message);
        }
        if (pool.filter((v) => v.platform === 'xhs').length >= 8) break;
      }
    } else {
      log('4. 샤오홍슈 생략 (타오바오 영상 확보)');
    }
    log('후보', pool.length, 'xhs', pool.filter((v) => v.platform === 'xhs').length, 'shop', pool.filter((v) => v.platform !== 'xhs').length);
    if (!pool.length) throw new Error('해외 영상을 찾지 못했습니다.');

    log('5. 중국어 자막 없는 원본 고르고 다운로드');
    const ranked = [...pool].sort((a, b) => {
      const media = Number(!!b.media) - Number(!!a.media);
      if (media) return media;
      return Number(a.platform === 'xhs') - Number(b.platform === 'xhs');
    });
    let video = null;
    const captioned = [];
    for (let i = 0; i < ranked.length && !video; i++) {
      const cand = ranked[i];
      log(' 확인', i + 1, cand.platform, String(cand.title || '').slice(0, 28));
      try {
        const dl = await api.download(progress, name, cand, 0);
        if (!dl?.file) continue;
        let capHas = false;
        try { capHas = !!(await api.probeCaption(progress, dl.file))?.has; } catch {}
        const shot = await api.makeThumb(progress, name, dl.file, 1).catch(() => '');
        let frame = { chinese: false };
        if (shot) frame = await api.judgeSource(progress, { file: shot, files: [shot] }).catch(() => frame);
        const picked = { ...cand, ...dl, done: true, burnedCaption: capHas || !!frame.chinese };
        if (capHas || frame.chinese) {
          log('  중국어 자막 → 보류');
          captioned.push(picked);
          continue;
        }
        video = picked;
        log(' 채택', cand.platform, '자막없음');
      } catch (e) {
        log('  다운실패', e.message);
      }
    }
    if (!video?.file && captioned[0]) {
      video = captioned[0];
      log(' 채택(자막지움)', video.platform);
    }
    if (!video?.file) throw new Error('쓸 수 있는 원본 영상을 받지 못했습니다.');

    log('6. 소스 분석');
    const analyzed = await api.analyzeSources(progress, name, [{ file: video.file }]);
    Object.assign(video, analyzed[0]);

    log('7. 대본');
    const productName = (info.title || keyword).slice(0, 40);
    const scriptCtx = {
      length: 30,
      product: `${productName}\n검색어: ${keyword}\n원본: ${video.title || ''}\n장면: ${video.summary || ''}`,
      productName,
      sources: `소스1: ${video.title || ''} / ${video.summary || ''}`,
      style: '25~40초, 살짝 빠른 반말, 한 문장 한 장면',
    };
    let lines = [];
    try { lines = (await api.genScript(progress, scriptCtx)).lines || []; } catch (e) { log('대본 실패', e.message); }
    if (!lines.length) {
      lines = [
        `${keyword}, 아직 모르는 사람이 많아요.`,
        '싱크대 물 튀는 거, 매일 닦느라 지쳤죠?',
        '실리콘 칸막이 하나면 물이 밖으로 안 넘쳐요.',
        '붙였다 뗐다 되고, 설거지할 때 바로 티가 나요.',
        '자세한 정보는 프로필 링크에서 확인하세요.',
      ];
    }
    let hook = '일본 천재가 개발해 떼돈 번 제품';
    try {
      const picked = await api.nextHook(progress, { product: productName || keyword });
      if (picked?.text) hook = picked.text;
      log('훅', hook, picked?.source || '');
    } catch (e) { log('훅 실패', e.message); }
    const compact = (s) => String(s || '').replace(/\s+/g, '');
    lines = [hook, ...lines.map((l) => String(l).trim()).filter((l) => l && compact(l) !== compact(hook))];
    lines.forEach((l, i) => log(' ', i + 1, l));

    log('8. 음성');
    const tts = { provider: 'gemini', voice: 'Kore', model: 'gemini-3.8-flash-lite-tts', emotion: 'normal', speed: 'brisk' };
    let audio;
    try {
      audio = await api.genVoice(progress, name, lines, tts);
    } catch (e) {
      log('Gemini 실패, SAPI', e.message);
      audio = await api.genVoice(progress, name, lines, { provider: 'sapi', speed: 'brisk' });
    }
    let spoken = audio.reduce((a, x) => a + (x.dur || 0), 0);
    log('낭독', spoken.toFixed(1) + '초');
    if (spoken > 40) {
      audio = await api.fitVoice(progress, name, audio);
      spoken = audio.reduce((a, x) => a + (x.dur || 0), 0);
    }

    const prepared = await api.prepareEdit(progress, name, audio, 'none');
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

    log('9. 렌더');
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
      videos: [video],
      analyzed: true, length: 30, lines, tts, audio, ttsReady: true,
      scenes: lines.map((text, i) => ({ text, line: i, src: 0, clip: i % clips.length, dur: prepared.audios[i].dur })),
      subtitles: subs,
      edit: {
        font: 'Malgun Gothic', size: 85, border: true, header: true,
        headTop: '꿀템나라', headTitle: hook, headStat: '조회수 235만 | 댓글 697개',
        voice: true, sub: true, filter: 'none', effect: 'none', subY,
        prep: { keepAudio: false, silence: 'none' },
      },
      prepared, exported: out,
      coupang: [{ title: info.title, img: info.img, url: info.url, price: info.price, partner: info.partner }],
      cpKeyword: keyword,
    });
    log('완료', `${meta.width}x${meta.height}`, meta.dur.toFixed(1) + '초');
    log('파일', out);
  } catch (e) {
    log('FAILED', e.stack || e.message);
    process.exitCode = 1;
  }
  try { hold.destroy(); } catch {}
  app.exit(process.exitCode || 0);
});
