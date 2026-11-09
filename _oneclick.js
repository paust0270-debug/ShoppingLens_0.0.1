const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));
app.on('window-all-closed', (e) => e.preventDefault());

const KEYWORDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'keywords.json'), 'utf8'));
const INDEX = Math.max(1, parseInt(process.argv[2] || '1', 10));
const KEYWORD = KEYWORDS[INDEX - 1];
const ZH_FALLBACK = {
  '토네이도 화로대': ['露营龙卷风火炉', '二次燃烧焚火台', '户外龙卷风焚火台', '旋风火盆', '龙卷风火炉'],
};
const SKIP_TITLE = /패션|뉴스|新闻|滑雪|브이로그|vlog|먹방|쉐도잉|韩语|打卡|游戏|演唱会|教程|自制|易拉罐|铁桶|制作一台|手工|diy/i;
const NEED_TITLE = {
  '토네이도 화로대': /龙卷风|旋风|焚火|火盆|二次燃烧|双燃烧|tornado|화로/,
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), `[${INDEX}]`, ...a);
const noteId = (url) => {
  const m = String(url || '').match(/\/(?:explore|discovery\/item|search_result)\/([0-9a-f]{16,})/i);
  return m ? m[1].toLowerCase() : '';
};
const hasHan = (s) => /[\u4e00-\u9fff]/.test(s || '');

if (!KEYWORD) {
  console.error('키워드가 없습니다', INDEX);
  process.exit(1);
}

app.whenReady().then(async () => {
  const hold = new BrowserWindow({ show: false, width: 80, height: 80 });
  const { api } = require('./services/api');
  const media = require('./services/media');
  const progress = (d) => d && d.text && log(' ·', d.text);
  try {
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    let name = `${KEYWORD} ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
    log('키워드', KEYWORD);

    log('1. 쿠팡 검색 (링크는 인포크에 따로)');
    let products = [];
    try {
      const status = api.aiStatus();
      products = status.coupang
        ? await api.coupangSearch(progress, KEYWORD)
        : await api.coupangBrowse(progress, KEYWORD);
    } catch (e) {
      log('쿠팡 건너뜀', e.message);
    }
    log('쿠팡', products.length, '개');
    products.slice(0, 3).forEach((p, i) => log(' ', i + 1, String(p.title || '').slice(0, 42)));
    const coupang = products.slice(0, 6);

    log('2. 중국어 검색어');
    const zhList = [];
    try {
      const zh = String(await api.translateZh(progress, KEYWORD) || '').trim();
      if (hasHan(zh)) zhList.push(zh);
    } catch (e) {
      log('번역 실패', e.message);
    }
    for (const z of ZH_FALLBACK[KEYWORD] || []) {
      if (!zhList.includes(z)) zhList.push(z);
    }
    if (!zhList.length) zhList.push(KEYWORD);
    log('검색어', zhList.join(', '));

    log('3. 샤오홍슈에서 제품만 있는 원본 고르기');
    const seen = new Set();
    const candidates = [];
    for (const zh of zhList) {
      const found = await api.searchSocial(progress, 'xhs', zh);
      log('검색', zh, (found.items || []).length, found.needLogin ? '로그인 필요' : '');
      for (const v of found.items || []) {
        const id = noteId(v.url);
        const title = String(v.title || '');
        const need = NEED_TITLE[KEYWORD];
        if (!id || seen.has(id) || SKIP_TITLE.test(title)) continue;
        if (found.items.some((x) => x.video) && !v.video) continue;
        if (need && !need.test(title)) continue;
        seen.add(id);
        candidates.push(v);
      }
      if (candidates.length >= 16) break;
    }
    log('후보', candidates.length);
    if (!candidates.length) log('샤오홍슈 목록 없음');

    let video = null;
    const ai = require('./services/ai');
    let xhsDl = 0;
    for (let i = 0; i < candidates.length && xhsDl < 5; i++) {
      const cand = candidates[i];
      log(' 확인', i + 1, (cand.title || '').slice(0, 32));
      try {
        const thumb = await api.judgeSource(progress, { img: cand.img });
        const visionHan = /씌|한자|字幕|글자|텍스트/.test(String(thumb.why || ''));
        log('  썸네일', thumb.ok ? 'OK' : `X ${thumb.why || (thumb.person ? '사람' : '중국어')}`);
        if (thumb.person) continue;
        if (!thumb.ok && visionHan) continue;
      } catch (e) {
        log('  썸네일 실패', e.message);
      }
      name = `${KEYWORD} ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
      try {
        xhsDl += 1;
        const dl = await api.download(progress, name, cand, 0);
        const cap = await api.probeCaption(progress, dl.file);
        log('  자막', cap.has ? '있음 → 다음' : '없음');
        if (cap.has) continue;
        const shot = await api.makeThumb(progress, name, dl.file, 1);
        const frame = await api.judgeSource(progress, { file: shot, files: [shot] });
        log('  장면', frame.ok ? 'OK' : `X ${frame.why || (frame.person ? '사람' : '중국어')}`);
        if (!frame.ok) continue;
        try {
          const shotB64 = fs.readFileSync(shot).toString('base64');
          const match = await ai.json(
            '쇼핑 쇼츠 원본이 요청 제품인지 확인합니다.',
            `요청 제품: ${KEYWORD}\n영상 제목: ${cand.title || ''}\n장면이 이 제품(또는 같은 종류의 완제품)이면 ok=true. 캔·페트병 DIY, 다른 물건, 사람 위주, 관계없는 캠핑 장면은 false.\nJSON: {"ok":true,"why":""}`,
            [shotB64],
          );
          log('  제품', match.ok ? 'OK' : `X ${match.why || ''}`);
          if (!match.ok) continue;
        } catch (e) {
          log('  제품확인 실패', e.message);
        }
        video = {
          ...cand,
          ...dl,
          done: true,
          burnedCaption: false,
          platform: 'xhs',
          coupang,
          coupangName: (coupang[0] && coupang[0].title) || KEYWORD,
          coupangQuery: KEYWORD,
        };
        break;
      } catch (e) {
        log('  다운실패', e.message);
        if (/XHS_LOGIN/.test(e.message)) {
          log('샤오홍슈 로그인 필요, 유튜브로 전환');
          break;
        }
      }
    }
    if (!video?.file) {
      log('샤오홍슈 원본 없음, 유튜브 쇼츠 재검색');
      const ytQ = KEYWORD === '토네이도 화로대' ? '토네이도 화로대 이중연소' : KEYWORD;
      const yts = await api.searchVideos(progress, ytQ);
      for (let i = 0; i < Math.min(12, yts.length) && !video; i++) {
        const cand = yts[i];
        log(' YT', i + 1, (cand.title || '').slice(0, 32));
        if (KEYWORD === '토네이도 화로대' && /미니.?스토브|가스버너|iso|캔들/i.test(cand.title || '')) {
          log('  제목 탈락');
          continue;
        }
        try {
          const thumb = await api.judgeSource(progress, { img: cand.img || cand.thumb });
          if (thumb.person || (!thumb.ok && /씌|한자|字幕|글자|텍스트/.test(String(thumb.why || '')))) {
            log('  탈락', thumb.why || '사람');
            continue;
          }
          const dl = await api.download(progress, name, cand, 0);
          const cap = await api.probeCaption(progress, dl.file);
          if (cap.has) {
            log('  자막 있음');
            continue;
          }
          const shot = await api.makeThumb(progress, name, dl.file, 1);
          const frame = await api.judgeSource(progress, { file: shot, files: [shot] });
          if (frame.person) continue;
          const shotB64 = fs.readFileSync(shot).toString('base64');
          const match = await ai.json(
            '쇼핑 쇼츠 원본이 요청 제품인지 확인합니다.',
            `요청 제품: ${KEYWORD}\n영상 제목: ${cand.title || ''}\n토네이도 화로대는 나무를 넣고 회오리 불꽃이 나는 이중연소 화로여야 합니다. 가스 미니 스토브, 일반 버너는 false.\nJSON: {"ok":true,"why":""}`,
            [shotB64],
          );
          log('  제품', match.ok ? 'OK' : `X ${match.why || ''}`);
          if (!match.ok) continue;
          video = {
            ...cand,
            ...dl,
            done: true,
            burnedCaption: false,
            platform: 'youtube',
            coupang,
            coupangName: (coupang[0] && coupang[0].title) || KEYWORD,
            coupangQuery: KEYWORD,
          };
        } catch (e) {
          log('  YT실패', e.message);
        }
      }
    }
    if (!video?.file) throw new Error('사람 없고 중국어 없는 제품 원본을 찾지 못했습니다.');

    log('4. 소스 분석');
    const analyzed = await api.analyzeSources(progress, name, [{ file: video.file }]);
    Object.assign(video, analyzed[0]);

    log('5. 대본 25~40초');
    const productName = video.coupangName || KEYWORD;
    const scriptCtx = {
      length: 30,
      product: `${productName}\n검색어: ${KEYWORD}\n원본: ${video.title || ''}\n장면: ${video.summary || ''}`,
      productName,
      sources: `소스1: ${video.title || ''} / ${video.summary || ''}`,
      style: '25~40초, 살짝 빠른 반말, 한 문장 한 장면',
    };
    const fallbackLines = [
      `${KEYWORD}, 아직 모르는 사람이 많아요.`,
      `처음 보면 그냥 평범해 보이죠?`,
      `근데 한 번 써보면 왜 찾는지 바로 알아요.`,
      `원래 하던 방식은 매번 번거로웠는데,`,
      `이건 한 번만 쓰면 바로 끝이거든요.`,
      `자리도 조금만 차지하고, 쓰기도 쉬워요.`,
      `매일 반복되던 귀찮은 일이 여기서 줄어요.`,
      `써본 사람들은 원래 쓰던 걸로 못 돌아간대요.`,
      `가격 생각하면 고민할 이유가 없는 템이에요.`,
      `자세한 정보는 프로필 링크에서 확인하세요.`,
    ];
    let lines = [];
    for (let attempt = 1; attempt <= 3 && !lines.length; attempt++) {
      try {
        lines = (await api.genScript(progress, scriptCtx)).lines || [];
      } catch (e) {
        log('대본 실패', attempt, e.message);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 8000));
      }
    }
    if (!lines.length) {
      log('대본 폴백');
      lines = fallbackLines;
    }
    let hook = '일본 천재가 개발해 떼돈 번 제품';
    try {
      const picked = await api.nextHook(progress, { product: productName || KEYWORD });
      if (picked?.text) hook = picked.text;
      log('제목 훅', hook, picked?.source || '');
    } catch (e) {
      log('훅 실패', e.message);
    }
    const compact = (s) => String(s || '').replace(/\s+/g, '');
    lines = [hook, ...lines.map((l) => String(l).trim()).filter((l) => l && compact(l) !== compact(hook))];
    lines.forEach((l, i) => log(' ', i + 1, l));

    const tts = { provider: 'gemini', voice: 'Kore', model: 'gemini-3.8-flash-lite-tts', emotion: 'normal', speed: 'brisk' };
    log('6. 음성');
    let audio;
    try {
      audio = await api.genVoice(progress, name, lines, tts);
    } catch (e) {
      log('Gemini 음성 실패, SAPI로', e.message);
      audio = await api.genVoice(progress, name, lines, { provider: 'sapi', speed: 'brisk' });
    }
    let spoken = audio.reduce((a, x) => a + (x.dur || 0), 0);
    log('낭독', spoken.toFixed(1) + '초');
    if (spoken > 40) {
      audio = await api.fitVoice(progress, name, audio);
      spoken = audio.reduce((a, x) => a + (x.dur || 0), 0);
      log('맞춤 후', spoken.toFixed(1) + '초');
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
    const subY = band && Number(band.h) >= 0.04
      ? Math.round((Number(band.y) + Number(band.h) / 2) * 1920)
      : 1375;
    log('7. 렌더', 'subY', subY, spoken.toFixed(1) + '초');
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
      product: { name: productName, features: [], kw: { ko: [KEYWORD] }, flow: '' },
      videos: [video],
      analyzed: true,
      styleKey: 'lens-0',
      length: 30,
      lines,
      tts,
      audio,
      ttsReady: true,
      scenes: lines.map((text, i) => ({ text, line: i, src: 0, clip: i % clips.length, dur: prepared.audios[i].dur })),
      subtitles: subs,
      edit: {
        font: 'Malgun Gothic', size: 85, border: true, header: true,
        headTop: '꿀템나라', headTitle: hook,
        headStat: '조회수 235만 | 댓글 697개', voice: true, sub: true,
        filter: 'none', effect: 'none', subY,
        prep: { keepAudio: false, silence: 'none' },
      },
      prepared,
      exported: out,
      coupang,
      cpKeyword: KEYWORD,
      inpock: 'https://link.inpock.co.kr/evenshopping',
      batchIndex: INDEX,
    });
    log('완료', `${meta.width}x${meta.height}`, meta.dur.toFixed(1) + '초', out);
  } catch (e) {
    log('FAILED', e.stack || e.message);
    process.exitCode = 1;
  }
  try { hold.destroy(); } catch {}
  app.exit(process.exitCode || 0);
});
