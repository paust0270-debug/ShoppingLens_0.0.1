const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = path.join(os.tmpdir(), 'shoppinglens-full-e2e');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.cpSync(path.join(app.getPath('appData'), 'ShoppingLens', 'bin'), path.join(tmp, 'bin'), { recursive: true });
app.setPath('userData', tmp);

const NAME = 'E2E전체실험';
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
const results = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function check(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail == null ? '' : String(detail) });
    log('PASS', name, detail == null ? '' : String(detail).slice(0, 140));
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    log('FAIL', name, e.message.slice(0, 200));
  }
  return results.at(-1);
}

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

app.whenReady().then(async () => {
  const { api } = require('../services/api');
  const media = require('../services/media');
  fs.rmSync(path.join(app.getPath('documents'), 'ShoppingLens', NAME), { recursive: true, force: true });
  const ctx = {};

  await check('도구 설치 상태', async () => {
    const s = await api.toolsStatus();
    must(s.ytdlp && s.ffmpeg, JSON.stringify(s));
    return `yt-dlp ${s.ytdlp}, ffmpeg ${s.ffmpeg}`;
  });
  await check('AI/쿠팡 키 없음 상태', async () => {
    const s = await api.aiStatus();
    must(!s.ai && !s.coupang, JSON.stringify(s));
    return '키 없음으로 동작';
  });
  await check('트렌드 주간 100개', async () => {
    const r = await api.trends(() => {}, { period: 'week' });
    must(r.items.length >= 20, `${r.items.length}개`);
    must(r.items.every((v) => v.url && v.title), '항목 필드 누락');
    return `${r.source} ${r.items.length}개, 1위 ${r.items[0].views}회 ${r.items[0].title.slice(0, 24)}`;
  });
  await check('트렌드 키워드 검색', async () => {
    const r = await api.trends(() => {}, { query: '다이소 꿀템' });
    must(r.items.length >= 5, `${r.items.length}개`);
    return `${r.items.length}개`;
  });
  await check('원본 영상 검색', async () => {
    ctx.found = await api.searchVideos(null, 'Divoom Ditoo');
    must(ctx.found.length >= 3, `${ctx.found.length}개`);
    return `${ctx.found.length}개`;
  });
  await check('영상 분석(정보+자막)', async () => {
    const r = await api.analyzeVideo(() => {}, ctx.found[0].url);
    must(r.info && r.info.title, '정보 없음');
    must(r.analysis && r.analysis.fallback, '키 없을 때 기본 분석이어야 함');
    return `${r.info.title.slice(0, 30)} / 자막 ${r.transcript ? r.transcript.length + '자' : '없음'} / 기본분석`;
  });
  await check('스타일 분석', async () => {
    const r = await api.analyzeStyle(() => {}, ctx.found[0].url);
    must(r.summary && r.summary.guide, '요약 없음');
    return r.title.slice(0, 30);
  });
  await check('영상 2개 다운로드', async () => {
    const picks = ctx.found.filter((v) => v.dur >= 15 && v.dur <= 70);
    ctx.videos = [];
    for (const p of picks) {
      if (ctx.videos.length >= 2) break;
      try {
        const r = await api.download(() => {}, NAME, p, ctx.videos.length);
        must(fs.existsSync(r.file) && r.size > 100000 && r.dur > 5, '파일 이상');
        ctx.videos.push({ ...p, ...r });
      } catch (e) {
        log('  건너뜀', p.title.slice(0, 24), e.message.slice(0, 60));
      }
    }
    must(ctx.videos.length === 2, `${ctx.videos.length}개만 성공`);
    return ctx.videos.map((v) => `${v.dur.toFixed(0)}초 ${(v.size / 1048576).toFixed(1)}MB`).join(', ');
  });
  await check('장면 자동 분리', async () => {
    const r = await api.analyzeSources(() => {}, NAME, ctx.videos);
    r.forEach((x, i) => {
      must(x.scenes.length >= 3, `소스${i} ${x.scenes.length}장면`);
      must(x.scenes.every((s) => fs.existsSync(s.thumb)), '썸네일 누락');
      ctx.videos[i].scenes = x.scenes;
    });
    return r.map((x) => `${x.scenes.length}장면`).join(', ');
  });
  await check('대본 생성(키 없을 때 템플릿)', async () => {
    const r = await api.genScript(null, { length: 20, productName: '🔥 Divoom Ditoo #꿀템' });
    must(r.fallback && r.lines.length >= 5, JSON.stringify(r.lines));
    must(!/#|🔥/.test(r.lines[0]), `제품명 정리 실패: ${r.lines[0]}`);
    ctx.lines = r.lines;
    return `${r.lines.length}문장: ${r.lines[0]}`;
  });
  await check('윈도우 한국어 음성', async () => {
    const voices = await api.voices(null, 'sapi');
    must(voices.length, '음성 없음');
    return voices.map((v) => v.name).join(', ');
  });
  await check('유료 음성은 키 안내', async () => {
    for (const p of ['gemini', 'eleven', 'typecast']) {
      let msg = '';
      try { await api.voices(null, p); } catch (e) { msg = e.message; }
      must(/키/.test(msg), `${p}: ${msg}`);
    }
    return 'Gemini, ElevenLabs, Typecast 모두 키 안내';
  });
  await check('음성 생성', async () => {
    ctx.audio = await api.genVoice(() => {}, NAME, ctx.lines, { provider: 'sapi', speed: 'normal' });
    must(ctx.audio.length === ctx.lines.length, '개수 불일치');
    must(ctx.audio.every((a) => a.dur > 0.3 && fs.existsSync(a.file)), '음성 파일 이상');
    return `총 ${ctx.audio.reduce((s, a) => s + a.dur, 0).toFixed(1)}초`;
  });
  await check('장면 매칭(키 없으면 규칙 기반)', async () => {
    const r = await api.aiMatch(null, ctx.lines, ctx.videos.map((v) => v.scenes.map((s) => s.label)));
    must(r === null, '키 없을 때는 null이어야 함');
    return '화면에서 순서대로 배정';
  });
  await check('자막 정리', async () => {
    const r = await api.fixSubs(null, ['  이거   진짜  ', '모르면 손해']);
    must(r[0] === '이거 진짜', JSON.stringify(r));
    return r.join(' / ');
  });
  await check('편집 준비(무음 다듬기+합치기)', async () => {
    ctx.prep = await api.prepareEdit(() => {}, NAME, ctx.audio, 'normal');
    must(fs.existsSync(ctx.prep.voiceFile), '합본 없음');
    const d = await media.probe(ctx.prep.voiceFile);
    must(d.dur > 5 && d.hasAudio, `합본 ${d.dur}초`);
    return `${d.dur.toFixed(1)}초 합본`;
  });
  await check('최종 영상 내보내기', async () => {
    let t = 0;
    const subs = ctx.lines.map((l, i) => {
      const s = { start: t, end: t + ctx.prep.audios[i].dur, text: l.slice(0, 14), line: i };
      t = s.end;
      return s;
    });
    const scenes = ctx.lines.map((_, i) => {
      const v = ctx.videos[i % ctx.videos.length];
      const c = v.scenes[i % v.scenes.length];
      return { file: v.file, start: c.start, dur: ctx.prep.audios[i].dur, hasAudio: v.hasAudio };
    });
    ctx.out = await api.render((d) => d.text && log('  ·', d.text), NAME, {
      scenes, subs, voiceFile: ctx.prep.voiceFile, voiceOn: true, subOn: true, keepAudio: false,
      edit: { font: 'Malgun Gothic', size: 85, border: true, filter: 'warm', effect: 'zoom', transition: true, bgm: null, sfx: [] },
      header: { show: true, top: '리뷰왕', title: '이게 대체 뭐야?', color: '#f5c64a' },
    });
    const meta = await media.probe(ctx.out);
    must(meta.width === 1080 && meta.height === 1920, `${meta.width}x${meta.height}`);
    must(meta.hasAudio && meta.dur > 8, `음성 ${meta.hasAudio} ${meta.dur}초`);
    must(fs.statSync(ctx.out).size > 300000, '파일이 너무 작음');
    return `${meta.width}x${meta.height}, ${meta.dur.toFixed(1)}초, ${(fs.statSync(ctx.out).size / 1048576).toFixed(1)}MB`;
  });
  await check('썸네일', async () => {
    ctx.thumb = await api.makeThumb(null, NAME, ctx.out, 2);
    must(fs.existsSync(ctx.thumb) && fs.statSync(ctx.thumb).size > 10000, '썸네일 이상');
    return ctx.thumb;
  });
  await check('자막 파일 저장', async () => {
    const f = await api.saveText(null, NAME, 'output/subs.srt', '1\n00:00:00,000 --> 00:00:02,000\n테스트\n');
    must(fs.readFileSync(f, 'utf8').includes('테스트'), '내용 불일치');
    return 'srt 저장';
  });
  await check('프로젝트 저장/불러오기', async () => {
    const saved = { name: NAME, step: 5, lines: ctx.lines, videos: ctx.videos.map((v) => ({ title: v.title, url: v.url })), exported: ctx.out, coverThumb: ctx.thumb };
    await api.saveProject(null, saved);
    const list = await api.listProjects();
    must(list.some((p) => p.name === NAME), '목록에 없음');
    const loaded = await api.loadProject(null, NAME);
    must(loaded.lines.length === ctx.lines.length && loaded.exported === ctx.out, '불러온 내용 불일치');
    return `목록 ${list.length}개 중 확인`;
  });
  await check('업로드 문구(키 없을 때 3종)', async () => {
    const r = await api.uploadTexts(null, { productName: 'Divoom Ditoo', lines: ctx.lines, link: 'https://example.com' });
    must(r.fallback && r.styles.length === 3 && r.title, '문구 이상');
    return r.styles.map((s) => s.name).join(', ');
  });
  await check('쿠팡은 키 안내', async () => {
    let msg = '';
    try { await api.coupangSearch(null, '스피커'); } catch (e) { msg = e.message; }
    must(msg === 'NO_COUPANG_KEY', msg);
    return '키 없으면 검색 대신 안내';
  });
  await check('업로드는 계정 안내', async () => {
    const msgs = [];
    for (const p of ['youtube', 'instagram', 'tiktok', 'facebook', 'threads', 'x']) {
      try { await api.upload(() => {}, p, ctx.out, { title: 't', desc: 'd' }); msgs.push(`${p}:성공?`); }
      catch (e) { msgs.push(e.message); must(!/undefined|Cannot read|is not a function/.test(e.message), e.message); }
    }
    return msgs.map((m) => m.split(':')[0].slice(0, 18)).join(' | ');
  });
  await check('채널 연결은 키 안내', async () => {
    for (const k of ['youtube', 'tiktok', 'instagram', 'threads', 'facebook', 'x']) {
      let msg = '';
      try { await api.snsConnect(null, k); } catch (e) { msg = e.message; }
      must(/입력|연결/.test(msg) && !/undefined|Cannot read/.test(msg), `${k}: ${msg}`);
    }
    const all = await api.snsCheckAll(null, ['youtube', 'tiktok', 'instagram', 'threads', 'facebook', 'x']);
    must(Object.values(all).every((x) => x.ok === false), JSON.stringify(all));
    return '6개 채널 모두 안내 후 미연결 처리';
  });
  await check('원클릭배포 입력 검증', async () => {
    let msg = '';
    try { await api.blast(() => {}, { file: ctx.out, title: '', desc: '', targets: ['youtube'] }); } catch (e) { msg = e.message; }
    must(/제목이나 설명/.test(msg), msg);
    try { await api.blast(() => {}, { file: '없는파일.mp4', title: 'a', desc: '', targets: ['youtube'] }); } catch (e) { msg = e.message; }
    must(/영상/.test(msg), msg);
    return '빈 문구·없는 파일 모두 안내';
  });
  await check('예약 등록 후 취소', async () => {
    const r = await api.blast(() => {}, { file: ctx.out, title: '예약 테스트', desc: '본문', targets: ['tiktok', 'instagram'], when: Date.now() + 3600e3 });
    must(r.scheduled && r.queued.length === 2, JSON.stringify(r));
    let st = await api.blastState();
    must(st.jobs.length === 1 && fs.existsSync(st.jobs[0].src), '예약 파일 없음');
    st = await api.blastCancel(null, st.jobs[0].id);
    must(st.jobs.length === 0, '취소 안 됨');
    return '예약 1건 저장 → 취소 → 파일 정리';
  });
  await check('무음 제거 도구', async () => {
    const r = await api.toolSilence(() => {}, ctx.videos[0].file);
    must(fs.existsSync(r.out), '결과 없음');
    return `${r.removed?.toFixed?.(1) || ''}`.trim() || '완료';
  });
  await check('자막 추출 도구는 키 안내', async () => {
    let msg = '';
    try { await api.toolTranscribe(() => {}, ctx.videos[0].file); } catch (e) { msg = e.message; }
    must(/키/.test(msg), msg);
    return msg;
  });

  const failed = results.filter((r) => !r.ok);
  log('BACKEND', `${results.length - failed.length}/${results.length}`);

  require('../main');
  await new Promise((r) => setTimeout(r, 1500));
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.setPosition(-3000, 0);
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  const ev = (js) => win.webContents.executeJavaScript(js);
  const shot = async (name, js) => {
    if (js) await ev(js).catch((e) => errors.push(`${name}: ${e.message}`));
    await new Promise((r) => setTimeout(r, 900));
    win.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(path.join(shots, `full-${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  await shot('trend', '');
  await new Promise((r) => setTimeout(r, 6000));
  await shot('trend-loaded', '');
  const trendCount = await ev('state.trends.length');
  await shot('work', `actions.openProject({val:${JSON.stringify(NAME)}});`);
  await shot('work5', `actions.workTab({val:'5'}); render();`);
  await shot('work7', `actions.workTab({val:'7'}); render();`);
  await shot('deploy', `actions.toBlast();`);
  await shot('projects', `actions.nav({val:'projects'}); render();`);
  await shot('tools', `actions.nav({val:'tools'}); render();`);
  await shot('settings', `actions.nav({val:'settings'}); render();`);
  const uiState = await ev(`JSON.stringify({trends:${trendCount}, view:state.view, lines:state.p.lines.length, exported:!!state.p.exported, deployFile:!!state.blast.file})`);
  log('UI', uiState, 'consoleErrors', errors.length);
  errors.slice(0, 5).forEach((e) => log('  console', e.slice(0, 160)));

  log('---- 결과 ----');
  results.forEach((r) => log(r.ok ? ' OK ' : ' FAIL', r.name));
  log(failed.length ? `실패 ${failed.length}건` : '백엔드 전부 통과');
  app.quit();
});
