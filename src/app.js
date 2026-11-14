const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const sec2 = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const durText = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const fileUrl = (p) => (p ? 'file:///' + p.replace(/\\/g, '/').split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/') : '');
const mb = (b) => (b ? `${(b / 1048576).toFixed(1)}MB` : '');
const INPOCK_ADMIN = 'https://link.inpock.co.kr/admin';
const pickRandom = (arr) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);
const shuffle = (arr) => [...(arr || [])].sort(() => Math.random() - 0.5);

async function attachPartnerLinks(items) {
  const list = (items || []).filter(Boolean).map((x) => ({ ...x }));
  if (!list.length) return [];
  if (!state.aiStatus?.coupang) return list;
  const out = [];
  for (const row of list) {
    const src = row.original || row.url;
    if (!src) { out.push(row); continue; }
    if (/link\.coupang\.com/i.test(src)) {
      row.partner = true;
      out.push(row);
      continue;
    }
    try {
      const r = await api('coupangDeeplink', src);
      if (r?.url) {
        row.original = src;
        row.url = r.url;
        row.short = r.short || r.url;
        row.productId = r.productId || row.productId || '';
        row.partner = true;
      }
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
    }
    out.push(row);
  }
  return out;
}

async function pickOnePartner(items) {
  const one = pickRandom(items);
  return one ? attachPartnerLinks([one]) : [];
}
const platformOf = (url) => {
  const h = String(url).toLowerCase();
  if (h.includes('tiktok')) return 'tiktok';
  if (h.includes('instagram')) return 'instagram';
  if (h.includes('xiaohongshu') || h.includes('xhslink') || h.includes('rednote')) return 'xhs';
  if (h.includes('douyin')) return 'douyin';
  if (h.includes('taobao') || h.includes('tmall')) return 'taobao';
  if (h.includes('1688')) return 'ali1688';
  return 'youtube';
};

async function api(name, ...args) {
  if (!window.native) throw new Error('이 기능은 exe 프로그램에서만 동작합니다.');
  const r = await window.native.api(name, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const SAMPLE_HEAD_STAT = '조회수 235만 | 댓글 697개';

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomHeadStat() {
  return `조회수 ${randInt(200, 500)}만 | 댓글 ${randInt(300, 900)}개`;
}

function ensureHeadStat(edit) {
  if (!edit) return '';
  if (!edit.headStat || edit.headStat === SAMPLE_HEAD_STAT) edit.headStat = randomHeadStat();
  return edit.headStat;
}

function dropSampleHeader(edit) {
  if (!edit) return;
  if (edit.headTop === '리뷰왕' && edit.headTitle === '이게 대체 뭐야?') {
    edit.header = false;
    edit.headTop = '';
    edit.headTitle = '';
  }
  ensureHeadStat(edit);
}

function newProject(name = '새 프로젝트') {
  return {
    name, step: 1, product: null,
    videos: [], analyzed: false,
    styleKey: 'lens-0', benchMine: [],
    length: 30, instruction: '', lines: [],
    tts: { provider: 'gemini', voice: 'Kore', model: 'gemini-3.8-flash-lite-tts', emotion: 'normal', speed: 'brisk' },
    audio: [], ttsReady: false,
    scenes: [], subtitles: [], subMaxChars: 12,
    edit: {
      font: 'Malgun Gothic', size: 85, italic: false, bg: false, border: true, shadow: false, subMode: 'short',
      template: 2, header: false, headTop: '', headTitle: '', headStat: randomHeadStat(), voice: true, sub: true,
      filter: 'none', effect: 'none', transition: false, bgm: null, sfx: [],
      showTemplateImage: false, templateImage: null,
      overlays: [], thumbItems: [],
      topBox: { on: false, color: '#000000', height: 18, opacity: 85, zoom: 50 },
      bottomBox: { on: false, color: '#000000', height: 22, opacity: 70, zoom: 50 },
      thumbLead: true, thumbFlip: false, thumbTime: 1, intro: null,
      prep: { keepAudio: false, silence: 'none' },
    },
    prepared: null, exported: null, thumbnail: null,
    coupang: [], cpKeyword: '', pick: 0,
    upload: { title: '', desc: '', platforms: { youtube: true, instagram: false, tiktok: false }, schedule: '', results: [] },
  };
}

const state = {
  view: 'trend',
  trendTab: 'trend', trendMode: 'today', period: 'today', trendQuery: '',
  trends: [], trendsLoading: false, trendsError: '', trendSource: '', trendNotice: '',
  favs: JSON.parse(localStorage.getItem('sl-favs') || '[]'),
  analysis: {}, liveText: '',
  selected: null, findQ1: '', findQ2: '', zhSource: '', zhManual: false, findCoupangUrl: '', findResults: [], pairs: [], coupangHits: [], findLoading: false, findNote: '', platform: 'all', findVideoOnly: true, added: [],
  workTab: 1, status: null, busy: false, selectedScene: 0, rightPanel: 'text',
  playing: false, time: 0, uploadPick: 0, uploadTexts: null,
  voices: {}, credits: null, projects: [], finished: [], tools: {}, aiStatus: {},
  modal: null, settings: {}, selectedOverlay: null, exportOpen: false, stickerOpen: false,
  intro: { line: '예상 못한 한 장면으로 손이 멈춥니다.', scene: 0 },
  sfxDraft: { make: '', remove: '', volume: 40, log: '' },
  blast: { file: null, name: '', size: 0, title: '', desc: '', targets: JSON.parse(localStorage.getItem('sl-blast-targets') || '{}'), excludeFeed: false, scheduleOn: false, schedule: '', jobs: [], history: [] },
  lens: {
    tab: 'search', query: '', sort: 'views', limit: 30, period: 'year', region: 'KR', shorts: false,
    rows: [], source: '', checked: {}, minViews: 0, minSubs: 0,
    ciiOn: { Great: true, Good: true, Soso: true, 'Not bad': true, Bad: true },
    groups: JSON.parse(localStorage.getItem('sl-lens-groups') || '[]'), groupId: 'all',
    channelQ: '', found: [], pickedFound: {}, pickedCh: {}, perChannel: 20,
    focus: '', pane: 'report', scriptMode: 'recreate', scriptPrompt: '', scriptText: '', scriptFallback: false, ideas: null,
  },
  userTemplates: JSON.parse(localStorage.getItem('sl-user-templates') || '[]'),
  p: newProject(),
  cpLink: { text: '', rows: [], note: '' },
  hookStatus: { bank: 200, used: 0, left: 200, learned: 0, hookAuto: 'on', hookStyle: 'both', hookCategory: 'auto', groups: [] },
};

/* ---------- helpers ---------- */
function thumb(item, cls = 'r916', extra = '') {
  const img = item.img ? `;background-image:url('${item.img}')` : '';
  return `<div class="thumb ${cls} ${item.img ? 'has-img' : ''}" style="--h:${item.hue ?? 210}${img}"><span class="e">${item.emoji ?? '🎬'}</span>${extra}</div>`;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function pushStatusLog(line) {
  if (!state.status) return;
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const logs = state.status.logs || (state.status.logs = []);
  const t = new Date().toISOString().slice(11, 19);
  const row = `[${t}] ${text}`;
  if (logs[logs.length - 1]?.slice(11) === text) return;
  logs.push(row);
  if (logs.length > 120) logs.splice(0, logs.length - 120);
}

function statusLogText() {
  const s = state.status;
  if (!s) return '';
  return [...(s.logs || []), s.text ? `현재: ${s.text}` : ''].filter(Boolean).join('\n');
}

function statusHtml() {
  const s = state.status;
  if (!s) return '';
  const logs = (s.logs || []).join('\n');
  const copy = `<button class="btn sm" data-act="copyStatusLog" title="진행 로그 복사">로그 복사</button>`;
  const toggle = logs
    ? `<button class="btn sm" data-act="toggleStatusLog">${s.logClosed ? '로그 보기' : '로그 닫기'}</button>`
    : '';
  const logBox = logs && !s.logClosed
    ? `<div class="status-log-wrap">
        <button class="status-log-close" data-act="toggleStatusLog" title="로그 닫기">✕</button>
        <pre class="status-log" id="status-log">${esc(logs)}</pre>
      </div>`
    : '';
  if (s.running) {
    return `<div class="status-box">
      <div class="status running">
        <span class="status-now" title="${esc(s.text)}">${esc(s.text)} [${mmss(s.elapsed || 0)}]</span>
        <div class="bar"><i style="width:${(s.progress || 0) * 100}%"></i></div>
        ${copy}
        ${toggle}
        <button class="btn sm" data-act="stop">중지</button>
      </div>
      ${logBox}
    </div>`;
  }
  return `<div class="status-box">
    <div class="status ${s.error ? 'error' : 'done'}" title="${esc(s.text)}">
      <span class="status-now">${esc(s.text)}</span>
      ${copy}
      ${toggle}
      <button class="x-btn" data-act="clearStatus">✕</button>
    </div>
    ${logBox}
  </div>`;
}
function updateStatus() {
  const slot = $('#status-slot');
  if (!slot) return;
  slot.innerHTML = statusHtml();
  const log = slot.querySelector('.status-log');
  if (log) log.scrollTop = log.scrollHeight;
}

async function task(runText, fn, doneText) {
  if (state.busy) {
    toast('다른 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요.');
    return undefined;
  }
  state.busy = true;
  state.stop = false;
  const start = Date.now();
  state.status = { running: true, text: runText, progress: 0, elapsed: 0, logs: [] };
  pushStatusLog(runText);
  const tick = setInterval(() => {
    state.status.elapsed = (Date.now() - start) / 1000;
    updateStatus();
  }, 500);
  render();
  try {
    const r = await fn();
    const produced = typeof doneText === 'function' ? doneText(r) : doneText;
    const text = produced || (typeof r === 'string' ? r : '완료');
    const prev = state.status || {};
    state.status = {
      running: false,
      text: `${text} (소요시간: ${mmss((Date.now() - start) / 1000)})`,
      logs: prev.logs || [],
      logClosed: !!prev.logClosed,
    };
    autosave();
    return r;
  } catch (e) {
    const cancelled = /CANCELLED/.test(e.message);
    const prev = state.status || {};
    state.status = {
      running: false,
      error: !cancelled,
      text: cancelled ? '작업을 중지했습니다.' : `오류: ${e.message}`,
      logs: prev.logs || [],
      logClosed: !!prev.logClosed,
    };
    if (!cancelled) toast('작업 중 오류가 발생했습니다. 위쪽 상태 표시를 확인하세요.');
    autosave();
    return undefined;
  } finally {
    clearInterval(tick);
    state.busy = false;
    render();
  }
}

if (window.native) {
  window.native.onBlast?.(() => loadBlast());
  window.native.onProgress((d) => {
    if (d.text) state.liveText = d.text;
    const live = $('#live-progress');
    if (live && d.text) live.textContent = d.text;
    if (state.status?.running) {
      if (d.text) {
        state.status.text = d.text;
        pushStatusLog(d.text);
      }
      if (d.progress != null) state.status.progress = d.progress;
      updateStatus();
    }
  });
}

function autosave() {
  if (!window.native) return;
  state.p.step = state.workTab;
  state.p.coverThumb = state.p.videos[0]?.thumb || null;
  api('saveProject', state.p).catch(() => {});
}

function copyText(text, msg) {
  navigator.clipboard.writeText(text).then(() => toast(msg)).catch(() => toast('복사하지 못했습니다.'));
}

function koSearchKeyword(p) {
  if (!p) return '';
  const stamp = /\s+\d{4}\s+\d{4}(?:_src.*)?$/;
  const list = [p.searchKo, ...(p.product?.kw?.ko || []), p.cpKeyword, p.product?.name, p.name];
  for (const raw of list) {
    const s = String(raw || '').trim().replace(/_src\d+.*/, '').replace(stamp, '').trim();
    if (!s || s === '새 프로젝트' || /^내영상/.test(s) || !/[가-힣]/.test(s)) continue;
    return s;
  }
  return '';
}

function productTitleText(p) {
  return String(p?.coupang?.[0]?.title || p?.product?.name || p?.upload?.title || '').trim();
}

function openUrl(url) {
  if (window.native) api('openExternal', url);
  else window.open(url);
}

/* ---------- timing ---------- */
function lineDurations() {
  const p = state.p;
  const src = p.prepared?.audios?.length === p.lines.length ? p.prepared.audios : p.audio.length === p.lines.length ? p.audio : null;
  return p.lines.map((l, i) => (src ? src[i].dur : Math.max(1, l.length * 0.17 + 0.3)));
}

function buildSubtitles() {
  const p = state.p;
  const durs = lineDurations();
  const subs = [];
  let t = 0;
  p.lines.forEach((line, li) => {
    const words = line.replace(/[,.]/g, '').split(/\s+/).filter(Boolean);
    const chunks = [];
    let chunk = '';
    words.forEach((w) => {
      if (chunk && (chunk + ' ' + w).length > p.subMaxChars) {
        chunks.push(chunk);
        chunk = w;
      } else chunk = (chunk + ' ' + w).trim();
    });
    if (chunk) chunks.push(chunk);
    const totalChars = chunks.reduce((a, c) => a + c.length, 0) || 1;
    chunks.forEach((c) => {
      const d = (durs[li] * c.length) / totalChars;
      subs.push({ start: t, end: t + d, text: c, line: li });
      t += d;
    });
    if (!chunks.length) t += durs[li];
  });
  p.subtitles = subs;
  if (p.scenes.length && p.scenes.length === p.lines.length) {
    p.scenes.forEach((s, i) => (s.dur = +(durs[s.line ?? i] || s.dur || 1.5).toFixed(2)));
  }
}

function totalDuration() {
  const s = state.p.subtitles;
  if (s.length) return s[s.length - 1].end;
  return state.p.scenes.reduce((a, x) => a + (x.dur || 0), 0) || 3;
}

function sceneThumb(s) {
  return state.p.videos[s.src]?.scenes?.[s.clip]?.thumb || state.p.videos[s.src]?.thumb || '';
}

function sceneAt(t) {
  let acc = 0;
  for (const s of state.p.scenes) {
    acc += s.dur || 0;
    if (t < acc) return s;
  }
  return state.p.scenes[state.p.scenes.length - 1];
}

function ensureTimeline() {
  const p = state.p;
  if (p.scenes.length) return;
  const pool = [];
  p.videos.forEach((v, src) => (v.scenes || []).forEach((c, clip) => {
    if ((c.dur || 0) > 0.15) pool.push({ src, clip, dur: c.dur, text: '', line: 0 });
  }));
  if (!pool.length && p.videos.some((v) => v.file)) {
    const target = p.subtitles.length ? p.subtitles[p.subtitles.length - 1].end : (p.videos[0].dur || 10);
    p.scenes = [{ src: p.videos.findIndex((v) => v.file), clip: 0, dur: +target.toFixed(2), text: '', line: 0 }];
    return;
  }
  if (!pool.length) return;
  const target = p.subtitles.length ? p.subtitles[p.subtitles.length - 1].end : pool.reduce((a, s) => a + s.dur, 0);
  const out = [];
  let acc = 0;
  let i = 0;
  while (acc < target - 0.05 && out.length < 80) {
    const s = pool[i % pool.length];
    const dur = Math.min(s.dur, target - acc);
    out.push({ src: s.src, clip: s.clip, dur: +Math.max(0.2, dur).toFixed(2), text: '', line: 0 });
    acc += dur;
    i++;
  }
  p.scenes = out;
}

function placeAt(t) {
  let acc = 0;
  const scenes = state.p.scenes;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const dur = s.dur || 0;
    if (t < acc + dur || i === scenes.length - 1) {
      const v = state.p.videos[s.src];
      const c = v?.scenes?.[s.clip];
      const local = Math.max(0, Math.min(dur || 0.1, t - acc));
      return { file: v?.file || '', inPoint: (c?.start || 0) + local, scene: s };
    }
    acc += dur;
  }
  return null;
}

function allStyles() {
  return [
    ...PRESETS.lensStyles.map((s, i) => ({ ...s, key: `lens-${i}`, group: 'lens' })),
    ...state.p.benchMine.map((s, i) => ({ ...s, key: `my-${i}`, group: 'my' })),
  ];
}

/* ---------- trend ---------- */
function viewTrend() {
  return `
    <div class="tabs">
      <button class="tab ${state.trendTab === 'trend' ? 'active' : ''}" data-act="set" data-key="trendTab" data-val="trend">쇼핑 트렌드</button>
      <button class="tab ${state.trendTab === 'find' ? 'active' : ''}" data-act="set" data-key="trendTab" data-val="find">제품찾기</button>
    </div>
    ${state.trendTab === 'trend' ? trendList() : productFind()}`;
}

function trendList() {
  const modes = [
    ['today', '🔥 오늘의 트렌드', '최근 떡상한 쇼핑 쇼츠'],
    ['keyword', '🔍 키워드 검색', '키워드로 쇼츠 탐색'],
    ['fav', '⭐ 즐겨찾기', '저장한 영상 모아보기'],
  ];
  let items = state.trendMode === 'fav' ? state.favs : state.trends;
  if (state.trendMode !== 'keyword' && state.trendQuery) items = items.filter((t) => t.title.includes(state.trendQuery) || t.channel.includes(state.trendQuery));
  let body;
  if (state.trendsLoading && state.trendMode !== 'fav') body = `<div class="empty"><div class="spinner"></div><div id="live-progress">유튜브에서 쇼츠를 모으는 중입니다...</div></div>`;
  else if (state.trendsError && state.trendMode !== 'fav') body = `<div class="empty">불러오지 못했습니다: ${esc(state.trendsError)}<br><button class="btn" style="margin-top:10px" data-act="refreshTrend">다시 시도</button></div>`;
  else body = items.length ? `<div class="grid5">${items.map((t, i) => trendCard(t, i)).join('')}</div>` : `<div class="empty">${state.trendMode === 'keyword' ? '키워드를 입력하고 Enter를 누르세요.' : '표시할 영상이 없습니다.'}</div>`;

  return `
    <h2>쇼핑 트렌드 TOP 100</h2>
    ${state.trendSource === 'ytdlp' && state.trendMode !== 'fav' ? `<div class="notice">${esc(state.trendNotice || '지금은 API 키 없이 유튜브 검색 결과와 인기 해시태그 쇼츠로 모은 목록입니다. 설정에 무료 YouTube Data API 키를 넣으면 기간별 조회수 순위와 구독자 수가 정확해집니다.')}</div>` : ''}
    <div class="mode-cards">
      ${modes.map(([id, t, d]) => `<button class="mode-card ${state.trendMode === id ? 'active' : ''}" data-act="trendMode" data-val="${id}"><b>${t}</b><small>${d}</small></button>`).join('')}
    </div>
    <div class="row" style="margin-bottom:14px">
      ${state.trendMode !== 'fav' ? [['today', '오늘'], ['week', '주간'], ['month', '월간']].map(([id, l]) => `<button class="pill ${state.period === id ? 'active' : ''}" data-act="period" data-val="${id}">${l}</button>`).join('') : ''}
      <div class="grow"></div>
      <span class="muted small">${state.trendSource === 'api' ? 'YouTube API 기준' : state.trendSource ? 'YouTube 검색 기준' : ''}</span>
      ${state.trendMode !== 'fav' ? '<button class="btn sm" data-act="refreshTrend">갱신</button>' : ''}
      <input style="width:220px" placeholder="${state.trendMode === 'keyword' ? '키워드 입력 후 Enter' : '결과내 검색 (Enter)'}" value="${esc(state.trendQuery)}" data-enter="trendSearch" />
    </div>
    ${body}`;
}

function trendCard(t, i) {
  const fav = state.favs.some((f) => f.url === t.url);
  return `
    <div class="card">
      <div data-act="openTrend" data-url="${esc(t.url)}" style="position:relative">
        <span class="rank">${i + 1}</span>
        ${thumb(t, 'r34', `<span class="badge">${durText(t.dur)}</span>`)}
      </div>
      <div class="card-body">
        <div class="card-meta"><span class="views">${fmt(t.views)}회</span><span>${t.date || ''}</span></div>
        <div class="card-title">${esc(t.title)}</div>
        <div class="muted small ellipsis">${esc(t.channel)}${t.subs ? ` · 구독자 ${fmt(t.subs)}` : ''}</div>
        <div class="card-actions">
          <button class="btn blue sm" data-act="findProduct" data-url="${esc(t.url)}">제품찾기</button>
          <button class="star ${fav ? 'on' : ''}" data-act="fav" data-url="${esc(t.url)}">★</button>
        </div>
      </div>
    </div>`;
}

function findItem(url) {
  return state.trends.find((t) => t.url === url) || state.favs.find((t) => t.url === url) || (state.selected?.url === url ? state.selected : null) || { url, title: url, views: 0, channel: '' };
}

async function ensureAnalysis(item, force = false) {
  const cur = state.analysis[item.url];
  if (!force && cur && cur !== 'error') return cur;
  state.analysis[item.url] = 'loading';
  state.liveText = '';
  render();
  try {
    state.analysis[item.url] = await api('analyzeVideo', item.url);
  } catch (e) {
    state.analysis[item.url] = { error: e.message };
  }
  render();
  return state.analysis[item.url];
}

function trendModal(url) {
  const t = findItem(url);
  const a = state.analysis[url];
  const info = a?.info || t;
  const fav = state.favs.some((f) => f.url === url);
  let body;
  if (a === 'loading') body = `<div class="empty"><div class="spinner"></div><div id="live-progress">${esc(state.liveText || '분석 준비 중')}</div></div>`;
  else if (!a || a.error) body = `<div class="empty">${a?.error ? `분석 실패: ${esc(a.error)}` : ''}<br><button class="btn" data-act="aiAnalyze" data-url="${esc(url)}">다시 분석</button></div>`;
  else {
    const an = a.analysis;
    const kwRow = (label, arr) => (arr?.length ? `<div class="row wrap" style="margin-bottom:4px"><span class="kw-label">${label}</span>${arr.map((k) => `<span class="chip" data-act="kwSearch" data-url="${esc(url)}" data-val="${esc(k)}">${esc(k)}</span>`).join('')}</div>` : '');
    body = `
      ${an.fallback ? `<div class="notice">${a.aiError ? `AI 분석 오류: ${esc(a.aiError)}` : 'AI 키가 없어 자막과 기본 정보만 표시합니다. 설정에서 Gemini 키를 넣으면 상세 분석됩니다.'}</div>` : ''}
      <div class="info-box"><div class="sec-title">📦 제품 정보 및 특징</div><div class="small wrap-text">제품 ${esc(an.product)}</div>${(an.features || []).map((f) => `<div class="small wrap-text">• ${esc(f)}</div>`).join('')}</div>
      <div class="info-box"><div class="sec-title">🔍 원본찾기/추천 검색어</div>${kwRow('한글', an.kw?.ko)}${kwRow('영어', an.kw?.en)}${kwRow('중국', an.kw?.zh)}</div>
      <div class="info-box"><div class="sec-title">🎬 영상 흐름</div><div class="small wrap-text">${esc(an.flow)}</div></div>
      <div class="info-box"><div class="sec-title">🔥 떡상 요인</div><div class="kv"><span>왜 떴는가</span><span>${esc(an.why)}</span></div></div>
      <div class="info-box"><div class="sec-title">🎧 후킹 방식</div><div class="kv"><span>비주얼 훅</span><span>${esc(an.hook?.visual)}</span><span>멘트 훅</span><span>${esc(an.hook?.ment)}</span><span>후킹 포인트</span><span>${esc(an.hook?.point)}</span></div></div>
      <div class="info-box"><div class="sec-title">📣 CTA 방식</div><div class="small wrap-text">${esc(an.cta)}</div></div>
      ${a.transcript ? `<div class="info-box"><div class="sec-title">📝 자막 원문</div><div class="small wrap-text muted">${esc(a.transcript)}</div></div>` : ''}`;
  }
  return `
    <div class="modal trend-modal">
      <button class="close" data-act="closeModal">✕</button>
      <div class="video">${thumb({ ...t, img: t.img || info.img }, '', `<span class="badge">▶ ${durText(info.dur || t.dur)}</span>`)}
        <button class="btn blue" style="width:100%;margin-top:10px" data-act="openUrl" data-val="${esc(url)}">▶ 원본 영상 보기</button></div>
      <div class="info">
        <div class="info-box">
          <h3 class="wrap-text">${esc(info.title)}</h3>
          <div class="muted small" style="margin-top:6px">${esc(info.channel)}${info.subs ? ` · 구독자 ${fmt(info.subs)}` : ''}</div>
          <div class="muted small">${info.date ? `${info.date} 업로드 · ` : ''}영상 길이 ${durText(info.dur || t.dur)}</div>
        </div>
        <div class="info-box stats">
          <div><span class="muted small">조회수</span><b class="hot">${fmt(info.views || t.views)}회</b></div>
          <div><span class="muted small">좋아요</span><b>${info.likes ? fmt(info.likes) : '-'}</b></div>
          <div><span class="muted small">댓글</span><b>${info.comments ? fmt(info.comments) : '-'}</b></div>
        </div>
        <div class="row" style="margin-bottom:14px">
          <button class="btn blue grow" data-act="findProduct" data-url="${esc(url)}">제품찾기</button>
          <button class="btn blue grow" data-act="styleFromTrend" data-url="${esc(url)}">스타일 분석</button>
          <button class="btn grow" data-act="aiAnalyze" data-url="${esc(url)}">AI분석</button>
          <button class="star ${fav ? 'on' : ''}" style="height:34px" data-act="fav" data-url="${esc(url)}">★</button>
        </div>
        <div class="sec-title">AI 영상 분석</div>
        ${body}
      </div>
    </div>`;
}

function pairList() {
  if (!state.pairs.length) return '';
  return `<div class="panel" style="margin-bottom:14px">
    <div class="panel-title">거의 같은 영상 <span class="muted">${state.pairs.length}쌍</span><div class="grow"></div><span class="muted small">왼쪽 유튜브는 분석, 오른쪽 해외 영상이 작업용</span></div>
    ${state.pairs.map((p, i) => `
      <div class="pair-row">
        <div class="pair-side">${thumb(p.youtube, 'r34')}<div class="small"><b>분석 · 유튜브</b><div class="wrap-text">${esc(p.youtube.title)}</div></div></div>
        <div class="pair-score">${p.score}%</div>
        <div class="pair-side">${thumb(p.xhs, 'r34')}<div class="small"><b>작업 · ${esc(({ xhs: '샤오홍슈', douyin: '도우인', tiktok: '틱톡', taobao: '타오바오', ali1688: '1688' })[p.xhs?.platform] || '해외')}</b><div class="wrap-text">${esc(p.xhs.title)}</div>${p.why ? `<div class="muted">${esc(p.why)}</div>` : ''}</div></div>
        <div class="pair-actions">
          <button class="btn blue sm" data-act="usePair" data-i="${i}">이 쌍으로 작업</button>
          <button class="btn green sm" data-act="oneClick" data-i="${i}">원클릭 생성</button>
        </div>
      </div>`).join('')}
  </div>`;
}

function shopHasVideo(v) {
  if (!v) return false;
  if (v.video || v.media || v.file) return true;
  return !['taobao', 'ali1688'].includes(v.platform);
}

function productFind() {
  const t = state.selected;
  const platform = PRESETS.platforms.find((p) => p.id === state.platform);
  const socialOn = SOCIAL.includes(state.platform);
  let results = state.findResults
    .filter((v) => (socialOn ? v.platform === state.platform : (v.platform || 'youtube') === 'youtube'))
    .filter((v) => !COUPANG_FILTER_PLATFORMS.includes(v.platform) || (v.coupang?.length && v.url));
  const videoCount = results.filter(shopHasVideo).length;
  const photoCount = results.length - videoCount;
  if (state.findVideoOnly) results = results.filter(shopHasVideo);
  results = [...results].sort((a, b) => Number(shopHasVideo(b)) - Number(shopHasVideo(a)));
  return `
    <h2>원본 영상 찾기</h2>
    <div class="panel" style="margin-bottom:16px">
      <div class="row" style="align-items:flex-start;gap:14px">
        ${t ? `<div style="width:84px;flex-shrink:0">${thumb(t, 'r34')}</div>` : ''}
        <div class="grow">
          <input style="width:100%;margin-bottom:8px" placeholder="🔗 작업에 넣을 해외 영상 링크를 붙여넣고 Enter (샤오홍슈·도우인·틱톡·타오바오·1688)" data-enter="addLink" />
          <div class="row" style="margin-bottom:8px">
            <input id="find-coupang-url" class="grow" placeholder="🛒 쿠팡 상품 URL (있으면 붙여넣기) · 없어도 아래 검색어로 쿠팡부터 찾습니다" value="${esc(state.findCoupangUrl)}" data-model-state="findCoupangUrl" data-enter="coupangOneClick" style="border-color:#e85d04" />
            <button class="btn green" data-act="matchXhs">해외 영상 비교</button>
          </div>
          <div class="row" style="margin-bottom:8px">
            <input class="grow" placeholder="검색어 (한글) · 예: 구름 깔창" value="${esc(state.findQ1)}" data-model-state="findQ1" data-enter="matchXhs" />
            <input class="grow" placeholder="중국어 검색어 · 비우면 자동 번역" value="${esc(state.findQ2)}" data-model-state="findQ2" />
            <button class="btn green" data-act="matchXhs">해외 영상 비교</button>
          </div>
          ${t && state.analysis[t.url]?.analysis ? `<div class="row wrap">${[...(state.analysis[t.url].analysis.kw?.ko || []), ...(state.analysis[t.url].analysis.kw?.en || []), ...(state.analysis[t.url].analysis.kw?.zh || [])].map((k) => `<span class="chip ${k === state.findQ1 || k === state.findQ2 ? 'active' : ''}" data-act="pickKw" data-val="${esc(k)}">${esc(k)}</span>`).join('')}</div>` : ''}
          <div class="row wrap" style="margin-top:10px">
            ${PRESETS.platforms.map((p) => {
              const rows = p.id === 'all' ? state.findResults : state.findResults.filter((v) => (v.platform || 'youtube') === p.id);
              const n = (['taobao', 'ali1688'].includes(p.id) && state.findVideoOnly) ? rows.filter(shopHasVideo).length : (p.id === 'all' ? (state.pairs.length || rows.length) : rows.length);
              return `<button class="pill ${state.platform === p.id ? 'active' : ''}" data-act="set" data-key="platform" data-val="${p.id}">${p.label}${n ? ` ${n}${p.id === 'all' && state.pairs.length ? '쌍' : ''}` : ''}</button>`;
            }).join('')}
            <button class="pill ${state.findVideoOnly ? 'active' : ''}" data-act="toggleFindVideoOnly">영상 있는 것만${photoCount ? ` ${videoCount}` : ''}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="find-layout">
      <div>
        <div class="notice" style="margin-bottom:12px"><b>쿠팡 URL</b> 또는 <b>검색어</b>를 넣고 해외 영상 비교를 누르면 쿠팡에서 상품을 찾은 뒤 <b>1688</b>과 <b>샤오홍슈</b>에서 영상을 모읍니다. 같은 영상은 한 번만, 최대 8개까지 고를 수 있습니다. 원클릭 생성에서 중국어 자막 자리를 지운 뒤 한국어를 올립니다. 인포크에 올리려면 <button class="btn sm" data-act="openUrl" data-val="${INPOCK_ADMIN}">인포크 관리</button>를 누르세요.</div>
        ${pairList()}
        ${platform?.search ? `<div class="panel notice-panel"><b>${platform.label}</b> 검색 결과를 아래 목록으로 가져옵니다. ${['xhs', 'douyin', 'taobao', 'ali1688'].includes(platform.id) ? '검색어는 중국어로 바꿉니다. ' : ''}처음에는 열린 창에서 로그인하거나 확인을 마친 뒤 검색을 다시 누르세요.<div style="margin-top:10px"><button class="btn blue" data-act="openPlatformSearch" data-val="${platform.id}">${platform.label} 목록 가져오기</button></div></div>` : ''}
        ${state.platform === 'all' ? `<div class="row wrap" style="margin-bottom:12px">${PRESETS.platforms.filter((p) => p.search).map((p) => `<button class="btn sm" data-act="openPlatformSearch" data-val="${p.id}">${p.label} 목록${['xhs', 'douyin', 'taobao', 'ali1688'].includes(p.id) && state.findQ2 ? ` · ${esc(state.findQ2)}` : ''}</button>`).join('')}</div>` : ''}
        ${state.findNote ? `<div class="notice" style="margin-bottom:12px">${esc(state.findNote)}</div>` : ''}
        ${!state.findLoading && state.findVideoOnly && photoCount ? `<div class="notice" style="margin-bottom:12px">사진만 있는 상품 ${photoCount}개는 숨겼습니다. <b>영상 있는 것만</b>을 끄면 전체가 나옵니다.</div>` : ''}
        ${state.findLoading ? '<div class="empty"><div class="spinner"></div>검색 중...</div>' : results.length ? `<div class="grid5">${results.map((v) => {
          const added = state.added.some((a) => a.url === v.url);
          const hasVid = shopHasVideo(v);
          return `
          <div class="card ${hasVid ? '' : 'no-video'}">
            ${thumb(v, 'r916', hasVid ? `<span class="badge vid">▶ 영상</span>` : `<span class="badge">${v.dur ? durText(v.dur) : '사진'}</span>`)}
            <div class="card-body">
              <div class="muted small">${v.views ? `${fmt(v.views)}회 · ` : ''}${esc(v.channel || '')}</div>
              <div class="card-title">${esc(v.title)}</div>
              ${v.coupangName ? `<div class="muted small">쿠팡 · ${esc(v.coupangName)}</div>` : ''}
              <div class="card-actions">
                <span class="platform-tag">${esc(({ youtube: '유튜브', tiktok: '틱톡', instagram: '인스타', xhs: '샤오홍슈', douyin: '도우인', taobao: '타오바오', ali1688: '1688' })[v.platform || 'youtube'] || '')}</span>
                <button class="btn sm" data-act="openUrl" data-val="${esc(v.url)}">열기</button>
                ${[...COUPANG_FILTER_PLATFORMS, 'tiktok'].includes(v.platform) ? `<button class="btn blue sm" data-act="addSource" data-url="${esc(v.url)}" ${added ? 'disabled' : ''}>${added ? '추가됨' : '추가'}</button>` : '<span class="muted small">분석용</span>'}
              </div>
            </div>
          </div>`;
        }).join('')}</div>` : (photoCount && state.findVideoOnly ? '<div class="empty">영상 있는 상품이 없습니다. <b>영상 있는 것만</b>을 끄면 사진 상품도 볼 수 있습니다.</div>' : (!platform?.search ? '<div class="empty">검색어를 입력하고 검색을 누르세요.</div>' : ''))}
      </div>
      <div class="panel" style="align-self:start;position:sticky;top:0">
        <div class="panel-title">추가영상 ${state.added.length}/8 <div class="grow"></div><button class="btn sm ghost" data-act="clearAdded">비우기</button></div>
        <div class="added-list">
          ${state.added.length ? state.added.map((v, i) => `
            <div class="added-item">${thumb(v)}<div class="grow small wrap-text">${esc(v.title)}${v.refTitle ? `<div class="muted">분석 · ${esc(v.refTitle)}</div>` : ''}</div><button class="sq-btn" data-act="removeAdded" data-i="${i}">X</button></div>`).join('') : '<div class="empty">해외 영상을 추가하세요.</div>'}
        </div>
        <button class="btn blue" style="width:100%;margin-top:10px" data-act="toPrepare" ${state.added.length ? '' : 'disabled'}>영상 준비로 이동</button>
        <button class="btn green" style="width:100%;margin-top:8px" data-act="matchXhs">원클릭 영상 생성</button>
      </div>
    </div>`;
}

/* ---------- workroom ---------- */
const WORK_TABS = ['영상 준비', '대본', '장면 구성', '자막 정리', '최종편집', '쿠팡 제품 찾기', '자동 업로드'];
const WORK_DESC = ['소스 영상 다운로드 · 분석', '스타일 분석 · 대본 · 음성', '문장별 장면 매칭', '자막 분할 · 교정', '템플릿 · 효과 · 내보내기', '수익 링크 수집', '문구 생성 · 발행'];

function stepDone(n) {
  const p = state.p;
  return [null, p.videos.some((v) => v.done) && p.analyzed, p.ttsReady, p.scenes.length > 0, p.subtitles.length > 0, !!p.exported, p.coupang.length > 0, (p.upload.results || []).some((r) => r.ok)][n];
}

function viewWork() {
  const views = [null, tabPrepare, tabScript, tabScenes, tabSubtitles, tabEdit, tabCoupang, tabUpload];
  const doneCount = WORK_TABS.filter((_, i) => stepDone(i + 1)).length;
  return `
    <div class="work">
      <aside class="stepper">
        <div class="proj-card">
          <span class="eyebrow">PROJECT</span>
          <input id="project-name" value="${esc(state.p.name)}" data-model="name" />
          <div class="row"><button class="btn red sm" data-act="saveProject">저장</button><button class="btn sm" data-act="newProject">＋ 새 프로젝트</button></div>
          <button class="btn sm" style="width:100%;margin-top:6px" data-act="folder" data-val="">📁 프로젝트 폴더 열기</button>
        </div>
        <div class="steps">
          ${WORK_TABS.map((n, i) => { const s = i + 1; const done = stepDone(s); return `
            <button class="step ${state.workTab === s ? 'active' : ''} ${done ? 'done' : ''}" data-act="workTab" data-val="${s}">
              <span class="dot">${done ? '✓' : s}</span><span><b>${n}</b><small>${WORK_DESC[i]}</small></span>
            </button>`; }).join('')}
        </div>
        <div class="progress-card">
          <div class="row"><b>진행률</b><div class="grow"></div><span class="muted small">${doneCount} / 7 단계</span></div>
          <div class="track"><i style="width:${(doneCount / 7) * 100}%"></i></div>
        </div>
      </aside>
      <section>
        <div class="work-head">
          <div><span class="eyebrow">STEP ${String(state.workTab).padStart(2, '0')}</span><h2>${WORK_TABS[state.workTab - 1]}</h2></div>
          <div class="grow"></div>
          <button class="btn green" data-act="oneClick">${oneClickResumeAt(state.p) ? '이어서 생성' : '원클릭 영상 생성'}</button>
        </div>
        ${views[state.workTab]()}
      </section>
    </div>`;
}

function tabPrepare() {
  const p = state.p;
  return `
    <div class="panel" style="padding:12px;margin-bottom:14px">
      <div class="row">
        <b>🎞️ 소스 영상</b>
        <input class="grow" placeholder="해외 영상 링크를 붙여넣고 Enter (샤오홍슈·도우인·틱톡·타오바오·1688)" data-enter="prepLink" />
        <button class="btn green sm" data-act="addLocalVideos">내 PC 영상 올리기</button>
        <button class="btn blue sm" data-act="download" ${p.videos.some((v) => !v.done) ? '' : 'disabled'}>⬇ 다운로드</button>
        <button class="btn sm" data-act="folder" data-val="videos">📁 다운로드 폴더</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 300px;gap:18px">
      <div class="panel" id="prep-panel">
        <div class="panel-title">추가된 영상 <span class="muted">${p.videos.length} / 8개</span><div class="grow"></div><button class="btn sm ghost" data-act="clearVideos">비우기</button></div>
        <div class="ocd-drop" id="prep-drop" data-act="addLocalVideos" style="margin-bottom:14px">
          <div class="cloud">⬆</div>
          <div><b>영상을 여기로 끌어다 놓거나 클릭해서 선택</b><div class="muted small">MP4 · MOV · MKV · WebM · AVI · 최대 8개</div></div>
        </div>
        ${p.videos.length ? `<div class="notice" style="margin-bottom:12px">미리보기로 확인한 뒤 <b>이 영상 사용</b>을 고르고, 위쪽 <b>원클릭 영상 생성</b>을 누르면 중국어 자막 자리를 지운 뒤 그 자리에 한국어 자막을 올려 완성합니다.</div>
        <div class="grid5">${p.videos.map((v, i) => `
          <div class="card ${+p.pick === i ? 'picked' : ''}" data-act="pickVideo" data-i="${i}">
            ${thumb({ ...v, img: v.thumb ? fileUrl(v.thumb) : v.img }, 'r34', `<button class="x" data-act="removeVideo" data-i="${i}">✕</button>${+p.pick === i ? '<span class="badge">선택</span>' : ''}`)}
            <div class="card-body">
              <div class="small ellipsis" title="${esc(v.title)}">${esc(v.title)}</div>
              ${v.refTitle ? `<div class="muted small ellipsis" title="${esc(v.refTitle)}">분석 · 유튜브 ${esc(v.refTitle)}</div>` : ''}
              <div class="card-meta"><span>${v.done ? '<span class="ok">● 완료</span>' : v.error ? `<span class="bad">● ${esc(v.error)}</span>` : '● 대기'}</span><span>${v.local ? '내 PC · ' : ''}${durText(v.dur)} ${mb(v.size)}</span></div>
              ${v.done ? `<div class="card-actions" style="margin-top:6px">
                <button class="btn sm" data-act="playVideo" data-i="${i}">▶ 미리보기</button>
                <button class="btn ${+p.pick === i ? 'green' : 'blue'} sm" data-act="pickVideo" data-i="${i}">${+p.pick === i ? '선택됨' : '이 영상 사용'}</button>
              </div>` : ''}
            </div>
          </div>`).join('')}</div>` : '<div class="muted small">아직 올린 영상이 없습니다. 위 영역으로 끌어다 놓으세요.</div>'}
      </div>
      <div class="panel" style="align-self:start">
        <div class="panel-title">소스 영상 분석</div>
        <button class="btn blue" style="width:100%" data-act="analyzeSources" ${p.videos.some((v) => v.done) ? '' : 'disabled'}>소스 영상 분석</button>
        <div style="margin-top:14px" class="small">
          <div class="muted">분석 내용</div><div class="wrap-text">장면을 나눈 뒤 원본 음성을 빼고, 중국어 자막이 있던 자리를 지운 다음 그 자리에 한국어 자막을 덮습니다.</div>
        </div>
        <div style="margin-top:14px">
          ${p.analyzed ? p.videos.map((v, i) => `<div class="info-box small wrap-text"><b>소스 ${i + 1}</b> · ${v.scenes?.length || 0}개 장면${v.cleaned ? '<br><span class="ok">원본 음성을 뺐고, 자막 자리를 지웠습니다.</span>' : ''}${v.summary && v.summary !== `${v.scenes?.length || 0}개 장면` ? `<br><span class="muted">${esc(v.summary)}</span>` : ''}</div>`).join('') + `<button class="btn blue" style="width:100%;margin-top:12px" data-act="workTab" data-val="2">다음 단계 · 대본 만들기</button>` : '<div class="muted small">분석을 누르면 장면이 아래에 나옵니다.</div>'}
        </div>
      </div>
    </div>
    ${p.analyzed ? `<div class="panel" style="margin-top:14px">
      <div class="panel-title">나눠진 장면<div class="grow"></div><span class="muted small">이 장면들로 3단계에서 대본과 맞춥니다</span></div>
      ${p.videos.map((v, si) => `
        <div class="small" style="margin:8px 0 6px"><b>소스 ${si + 1}</b> <span class="muted">${esc(v.title || '')}</span></div>
        <div class="clip-row">
          ${(v.scenes || []).map((c, ci) => `
            <div class="clip" title="${esc(c.label || '')}">
              ${thumb({ img: fileUrl(c.thumb), hue: 20 + si * 70 }, '', `<span class="no">${ci + 1}</span><span class="badge">${(c.dur || 0).toFixed(1)}초</span>`)}
              <div class="l">${esc(c.label || `${(c.dur || 0).toFixed(1)}초`)}</div>
            </div>`).join('') || '<div class="muted small">장면이 없습니다.</div>'}
        </div>`).join('')}
    </div>` : ''}`;
}

function tabScript() {
  const styles = allStyles();
  const sel = styles.find((s) => s.key === state.p.styleKey) || styles[0];
  const sum = sel.summary || {};
  const p = state.p;
  const item = (s, n) => `
    <div class="list-item ${s.key === p.styleKey ? 'active' : ''}" data-act="pickStyle" data-val="${s.key}">
      <span class="num">${n}</span>${thumb(s)}<span class="t ellipsis">${esc(s.title)}</span>
      ${s.group === 'my' ? `<button class="sq-btn" data-act="removeStyle" data-val="${s.key}">X</button>` : ''}
    </div>`;
  const lens = styles.filter((s) => s.group === 'lens');
  const mine = styles.filter((s) => s.group === 'my');
  const chars = p.lines.join('').length;
  const prov = p.tts.provider;
  if (window.native && state.voices[prov] === undefined) setTimeout(() => loadVoices(prov));
  const voices = state.voices[prov];
  const classicOnly = prov === 'openai' && (p.tts.model === 'tts-1' || p.tts.model === 'tts-1-hd');
  const voiceList = Array.isArray(voices) ? voices.filter((v) => !classicOnly || v.classic) : [];
  const voiceOptions = voiceList.map((v) => `<option value="${esc(v.id)}" ${p.tts.voice === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('');

  return `
    <div class="two-col">
      <div>
        <div class="row" style="margin-bottom:12px">
          <h3 style="width:50px">스타일</h3>
          <input class="grow" id="style-link" placeholder="🔗 스타일을 참조할 쇼츠 링크를 입력하세요" data-enter="analyzeStyleEnter" />
          <button class="btn blue" data-act="analyzeStyle">✨ 스타일 분석</button>
        </div>
        <div class="panel" style="margin-bottom:14px">
          <div class="panel-title">벤치 스타일 (${styles.length}개)</div>
          <div class="style-list">
            <div class="group-label">렌즈 스타일 (${lens.length}개)</div>
            ${lens.map((s, i) => item(s, i + 1)).join('')}
            <div class="group-label" style="margin-top:12px">내 스타일 (${mine.length}개)</div>
            ${mine.length ? mine.map((s, i) => item(s, lens.length + i + 1)).join('') : '<div class="muted small">쇼츠 링크로 스타일을 분석하면 여기에 쌓입니다.</div>'}
          </div>
        </div>
        <div class="panel">
          <div class="panel-title">스타일 분석 요약</div>
          <div class="summary-grid">
            <span>영상 길이</span><span>${esc(sum.length)}</span><span>말투</span><span title="${esc(sum.tone)}">${esc(sum.tone)}</span>
            <span>첫 훅</span><span title="${esc(sum.hook)}">${esc(sum.hook)}</span><span>제품 노출</span><span title="${esc(sum.expose)}">${esc(sum.expose)}</span>
            <span>속도</span><span title="${esc(sum.speed)}">${esc(sum.speed)}</span><span>행동 유도</span><span title="${esc(sum.cta)}">${esc(sum.cta)}</span>
            <span>장면 흐름</span><span title="${esc(sum.flow)}">${esc(sum.flow)}</span><span>작성 지침</span><span title="${esc(sum.guide)}">${esc(sum.guide)}</span>
          </div>
        </div>
      </div>
      <div>
        <div class="row" style="margin-bottom:12px">
          <h3>대본 생성${chars ? ` (${chars}자)` : ''}</h3>
          <div class="grow"></div>
          <span class="small">길이</span>
          <select data-model="length" data-num>${[25, 30, 35, 40].map((n) => `<option value="${n}" ${(+p.length === n || (![25, 30, 35, 40].includes(+p.length) && n === 30)) ? 'selected' : ''}>${n}초</option>`).join('')}</select>
          <button class="btn green" data-act="genScript">🪄 대본생성</button>
          <button class="btn blue" data-act="genVoice" ${p.lines.length ? '' : 'disabled'}>🔊 음성생성</button>
          <button class="btn purple" data-act="folder" data-val="audio">📁 폴더열기</button>
        </div>
        <div class="panel">
          <div class="field-label">제품 정보 (대본에 들어갈 내용)</div>
          <input style="width:100%;margin-bottom:10px" placeholder="예: Divoom Ditoo-Pro 픽셀 아트 블루투스 스피커" value="${esc(p.product?.name || '')}" data-model="product.name" />
          <div class="field-label">대본 사전지시</div>
          <input style="width:100%;margin-bottom:10px" placeholder="예: 첫 문장은 더 강하게, 전체 문장은 짧게, 제품명은 자연스럽게" value="${esc(p.instruction)}" data-model="instruction" />
          <div class="script-box">
            ${(p.lines.length ? p.lines : ['']).map((l, i) => `
              <div class="script-line">
                <span class="n">${i + 1}</span><span class="spk">N</span>
                <input value="${esc(l)}" data-line="${i}" placeholder="대본생성을 누르거나 직접 입력하세요" />
                <button class="sq-btn" data-act="removeLine" data-i="${i}" title="삭제">✕</button>
                <button class="sq-btn" data-act="playLine" data-i="${i}" title="듣기">▶</button>
              </div>`).join('')}
            <button class="btn sm ghost" data-act="addLine" style="margin-top:4px">＋ 문장 추가</button>
          </div>
          <div class="tabs" style="margin-top:14px">
            ${[['gemini', 'Gemini'], ['typecast', 'Typecast'], ['sapi', 'Windows 기본 음성 (무료)'], ['openai', 'OpenAI (별도 과금)'], ['eleven', 'ElevenLabs (별도 과금)']].map(([id, l]) => `<button class="tab ${prov === id ? 'active' : ''}" data-act="ttsTab" data-val="${id}">${l}</button>`).join('')}
            <div class="grow"></div>
            ${prov === 'eleven' && state.credits ? `<span class="credit">크레딧: ${fmt(state.credits.limit - state.credits.used)} / ${fmt(state.credits.limit)}</span>` : ''}
          </div>
          ${prov === 'gemini' ? '<div class="muted small" style="margin-bottom:8px">설정에 넣은 Gemini 키로 음성을 만듭니다. 분석·대본과 같은 키이고, 원클릭 기본입니다.</div>' : ''}
          ${prov === 'typecast' ? '<div class="muted small" style="margin-bottom:8px">설정에 넣은 Typecast 크레딧으로 한국어 음성을 만듭니다. 선택입니다.</div>' : ''}
          ${voices?.error ? `<div class="notice">${esc(voices.error)}</div>` : ''}
          <table class="tts-table">
            <tr><th>화자</th><th>목소리</th>${prov === 'eleven' || prov === 'openai' || prov === 'gemini' ? '<th>모델</th>' : prov === 'typecast' ? '<th>감정</th>' : ''}<th>읽는속도</th><th>듣기</th></tr>
            <tr>
              <td><span class="spk">N</span></td>
              <td><select data-model="tts.voice" style="max-width:240px"><option value="">${voices === undefined || voices === 'loading' ? '불러오는 중...' : prov === 'typecast' ? '자동 (한국어)' : prov === 'sapi' ? '자동 (한국어 음성)' : prov === 'gemini' ? 'Kore (추천)' : prov === 'openai' ? 'Marin (추천)' : '목소리 선택'}</option>${voiceOptions}</select></td>
              ${prov === 'gemini' ? `<td><select data-model="tts.model"><option value="gemini-3.8-flash-lite-tts" ${p.tts.model !== 'gemini-3.8-flash-tts' ? 'selected' : ''}>Flash-Lite TTS</option><option value="gemini-3.8-flash-tts" ${p.tts.model === 'gemini-3.8-flash-tts' ? 'selected' : ''}>Flash TTS</option></select></td>` : ''}
              ${prov === 'openai' ? `<td><select data-model="tts.model"><option value="gpt-4o-mini-tts" ${p.tts.model !== 'tts-1' && p.tts.model !== 'tts-1-hd' ? 'selected' : ''}>GPT-4o mini TTS</option><option value="tts-1" ${p.tts.model === 'tts-1' ? 'selected' : ''}>TTS-1 (저렴)</option><option value="tts-1-hd" ${p.tts.model === 'tts-1-hd' ? 'selected' : ''}>TTS-1 HD</option></select></td>` : ''}
              ${prov === 'eleven' ? `<td><select data-model="tts.model"><option value="eleven_multilingual_v2" ${p.tts.model === 'eleven_multilingual_v2' ? 'selected' : ''}>다국어 v2</option><option value="eleven_turbo_v2_5" ${p.tts.model === 'eleven_turbo_v2_5' ? 'selected' : ''}>Turbo v2.5</option><option value="eleven_flash_v2_5" ${p.tts.model === 'eleven_flash_v2_5' ? 'selected' : ''}>Flash v2.5</option></select></td>` : ''}
              ${prov === 'typecast' ? `<td><select data-model="tts.emotion">${['normal', 'happy', 'sad', 'angry', 'tonedown', 'toneup'].map((e) => `<option ${p.tts.emotion === e ? 'selected' : ''}>${e}</option>`).join('')}</select></td>` : ''}
              <td><select data-model="tts.speed">${PRESETS.speeds.map(([v, l]) => `<option value="${v}" ${p.tts.speed === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
              <td><button class="sq-btn" data-act="playAllLines" title="전체 듣기">🔊</button></td>
            </tr>
          </table>
          <div class="row" style="margin-top:12px">
            <span class="muted small grow wrap-text" style="text-align:center">${p.ttsReady ? `음성 ${p.audio.length}개 생성 완료 · 총 ${lineDurations().reduce((a, b) => a + b, 0).toFixed(1)}초` : '음성생성을 누르면 문장마다 음성 파일이 만들어집니다.'}</span>
            <button class="btn" data-act="playAllLines">▶ 전체 듣기</button>
          </div>
        </div>
      </div>
    </div>`;
}

function tabScenes() {
  const p = state.p;
  const scenes = p.scenes;
  return `
    <div class="row" style="margin-bottom:12px">
      <span class="muted">${scenes.length}개 장면</span>
      <div class="grow"></div>
      <button class="btn blue" data-act="matchScenes" ${p.lines.length && p.analyzed ? '' : 'disabled'}>🧩 장면 매칭</button>
      <button class="btn" data-act="previewScenes" ${scenes.length ? '' : 'disabled'}>▶ 미리 보기</button>
      <button class="btn" data-act="resetScenes">↺ 초기화</button>
    </div>
    ${scenes.length ? `<div class="scene-strip">
      ${scenes.map((s, i) => { const sc = p.videos[s.src]?.scenes?.[s.clip]; return `
        <div class="scene-card ${state.selectedScene === i ? 'active' : ''}" data-act="pickScene" data-i="${i}">
          <div style="position:relative">${thumb({ img: fileUrl(sceneThumb(s)), hue: 20 + s.src * 70 }, '', `<span class="src">소스 ${s.src + 1}-${s.clip + 1}</span><span class="badge">${(s.dur || 0).toFixed(1)}초</span>`)}</div>
          <div><div class="txt">${i + 1}) ${esc(s.text)}</div><div class="desc">${esc(sc?.label || '')}</div></div>
        </div>`; }).join('')}
    </div>` : `<div class="panel empty" style="margin-bottom:14px">${!p.lines.length ? '먼저 대본 탭에서 대본을 만드세요.' : !p.analyzed ? '먼저 영상 준비 탭에서 소스 영상 분석을 하세요.' : '장면 매칭을 눌러 대본 문장마다 장면을 자동 배치하세요.'}</div>`}
    <div class="muted small" style="margin-bottom:10px">장면 카드를 선택한 뒤 아래 클립을 클릭하면 해당 장면이 교체됩니다.</div>
    ${p.analyzed ? `<div class="src-grid">
      ${p.videos.map((v, si) => `
        <div class="panel">
          <div class="panel-title">소스 ${si + 1}<span class="muted small ellipsis" style="max-width:180px">${esc(v.title)}</span><div class="grow"></div><span class="muted small">${v.scenes?.length || 0}개 장면</span><button class="btn sm" data-act="playVideo" data-i="${si}">전체 재생</button></div>
          <div class="clip-row">
            ${(v.scenes || []).map((c, ci) => { const used = scenes.some((s) => s.src === si && s.clip === ci); return `
              <div class="clip ${used ? 'used' : ''}" data-act="assignClip" data-src="${si}" data-clip="${ci}" title="${esc(c.label)}">
                ${thumb({ img: fileUrl(c.thumb), hue: 20 + si * 70 }, '', `<span class="no">${ci + 1}</span><span class="badge">${c.dur.toFixed(1)}초</span>`)}
                <div class="l">${esc(c.label)}</div>
              </div>`; }).join('')}
          </div>
        </div>`).join('')}
    </div>` : ''}`;
}

function tabSubtitles() {
  const p = state.p;
  return `
    <div class="row" style="margin-bottom:12px">
      <span class="muted">${p.subtitles.length}개 자막</span>
      <div class="grow"></div>
      <span class="small">줄당 최대 글자</span>
      <select data-model="subMaxChars" data-num>${[8, 10, 12, 16, 20].map((n) => `<option value="${n}" ${p.subMaxChars === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn blue" data-act="splitSubs" ${p.lines.length ? '' : 'disabled'}>✂ 자막 자동 분할</button>
      <button class="btn" data-act="fixSubs" ${p.subtitles.length ? '' : 'disabled'}>🔤 맞춤법·띄어쓰기 정리</button>
      <button class="btn" data-act="exportSrt" ${p.subtitles.length ? '' : 'disabled'}>⬇ SRT 저장</button>
    </div>
    ${p.lines.length && !p.ttsReady ? '<div class="notice">아직 음성이 없어 글자 수로 시간을 추정합니다. 음성을 만든 뒤 다시 분할하면 정확해집니다.</div>' : ''}
    <div class="panel">
      ${p.subtitles.length ? `<table class="tts-table">
        <tr><th style="width:40px">#</th><th style="width:110px">시작</th><th style="width:110px">끝</th><th>자막</th><th style="width:60px">문장</th></tr>
        ${p.subtitles.map((s, i) => `<tr>
          <td class="muted">${i + 1}</td><td>${sec2(s.start)}</td><td>${sec2(s.end)}</td>
          <td><input style="width:100%" value="${esc(s.text)}" data-sub="${i}" /></td><td class="muted">${s.line + 1}</td>
        </tr>`).join('')}
      </table>` : `<div class="empty">${p.lines.length ? '자막 자동 분할을 눌러 대본을 자막 단위로 나누세요.' : '먼저 대본 탭에서 대본을 만드세요.'}</div>`}
    </div>`;
}

function currentSub() {
  return state.p.subtitles.find((s) => state.time >= s.start && state.time < s.end);
}

function activeLayers() {
  const e = state.p.edit;
  if (state.rightPanel === 'thumb') return e.thumbItems || (e.thumbItems = []);
  return e.overlays || (e.overlays = []);
}

function selectedLayer() {
  return (activeLayers() || []).find((o) => o.id === state.selectedOverlay);
}

function layerHtml(list) {
  return (list || []).map((o) => {
    const on = state.selectedOverlay === o.id ? 'on' : '';
    if (o.kind === 'image') return `<img class="ov-img ${on}" data-overlay="${o.id}" src="${fileUrl(o.file)}" style="left:${o.x}%;top:${o.y}%;width:${o.w || 30}%" />`;
    if (o.kind === 'shape') return `<div class="ov-shape ${o.shape || 'circle'} ${on}" data-overlay="${o.id}" style="left:${o.x}%;top:${o.y}%;width:${o.w || 18}%;background:${o.color || '#fff'}"></div>`;
    const px = Math.max(11, Math.round((o.size || 72) * 270 / 1080));
    return `<div class="ov-text ${on}" data-overlay="${o.id}" style="left:${o.x}%;top:${o.y}%;font-size:${px}px;color:${o.color || '#fff'};opacity:${(o.opacity ?? 100) / 100};font-weight:${o.bold ? 800 : 500};font-style:${o.italic ? 'italic' : 'normal'};${o.outline ? '-webkit-text-stroke:1px #000;' : ''}${o.shadow ? 'text-shadow:0 2px 4px #000;' : ''}">${esc(o.text || '문구')}</div>`;
  }).join('');
}

function boxCss(box, edge) {
  if (!box?.on) return '';
  const alpha = Math.round(((box.opacity ?? 80) / 100) * 255).toString(16).padStart(2, '0');
  return `<div class="pv-box ${edge}" style="height:${box.height || 18}%;background:${box.color || '#000'}${alpha}"></div>`;
}

function layerRows(list) {
  return (list || []).map((o) => `<div class="list-item ${state.selectedOverlay === o.id ? 'active' : ''}" data-act="pickLayer" data-val="${o.id}"><span class="t ellipsis">${o.kind === 'text' ? esc(o.text) : o.kind === 'image' ? '이미지' : { circle: '도형', line: '선', arrow: '화살표' }[o.shape] || '도형'}</span><button class="sq-btn" data-act="removeLayer" data-val="${o.id}">X</button></div>`).join('')
    || '<div class="muted small">화면을 더블클릭하면 그 자리에 글씨가 생깁니다.</div>';
}

function textControls(o) {
  if (!o || o.kind !== 'text') return '';
  return `
    <input style="width:100%;margin-top:8px" data-ov="text" data-overlay-text value="${esc(o.text)}" />
    <div class="row" style="margin-top:6px">
      <input style="width:72px" type="number" data-ov="size" data-num value="${o.size || 72}" />
      <button class="tb ${o.bold ? 'active' : ''}" data-act="ovToggle" data-val="bold">B</button>
      <button class="tb ${o.italic ? 'active' : ''}" data-act="ovToggle" data-val="italic">I</button>
      <input type="color" data-ov="color" value="${o.color || '#ffffff'}" />
    </div>
    <div class="row" style="margin-top:6px">
      <label><input type="checkbox" data-act="ovToggle" data-val="outline" ${o.outline ? 'checked' : ''} /> 외곽선</label>
      <label><input type="checkbox" data-act="ovToggle" data-val="shadow" ${o.shadow ? 'checked' : ''} /> 그림자</label>
    </div>
    <div class="row"><span class="small">투명도</span><input class="grow" type="range" min="15" max="100" data-ov="opacity" data-num value="${o.opacity ?? 100}" /><span class="small">${o.opacity ?? 100}%</span></div>`;
}

function boxEditor(box, key, title) {
  const b = box || {};
  return `
    <div class="row" style="margin-top:14px"><label class="row"><input type="checkbox" data-act="boxToggle" data-val="${key}" ${b.on ? 'checked' : ''} /> ${title}</label><div class="grow"></div><button class="btn sm" data-act="boxReset" data-val="${key}">초기화</button></div>
    <div class="row"><span class="small">색상</span><input type="color" data-box="${key}" data-bf="color" value="${b.color || '#000000'}" /></div>
    <div class="row"><span class="small">높이 ${b.height || 18}%</span><input class="grow" type="range" min="8" max="45" data-box="${key}" data-bf="height" data-num value="${b.height || 18}" /></div>
    <div class="row"><span class="small">투명 ${b.opacity ?? 80}%</span><input class="grow" type="range" min="10" max="100" data-box="${key}" data-bf="opacity" data-num value="${b.opacity ?? 80}" /></div>
    ${key === 'topBox' ? `<div class="row"><span class="small">줌 ${b.zoom ?? 50}%</span><input class="grow" type="range" min="20" max="100" data-box="${key}" data-bf="zoom" data-num value="${b.zoom ?? 50}" /></div>` : ''}`;
}

function tabEdit() {
  ensureTimeline();
  const p = state.p;
  const e = p.edit;
  ensureHeadStat(e);
  const subs = p.subtitles;
  const tpl = PRESETS.templates[e.template] || PRESETS.templates[0];
  const cur = currentSub();
  const dur = totalDuration();
  const sc = sceneAt(state.time);
  const thumbSc = sceneAt(e.thumbTime || 0) || sc;
  const scale = 270 / 1080;
  const grade = { sharp: 'contrast(1.12) saturate(1.2)', warm: 'sepia(0.3) saturate(1.3)', cool: 'hue-rotate(16deg) saturate(0.85)', vintage: 'sepia(0.55) contrast(0.95)', mono: 'grayscale(1)' }[e.filter] || '';
  const fx = e.effect && e.effect !== 'none' ? (e.effect === 'auto' ? 'zoom' : e.effect) : '';
  const subY = Number.isFinite(Number(e.subY)) ? Number(e.subY) : subYFromBand(captionBandOf(p));
  const subStyle = `font-family:'${esc(e.font)}';font-size:${Math.round(e.size * scale * 1.1)}px;font-weight:800;color:#fff;top:${((subY / 1920) * 100).toFixed(2)}%;bottom:auto;transform:translateY(-50%);${e.italic ? 'font-style:italic;' : ''}${(e.border || e.bg) ? '-webkit-text-stroke:1.6px #000;paint-order:stroke fill;text-shadow:none;' : 'text-shadow:none;-webkit-text-stroke:0;'}`;

  const right = {
    text: `
      <div class="panel-title">✍️ 텍스트 에디터 (#${subs.length})<div class="grow"></div>
        <span class="small">음성</span><button class="switch ${e.voice ? 'on' : ''}" data-act="toggleEdit" data-val="voice"></button>
        <span class="small">자막</span><button class="switch ${e.sub ? 'on' : ''}" data-act="toggleEdit" data-val="sub"></button>
      </div>
      <div class="seg-list">
        ${subs.length ? subs.map((s, i) => `
          <div class="seg ${cur === s ? 'active' : ''}" data-act="seek" data-t="${s.start}">
            <div class="grow"><div class="meta"><b>#${i + 1}</b>${sec2(s.start)} ~ ${sec2(s.end)}</div><input value="${esc(s.text)}" data-sub="${i}" /></div>
            ${thumb({ img: p.scenes[s.line] ? fileUrl(sceneThumb(p.scenes[s.line])) : '', hue: 20 + (i % 6) * 40, emoji: '' }, 'mini')}
          </div>`).join('') : '<div class="empty">편집준비를 누르면 자막이 생깁니다.</div>'}
      </div>`,
    template: `
      <div class="panel-title">템플릿 편집</div>
      <div class="group-label">유행 템플릿</div>
      <div class="muted small" style="margin:-4px 0 8px">쇼츠에서 많이 쓰는 화면입니다. 고르면 미리보기와 내보내기에 같이 들어갑니다.</div>
      <div class="tpl-grid" style="margin-bottom:14px">${PRESETS.templates.map((t, i) => `
        <div class="tpl ${e.template === i ? 'active' : ''}" data-act="pickTpl" data-i="${i}">
          <div class="pv look-${t.look}" style="background:${t.bg}"><span class="shot"></span></div>
          <b>${t.name}</b>${t.chip ? `<em class="hot">${t.chip}</em>` : ''}
        </div>`).join('')}</div>
      <label class="row" style="margin-bottom:10px"><input type="checkbox" ${e.showTemplateImage ? 'checked' : ''} data-act="toggleEdit" data-val="showTemplateImage" /> 템플릿 이미지</label>
      <div class="row" style="margin-bottom:14px;gap:6px">
        <button class="btn sm grow" data-act="tplPickImage">템플릿 선택하기</button>
        <button class="btn sm grow" data-act="tplImport">템플릿 불러오기</button>
        <button class="btn blue sm grow" data-act="tplSave">템플릿 저장하기</button>
      </div>
      ${e.templateImage ? `<div class="muted small ellipsis" style="margin:-8px 0 12px">이미지: ${esc(e.templateImage.split(/[\\/]/).pop())}</div>` : ''}
      <div class="group-label">텍스트 요소</div>
      <div class="row" style="margin-bottom:8px">
        <button class="btn sm" data-act="addLayer" data-val="text">텍스트 추가하기</button>
        <button class="btn sm" data-act="addLayer" data-val="image">이미지 추가하기</button>
      </div>
      ${layerRows(e.overlays)}
      ${textControls(selectedLayer() && state.rightPanel !== 'thumb' ? selectedLayer() : e.overlays.find((o) => o.id === state.selectedOverlay))}
      <div class="row wrap" style="margin-top:8px">
        <button class="btn sm" data-act="addLayer" data-val="circle">도형</button>
        <button class="btn sm" data-act="addLayer" data-val="line">선</button>
        <button class="btn sm" data-act="addLayer" data-val="arrow">화살표</button>
        <button class="btn sm" data-act="openIntro">AI 시작 장면</button>
      </div>
      ${boxEditor(e.topBox, 'topBox', '상단 박스')}
      ${boxEditor(e.bottomBox, 'bottomBox', '하단 박스')}
      <div class="field-label" style="margin-top:14px">채널명 (윗줄)</div><input style="width:100%;margin-bottom:8px" value="${esc(e.headTop)}" data-model="edit.headTop" data-live />
      <div class="field-label">헤드라인 (아랫줄)</div><input style="width:100%;margin-bottom:8px" value="${esc(e.headTitle)}" data-model="edit.headTitle" data-live />
      <div class="field-label">조회수 · 댓글</div><input style="width:100%;margin-bottom:12px" value="${esc(e.headStat || '')}" data-model="edit.headStat" data-live placeholder="조회수 200~500만 | 댓글 300~900개" />
      <div class="row" style="margin-bottom:10px"><span class="small">상단 제목</span><button class="switch ${e.header ? 'on' : ''}" data-act="toggleEdit" data-val="header"></button></div>
      ${state.userTemplates.length ? `<div class="group-label">사용자 저장</div><div class="tpl-grid" style="margin-bottom:12px">${state.userTemplates.map((u, i) => `
        <div class="tpl ${e.template === u.template && e.headTitle === u.headTitle ? 'active' : ''}" data-act="tplLoad" data-i="${i}">
          <div class="pv" style="background:${u.thumb ? `url('${fileUrl(u.thumb)}') center/cover` : (PRESETS.templates[u.template]?.bg || '#111')}"><i style="background:${PRESETS.templates[u.template]?.color || '#fff'}"></i></div>${esc(u.name || `저장 ${i + 1}`)}
        </div>`).join('')}</div>` : ''}`,
    filter: `<div class="panel-title">🌈 필터</div>${PRESETS.filters.map(([id, l]) => `<div class="list-item ${e.filter === id ? 'active' : ''}" data-act="setEdit" data-key="filter" data-val="${id}"><span class="t">${l}</span></div>`).join('')}
      <div class="panel-title" style="margin-top:14px">🎬 영상 효과</div>${PRESETS.effects.map(([id, l]) => `<div class="list-item ${e.effect === id ? 'active' : ''}" data-act="setEdit" data-key="effect" data-val="${id}"><span class="t">${l}</span></div>`).join('')}`,
    sfx: `<div class="panel-title">✨ 효과음</div>
      <div class="muted small wrap-text" style="margin-bottom:10px">재생 위치를 원하는 곳에 두고 효과음 파일을 추가하세요. 현재 위치: ${sec2(state.time)}</div>
      <button class="btn blue" data-act="addSfx">＋ 현재 위치에 효과음 추가</button>
      <button class="btn purple" style="margin-left:6px" data-act="openSfx">AI 효과음</button>
      <div style="margin-top:12px">${e.sfx.map((s, i) => `<div class="list-item"><span class="t ellipsis">${sec2(s.time)} · ${esc(s.file.split(/[\\/]/).pop())}</span><button class="sq-btn" data-act="removeSfx" data-i="${i}">X</button></div>`).join('') || '<div class="muted small">추가된 효과음이 없습니다.</div>'}</div>`,
    bgm: `<div class="panel-title">🎶 배경음</div>
      ${e.bgm ? `<div class="list-item active"><span class="t ellipsis">${esc(e.bgm.file.split(/[\\/]/).pop())}</span><button class="sq-btn" data-act="removeBgm">X</button></div>
        <div class="row" style="margin-top:8px"><span class="small">볼륨</span><select data-model="edit.bgm.volume" data-num>${[[0.06, '작게'], [0.12, '보통'], [0.22, '크게']].map(([v, l]) => `<option value="${v}" ${e.bgm.volume === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : '<div class="muted small" style="margin-bottom:10px">배경음 파일(mp3 등)을 고르면 영상 길이에 맞춰 반복 재생됩니다.</div>'}
      <button class="btn blue" style="margin-top:10px" data-act="pickBgm">${e.bgm ? '다른 파일 선택' : '배경음 파일 선택'}</button>`,
    thumb: `
      <div class="panel-title">썸네일 만들기</div>
      <div class="muted small">장면 막대를 옮기고, 미리보기를 더블클릭하면 글씨를 바로 씁니다.</div>
      <div class="thumb-stage ${e.thumbFlip ? 'flip' : ''}" style="background-image:url('${fileUrl(p.thumbnail || (thumbSc ? sceneThumb(thumbSc) : ''))}')">
        ${layerHtml(e.thumbItems)}
      </div>
      <div class="row" style="margin-top:8px"><span class="small">위치 ${sec2(e.thumbTime || 0)}</span><input class="grow" type="range" min="0" max="${Math.max(dur, 1)}" step="0.1" value="${e.thumbTime || 0}" data-model="edit.thumbTime" data-num /></div>
      <div class="row" style="margin:8px 0">
        <button class="btn sm" data-act="thumbSuggest">AI 추천 장면</button>
        <button class="btn sm" data-act="toggleEdit" data-val="thumbFlip">${e.thumbFlip ? '좌우 원본' : '좌우반전'}</button>
      </div>
      <div class="scene-film">${p.scenes.slice(0, 10).map((s, i) => `<div class="film" data-act="thumbScene" data-i="${i}" style="background-image:url('${fileUrl(sceneThumb(s))}')"></div>`).join('')}</div>
      <div class="group-label">꾸미기</div>
      <div class="row wrap">
        <button class="btn sm" data-act="addLayer" data-val="text">T 글자</button>
        <button class="btn sm" data-act="addLayer" data-val="circle">도형</button>
        <button class="btn sm" data-act="addLayer" data-val="line">선</button>
        <button class="btn sm" data-act="addLayer" data-val="arrow">화살표</button>
        <button class="btn sm" data-act="toggleStickers">스티커</button>
        <button class="btn sm" data-act="addLayer" data-val="image">이미지</button>
        <button class="btn sm" data-act="addBg">배경</button>
      </div>
      ${state.stickerOpen ? `<div class="row wrap" style="margin-top:6px">${['🔥', '⭐', '💰', '😱', '👍', '❤️', '✨', '🎁'].map((s) => `<button class="btn sm" data-act="addSticker" data-val="${s}">${s}</button>`).join('')}</div>` : ''}
      ${layerRows(e.thumbItems)}
      ${textControls(state.rightPanel === 'thumb' ? selectedLayer() : null)}
      <label class="row" style="margin-top:8px"><input type="checkbox" data-act="toggleEdit" data-val="thumbLead" ${e.thumbLead ? 'checked' : ''} /> 내보내면 영상 맨 앞 5프레임에 넣기</label>
      <div class="row" style="margin-top:8px"><button class="btn blue" data-act="finishThumb">썸네일 완성</button><button class="btn sm" data-act="clearThumbDecor">전체 초기화</button></div>
      ${p.thumbnail ? `<img src="${fileUrl(p.thumbnail)}" style="width:100%;margin-top:10px;border-radius:10px" />` : ''}`,
  }[state.rightPanel];

  return `
    <div class="editor">
      <div>
        <div class="row" style="margin-bottom:10px">
          <h3>🎨 비디오 캔버스</h3><div class="grow"></div>
          ${p.exported ? `<button class="btn" data-act="playExported">▶ 완성 영상 보기</button><button class="btn" data-act="showItem" data-val="${esc(p.exported)}">📁</button>` : ''}
          <button class="btn blue" data-act="prepModal">⚡ 편집준비</button>
          <div class="export-wrap">
            <button class="btn red" data-act="toggleExport" ${p.videos.some((v) => v.file) || p.scenes.length ? '' : 'disabled'}>📤 내보내기</button>
            ${state.exportOpen ? `<div class="export-menu">
              <button data-act="export">전체 영상 내보내기 (MP4)</button>
              <button data-act="exportSrt">SRT 자막 내보내기</button>
              <button data-act="exportCapcut">캡컷 프로젝트 내보내기</button>
            </div>` : ''}
          </div>
        </div>
        <div class="toolbar">
          <button class="tb ${e.italic ? 'active' : ''}" style="font-style:italic" data-act="toggleEdit" data-val="italic">I</button>
          <select data-model="edit.font">${PRESETS.fonts.map((f) => `<option ${e.font === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
          <input style="width:66px" type="number" value="${e.size}" data-model="edit.size" data-num data-live />
          <label><input type="checkbox" ${e.bg ? 'checked' : ''} data-act="toggleEdit" data-val="bg" />배경</label>
          <label><input type="checkbox" ${e.border ? 'checked' : ''} data-act="toggleEdit" data-val="border" />테두리</label>
          <label><input type="checkbox" ${e.shadow ? 'checked' : ''} data-act="toggleEdit" data-val="shadow" />그림자</label>
          <span class="small">자막</span>
          <button class="pill ${e.subMode === 'short' ? 'active' : ''}" data-act="subMode" data-val="short">짧게</button>
          <button class="pill ${e.subMode === 'normal' ? 'active' : ''}" data-act="subMode" data-val="normal">보통</button>
          <div class="divider"></div>
          <div style="width:100%;display:flex;justify-content:center;gap:6px">
            ${[['text', '✍️ 자막'], ['filter', '🌈 필터·효과'], ['sfx', '✨ 효과음'], ['bgm', '🎶 배경음'], ['template', '🎨 템플릿'], ['thumb', '🖼 썸네일']].map(([id, l]) => `<button class="tb ${state.rightPanel === id ? 'active' : ''}" data-act="rightPanel" data-val="${id}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="preview-wrap">
          <div class="preview ${tpl.frame === 'phone' ? 'phone' : 'bar'} look-${tpl.look || 'plain'}${fx ? ` fx-${fx}` : ''}" style="${tpl.bg ? `background:${tpl.bg}` : ''}">
            <div class="thumb has-img" id="pv-img" style="${sc ? `background-image:url('${fileUrl(sceneThumb(sc))}')` : ''};${tpl.frame === 'phone' ? `background-color:${tpl.bg}` : ''}">
              <video id="pv-video" playsinline ${p.prepared?.voiceFile ? 'muted' : ''} style="${grade ? `filter:${grade}` : ''}"></video>
            </div>
            <div class="frame-deco"></div>
            ${tpl.look === 'reel' && e.header ? `<div class="reel-chrome"><div class="reel-bar"><span>≡</span><b>${esc((e.headTop || '꿀템나라').replace(/\s+/g, ''))}</b><span>⌕</span></div><div class="reel-title">${esc(e.headTitle || '일본 천재가 개발해 떼돈 번 제품')}</div><div class="reel-stat">${esc(e.headStat)}</div></div>` : ''}
            ${tpl.frame === 'phone' ? `<div class="phone-bar" style="background:${tpl.bar || tpl.color};color:${tpl.look === 'phone' && tpl.bar === '#1c1f27' ? '#7DF9FD' : '#1d1b18'}"><span>☰</span><b>${esc(e.headTop)}</b><span>⌕</span></div>` : ''}
            ${e.header && (e.headTop || e.headTitle) && tpl.frame !== 'phone' && tpl.look !== 'reel' ? `<div class="tpl-head"><div class="k">${esc(e.headTop)}</div><div class="t" style="color:${tpl.color}">${esc(e.headTitle)}</div></div>` : ''}
            ${e.header && e.headTitle && tpl.frame === 'phone' ? `<div class="phone-title">${esc(e.headTitle)}</div>` : ''}
            ${boxCss(e.topBox, 'top')}
            ${boxCss(e.bottomBox, 'bottom')}
            ${layerHtml(e.overlays)}
            ${e.showTemplateImage && e.templateImage ? `<img class="tpl-overlay" src="${fileUrl(e.templateImage)}" />` : ''}
            <div class="ad-mark">[광고]</div>
            <div class="sub" id="pv-sub" style="${subStyle}">${e.sub && cur ? esc(cur.text) : ''}</div>
          </div>
        </div>
        <div class="player">
          <button class="btn icon" data-act="play">${state.playing ? '⏸' : '▶'}</button>
          <span class="time" id="pv-time">${sec2(state.time)}</span><span class="muted">/ ${sec2(dur)}</span>
          <input type="range" id="pv-bar" min="0" max="${dur}" step="0.01" value="${state.time}" />
          <span class="small muted">${p.prepared?.voiceFile ? '내레이션 미리보기' : p.videos.some((v) => v.cleaned) ? '원본 음성·자막을 뺀 영상' : p.videos.some((v) => v.file) ? '원본 영상 미리보기' : '받을 영상이 없습니다'}</span>
        </div>
      </div>
      <div class="panel" style="align-self:start">${right}</div>
    </div>`;
}

function prepModal() {
  const e = state.p.edit;
  return `
    <div class="modal prep-modal">
      <h3 style="margin-bottom:4px">⚡ 편집 준비 설정</h3>
      <div class="muted small">음성을 다듬고 자막·장면 길이를 음성에 맞춥니다.</div>
      <div class="prep-row"><span>🎞 트랜지션 (장면 사이 페이드)</span><button class="switch ${e.transition ? 'on' : ''}" data-act="toggleEdit" data-val="transition"></button></div>
      <div class="prep-row"><span>🔈 영상 원본소리 보존</span><button class="switch ${e.prep.keepAudio ? 'on' : ''}" data-act="togglePrep" data-val="keepAudio"></button></div>
      <div class="prep-row"><span>🔇 무음 삭제</span><select data-model="edit.prep.silence">
        ${[['none', '적용 안함'], ['light', '약하게 (0.5초 이상)'], ['normal', '보통 (0.3초 이상)'], ['strong', '강하게 (0.15초 이상)']].map(([v, l]) => `<option value="${v}" ${e.prep.silence === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
      <div class="prep-row"><span>🎬 영상 효과</span><select data-model="edit.effect">
        ${PRESETS.effects.map(([v, l]) => `<option value="${v}" ${e.effect === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
      <div class="row" style="margin-top:18px"><button class="btn" data-act="closeModal">취소</button><button class="btn blue grow" data-act="startPrep">⚡ 편집 준비 시작</button></div>
    </div>`;
}

function tabCoupang() {
  const p = state.p;
  const kws = [...new Set([...(p.product?.kw?.ko || []), p.product?.name, p.name].filter(Boolean))];
  const imgs = p.scenes.slice(0, 4).map((s) => sceneThumb(s)).filter(Boolean);
  return `
    <div class="panel" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:12px">
        <h3>🛒 쿠팡 제품 찾기</h3><span class="muted small">${state.aiStatus.coupang ? '쿠팡 파트너스 API 연결됨' : '파트너스 키 없음 · 쿠팡 검색 결과에서 상품을 가져옵니다'}</span><div class="grow"></div>
        <button class="btn" data-act="openUrl" data-val="${INPOCK_ADMIN}">인포크 관리</button>
        <button class="btn green" data-act="copyAll" ${p.coupang.length ? '' : 'disabled'}>링크 전체 복사</button>
        <button class="btn" data-act="folder" data-val="scenes">이미지 폴더</button>
      </div>
      <div class="row" style="align-items:flex-start">
        ${imgs.map((f) => `<div style="width:64px">${thumb({ img: fileUrl(f) }, 'sq')}</div>`).join('')}
        <div class="grow">
          <div class="row" style="margin-bottom:6px">
            <input class="grow" placeholder="키워드 선택 또는 직접 입력" value="${esc(p.cpKeyword)}" data-model="cpKeyword" data-enter="findCoupang" />
            <button class="btn blue" data-act="findCoupang">검색</button>
          </div>
          <div>${kws.map((k) => `<span class="chip ${p.cpKeyword === k ? 'active' : ''}" data-act="cpKeyword" data-val="${esc(k)}">${esc(k)}</span>`).join('')}</div>
          <div class="row" style="margin-top:8px;gap:8px">
            <span class="muted small">검색 키워드</span><b class="ellipsis" title="${esc(koSearchKeyword(p))}">${esc(koSearchKeyword(p) || '없음')}</b>
            <button class="btn sm" data-act="copySearchKo" ${koSearchKeyword(p) ? '' : 'disabled'}>키워드 복사</button>
            <span class="muted small">제목</span><b class="ellipsis grow" title="${esc(productTitleText(p))}">${esc(productTitleText(p) || '없음')}</b>
            <button class="btn sm" data-act="copyProductTitle" ${productTitleText(p) ? '' : 'disabled'}>제목 복사</button>
          </div>
          <div class="row" style="margin-top:10px">
            <input class="grow" placeholder="쿠팡 상품 링크를 붙여넣고 Enter (${state.aiStatus.coupang ? '수익 링크로 자동 변환' : '그대로 저장'})" data-enter="addCoupang" />
          </div>
        </div>
      </div>
    </div>
    <div class="row" style="margin-bottom:12px">
      <h3>쿠팡 후보</h3><span class="muted">${p.coupang.length}개</span><div class="grow"></div>
      <button class="btn sm" data-act="clearCoupang">비우기</button>
    </div>
    ${p.coupang.length ? `<div class="cp-grid">${p.coupang.map((c, i) => `
      <div class="cp-card">
        ${thumb({ img: c.img, emoji: '🛍️', hue: 20 + i * 50 }, 'sq', `<button class="x" data-act="removeCoupang" data-i="${i}">✕</button>`)}
        <div class="t">${esc(c.title)}</div>${c.price ? `<div class="price">${fmt(c.price)}원${c.rocket ? ' · 🚀로켓' : ''}</div>` : ''}${c.partner ? '<div class="muted small">내 파트너스 링크</div>' : ''}<div class="u">${esc(c.url)}</div>
        <div class="row" style="margin-top:8px"><button class="btn sm grow" data-act="openUrl" data-val="${esc(c.url)}">열기</button><button class="btn green sm" data-act="copyLink" data-i="${i}">링크 복사</button><button class="btn sm" data-act="saveCoupangThumb" data-i="${i}" ${c.img ? '' : 'disabled'}>썸네일 저장</button></div>
      </div>`).join('')}</div>` : '<div class="panel muted" style="display:inline-block;padding:14px 20px">아직 수집된 쿠팡 후보가 없습니다.</div>'}`;
}

function tabUpload() {
  const p = state.p;
  const u = p.upload;
  const s = state.settings;
  const plats = [
    ['youtube', '▶ YouTube Shorts', s.ytRefresh ? `연결됨 · ${s.ytChannel || ''}` : '연결 안 됨 (설정에서 연결)'],
    ['instagram', '📷 Instagram Reels', (s.sns || {}).instagram?.name ? `연결됨 · ${(s.sns || {}).instagram.name}` : '연결 안 됨 (원클릭배포에서 연결)'],
    ['tiktok', '🎵 TikTok', s.tiktokToken ? `토큰 입력됨 · ${s.tiktokPrivacy || 'SELF_ONLY'}` : '연결 안 됨 (설정에서 토큰 입력)'],
  ];
  return `
    <div style="display:grid;grid-template-columns:1fr 320px;gap:18px">
      <div class="panel">
        <div class="panel-title">업로드 정보</div>
        ${!p.exported ? '<div class="notice">먼저 최종편집에서 영상을 내보내기 하세요.</div>' : ''}
        <div class="form-grid" style="max-width:none">
          <span>제목</span><input value="${esc(u.title)}" placeholder="${esc(p.name)}" data-model="upload.title" />
          <span>설명</span>
          <div>
            <textarea rows="12" style="width:100%" data-model="upload.desc" placeholder="업로드 문구 생성을 누르면 3가지 스타일로 만들어 줍니다.">${esc(u.desc)}</textarea>
            <div class="row" style="margin-top:6px"><button class="btn purple" data-act="uploadModal" ${p.lines.length ? '' : 'disabled'}>✍️ 업로드 문구 생성</button><span class="muted small">${u.desc.length}/5000</span></div>
          </div>
          <span>예약 발행</span><div class="row"><input type="datetime-local" value="${esc(u.schedule)}" data-model="upload.schedule" /><button class="btn sm" data-act="openCal" data-val="upload">달력</button><span class="muted small wrap-text">유튜브는 예약 공개로 올라가고, 인스타·틱톡은 프로그램이 켜져 있을 때 그 시간에 올라갑니다.</span></div>
        </div>
        <div class="row" style="margin-top:16px;justify-content:flex-end">
          <button class="btn blue" data-act="doUpload" ${p.exported ? '' : 'disabled'}>${u.schedule ? '예약 발행' : '지금 업로드'}</button>
        </div>
        ${(u.results || []).length ? `<div class="panel-title" style="margin-top:16px">업로드 기록</div>${u.results.map((r) => `<div class="list-item"><span class="t wrap-text">${r.ok ? '✅' : r.pending ? '⏰' : '❌'} ${esc(r.platform)} · ${esc(r.text)}</span>${r.url ? `<button class="btn sm" data-act="openUrl" data-val="${esc(r.url)}">열기</button>` : ''}</div>`).join('')}` : ''}
      </div>
      <div>
        <div class="panel" style="margin-bottom:14px">
          <div class="panel-title">업로드 플랫폼</div>
          ${plats.map(([id, n, st]) => `<div class="platform-card" style="margin-bottom:6px"><div class="grow"><b>${n}</b><div class="muted small">${st}</div></div><button class="switch ${u.platforms[id] ? 'on' : ''}" data-act="togglePlat" data-val="${id}"></button></div>`).join('')}
          <button class="btn sm" style="margin-top:6px" data-act="nav" data-val="settings">계정 설정 열기</button>
          <button class="btn red" style="width:100%;margin-top:10px" data-act="toBlast" ${p.exported ? '' : 'disabled'}>🚀 원클릭배포로 보내기 (채널 6곳)</button>
        </div>
        <div class="panel">
          <div class="panel-title">미리보기</div>
          ${p.exported ? `<video src="${fileUrl(p.exported)}" controls style="width:100%;border-radius:12px;background:#000"></video>` : '<div class="muted small">내보낸 영상이 여기에 표시됩니다.</div>'}
        </div>
      </div>
    </div>`;
}

function uploadModal() {
  const t = state.uploadTexts;
  return `
    <div class="modal upload-modal">
      <button class="close" data-act="closeModal">✕</button>
      <h3>✍️ 업로드 문구 선택</h3>
      ${!t || t === 'loading' ? `<div class="empty"><div class="spinner"></div><div id="live-progress">문구 만드는 중...</div></div>` : t.error ? `<div class="notice">${esc(t.error)}</div>` : `
      <div class="row" style="margin:10px 0">${t.fallback ? '<span class="muted small">AI 키가 없어 기본 템플릿으로 만들었습니다.</span>' : `<span class="muted small">추천 제목: ${esc(t.title || '')}</span>`}<div class="grow"></div></div>
      <div class="style-cols">
        ${t.styles.map((s, i) => `
          <div class="style-col ${state.uploadPick === i ? 'active' : ''}" data-act="pickUpload" data-i="${i}">
            <div class="row"><span class="tag-red">스타일 ${i + 1}</span><b>${esc(s.name)}</b>${state.uploadPick === i ? '<span class="muted small">선택됨</span>' : ''}<div class="grow"></div><button class="btn sm" data-act="copyUpload" data-i="${i}">복사</button></div>
            <pre>${esc(s.text)}</pre>
          </div>`).join('')}
      </div>`}
      <div class="row" style="margin-top:14px"><button class="btn blue" data-act="regenUpload">전체 재생성</button><div class="grow"></div><button class="btn blue" data-act="applyUpload" ${t && t.styles ? '' : 'disabled'}>선택한 문구 적용</button><button class="btn" data-act="closeModal">취소</button></div>
    </div>`;
}

function videoModal(file) {
  return `<div class="modal video-modal"><button class="close" data-act="closeModal">✕</button><video src="${fileUrl(file)}" controls autoplay></video></div>`;
}

function slideshowModal() {
  return `<div class="modal video-modal"><button class="close" data-act="closeModal">✕</button>
    <div class="preview" style="width:320px"><div class="thumb has-img" id="ss-img"></div><div class="ad-mark">[광고]</div><div class="sub" id="ss-sub"></div></div></div>`;
}

const INTRO_LINES = [
  ['감동 충격', '예상 못한 한 장면으로 손이 멈춥니다.'],
  ['순간 등장', '제품이 화면 한가운데로 나타납니다.'],
  ['문제 제기', '쓰던 방식이 불편해 손이 멈춥니다.'],
  ['반전 공개', '평범해 보이던 제품이 다르게 움직입니다.'],
  ['비현실 실험', '책상 위 제품이 혼자 작동합니다.'],
  ['기능 발동', '버튼 하나에 핵심 기능이 바로 켜집니다.'],
  ['미니 사건', '손바닥 위 작은 제품이 크게 다가옵니다.'],
];

function calendarModal() {
  const c = state.cal;
  const first = new Date(c.y, c.m, 1);
  const start = first.getDay();
  const days = new Date(c.y, c.m + 1, 0).getDate();
  const cells = [...Array(start).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)];
  const picked = new Date(c.y, c.m, c.day, c.h, c.min);
  return `
    <div class="modal cal-modal">
      <h3>예약 날짜와 시간을 선택하세요</h3>
      <div class="cal-grid">
        <div>
          <div class="row"><button class="btn sm" data-act="calNav" data-val="-1">←</button><b class="grow" style="text-align:center">${c.y}년 ${c.m + 1}월</b><button class="btn sm" data-act="calNav" data-val="1">→</button></div>
          <div class="cal-days">${['일', '월', '화', '수', '목', '금', '토'].map((d) => `<span>${d}</span>`).join('')}${cells.map((d) => d ? `<button class="${d === c.day ? 'on' : ''}" data-act="calSet" data-key="day" data-val="${d}">${d}</button>` : '<span></span>').join('')}</div>
        </div>
        <div>
          <div class="group-label">시</div>
          <div class="cal-times">${Array.from({ length: 24 }, (_, h) => `<button class="${h === c.h ? 'on' : ''}" data-act="calSet" data-key="h" data-val="${h}">${String(h).padStart(2, '0')}시</button>`).join('')}</div>
          <div class="group-label">분</div>
          <div class="cal-times">${[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => `<button class="${m === c.min ? 'on' : ''}" data-act="calSet" data-key="min" data-val="${m}">${String(m).padStart(2, '0')}</button>`).join('')}</div>
        </div>
      </div>
      <div class="cal-picked">${picked.toLocaleString('ko-KR')}</div>
      <div class="row"><button class="btn blue grow" data-act="calApply">이 시간으로 예약</button><button class="btn" data-act="closeModal">취소</button></div>
    </div>`;
}

function doneModal(file) {
  const name = String(file || '').split(/[\\/]/).pop();
  return `
    <div class="modal done-modal">
      <h3>내보내기 완료</h3>
      <div class="muted">${esc(name)} 파일이 저장되었습니다.</div>
      ${state.p.edit.thumbLead && state.p.thumbnail ? '<div class="notice">영상 맨 앞 5프레임에 썸네일을 넣었습니다.</div>' : ''}
      ${state.p.coupang?.[0]?.url ? `<div class="notice" style="margin-top:10px">파트너스 링크<br><span class="small wrap-text">${esc(state.p.coupang[0].url)}</span></div>` : ''}
      <div class="row" style="margin-top:12px">
        <button class="btn" data-act="showItem" data-val="${esc(file)}">폴더 열기</button>
        <button class="btn" data-act="openUrl" data-val="${INPOCK_ADMIN}">인포크 관리</button>
        ${state.p.coupang?.[0]?.url ? `<button class="btn green" data-act="copyLink" data-i="0">링크 복사</button>` : ''}
        <button class="btn blue" data-act="closeModal">닫기</button>
      </div>
    </div>`;
}

function introModal() {
  const p = state.p;
  const shots = p.scenes.slice(0, 8);
  return `
    <div class="modal intro-modal">
      <button class="close" data-act="closeModal">✕</button>
      <h3>AI 시작 장면</h3>
      <div class="muted small">고른 장면으로 2.4초짜리 시작 영상을 만들어 맨 앞에 붙입니다. AI 키가 있으면 문장을 다듬습니다.</div>
      <div class="scene-film">${shots.map((s, i) => `<div class="film ${state.intro.scene === i ? 'on' : ''}" data-act="introScene" data-i="${i}" style="background-image:url('${fileUrl(sceneThumb(s))}')"></div>`).join('') || '<div class="muted">장면 분석을 먼저 하세요.</div>'}</div>
      <div class="row wrap" style="margin:8px 0">${INTRO_LINES.map(([n, line]) => `<button class="chip ${state.intro.line === line ? 'active' : ''}" data-act="introLine" data-val="${esc(line)}">${n}</button>`).join('')}</div>
      <textarea id="intro-line" rows="3" style="width:100%">${esc(state.intro.line)}</textarea>
      <div class="row" style="margin-top:12px"><button class="btn" data-act="introWrite">프롬프트 생성</button><button class="btn blue" data-act="introMake" ${shots.length ? '' : 'disabled'}>AI 영상 생성</button></div>
    </div>`;
}

function sfxModal() {
  const d = state.sfxDraft;
  return `
    <div class="modal sfx-modal">
      <button class="close" data-act="closeModal">✕</button>
      <div class="row"><h3 style="margin:0">AI 효과음</h3><div class="grow"></div></div>
      <div class="row" style="margin-top:10px"><div class="grow"><b>만들 소리</b><textarea id="sfx-make" rows="3" style="width:100%">${esc(d.make)}</textarea></div>
        <div class="grow"><b>빼고 싶은 소리</b><textarea id="sfx-remove" rows="3" style="width:100%">${esc(d.remove)}</textarea></div></div>
      <div class="muted small" style="margin-top:6px">${esc(d.log || '효과음을 만들면 현재 재생 위치에 들어갑니다. AI 키가 있으면 제품에 맞춰 소리를 추천합니다.')}</div>
      <div class="row" style="margin-top:8px"><span class="small">볼륨</span><input class="grow" type="range" min="10" max="100" value="${d.volume}" data-model-state="sfxVolume" /></div>
      <div class="row" style="margin-top:12px"><button class="btn" data-act="sfxSuggest">추천 받기</button><button class="btn purple" data-act="sfxMake">효과음 만들기</button><button class="btn blue" data-act="closeModal">닫기</button></div>
    </div>`;
}

/* ---------- other views ---------- */
function viewProjects() {
  const done = state.finished || [];
  return `
    <div class="row"><h2>완성 영상</h2><span class="muted small">${done.length}개</span><div class="grow"></div><button class="btn" data-act="openFinishedDir">📁 one_mp4 폴더</button></div>
    <div class="muted small" style="margin:-6px 0 12px">one_mp4에 있는 완성 영상입니다. 텔레그램을 누르면 영상과 함께 원클릭 배포의 제목·설명이 봇 대화로 갑니다.</div>
    ${done.length ? `<div class="grid5">${done.map((v, i) => `
      <div class="card">
        <div data-act="finishedPreview" data-i="${i}">${thumb({ hue: 12 + i * 48, emoji: '▶' }, 'r34')}</div>
        <div class="card-body">
          <div class="card-title" style="height:auto"><b>${esc(v.name)}</b></div>
          <div class="muted small">${mb(v.size)} · ${v.mtime ? new Date(v.mtime).toLocaleString('ko-KR') : ''}</div>
          <div class="card-actions"><button class="btn sm" data-act="finishedPreview" data-i="${i}">미리보기</button><button class="btn blue sm" data-act="finishedTelegram" data-i="${i}">텔레그램</button></div>
        </div>
      </div>`).join('')}</div>` : '<div class="empty">one_mp4 폴더에 완성 영상이 없습니다.</div>'}
    <div class="row" style="margin-top:28px"><h2>작업 중인 프로젝트</h2><div class="grow"></div><button class="btn" data-act="folder" data-val="__root">📁 전체 폴더</button><button class="btn blue" data-act="newProject">＋ 새 프로젝트</button></div>
    ${state.projects.length ? `<div class="grid5">${state.projects.map((p, i) => `
      <div class="card">
        <div ${p.preview ? `data-act="projectPreview" data-i="${i}"` : ''}>${thumb({ img: p.thumb ? fileUrl(p.thumb) : '', hue: 40 + i * 70, emoji: p.preview ? '▶' : '📁' }, 'r34')}</div>
        <div class="card-body">
          <div class="card-title" style="height:auto"><b>${esc(p.name)}</b></div>
          <div class="muted small">${p.updated ? new Date(p.updated).toLocaleString('ko-KR') : ''}</div>
          <div class="muted small">단계 ${p.step}. ${WORK_TABS[(p.step || 1) - 1]}</div>
          <div class="card-actions"><button class="btn sm" data-act="projectPreview" data-i="${i}" ${p.preview ? '' : 'disabled'}>미리보기</button><button class="btn blue sm" data-act="openProject" data-val="${esc(p.name)}">열기</button></div>
        </div>
      </div>`).join('')}</div>` : '<div class="empty">저장된 프로젝트가 없습니다. 작업실에서 저장하면 여기에 표시됩니다.</div>'}`;
}

function viewTools() {
  const cp = state.cpLink;
  const keyOk = state.aiStatus.coupang;
  const rows = (cp.rows || []).map((r) => `
    <div class="cp-link-row">
      <div class="cp-link-meta">
        <div class="muted small">상품번호</div>
        <div class="row"><code class="grow">${esc(r.productId || '-')}</code><button class="btn sm" data-act="copyVal" data-val="${esc(r.productId || '')}" ${r.productId ? '' : 'disabled'}>복사</button></div>
      </div>
      <div class="cp-link-meta">
        <div class="muted small">${r.partner ? '내 파트너스 링크' : '상품 링크'}</div>
        <div class="row"><code class="grow">${esc(r.url || '')}</code><button class="btn green sm" data-act="copyVal" data-val="${esc(r.url || '')}">복사</button></div>
      </div>
    </div>`).join('');
  return `<h2>도구</h2>
    <div class="grid5" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
      <div class="panel" style="grid-column:1/-1"><div class="ic">🛒</div><b>쿠팡 파트너스 링크</b>
        <div class="muted small" style="margin:4px 0 10px">${keyOk ? '쿠팡 상품 링크를 넣으면 내 파트너스 수익 링크와 상품번호를 만듭니다. 여러 개면 줄바꿈으로 넣으세요.' : '설정에 쿠팡 파트너스 Access/Secret 키를 넣으면 수익 링크가 생성됩니다. 지금은 상품번호만 뽑아 줍니다.'} 인포크에 올리려면 <button class="btn sm" data-act="openUrl" data-val="${INPOCK_ADMIN}">인포크 관리</button>를 누르세요.</div>
        <textarea id="tool-cp" class="cp-link-in" rows="4" placeholder="https://www.coupang.com/vp/products/8417032212?itemId=...">${esc(cp.text || '')}</textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn blue" data-act="toolCoupangLink">링크 만들기</button>
          <button class="btn" data-act="openUrl" data-val="${INPOCK_ADMIN}">인포크 관리</button>
          <button class="btn" data-act="toolCoupangClear" ${cp.rows.length ? '' : 'disabled'}>결과 지우기</button>
          <div class="grow"></div>
          ${cp.rows.length ? `<button class="btn green" data-act="toolCoupangCopyAll">전체 복사</button>` : ''}
        </div>
        ${cp.note ? `<div class="notice" style="margin-top:12px">${esc(cp.note)}</div>` : ''}
        ${rows ? `<div class="cp-link-list">${rows}</div>` : ''}
      </div>
      <div class="panel"><div class="ic">⬇</div><b>영상 다운로더</b><div class="muted small" style="margin:4px 0 10px">유튜브·틱톡·인스타 등 링크로 원본 다운로드</div>
        <div class="row"><input class="grow" id="tool-dl" placeholder="영상 링크" /><button class="btn blue" data-act="toolDownload">받기</button></div></div>
      <div class="panel"><div class="ic">🔇</div><b>무음 삭제</b><div class="muted small" style="margin:4px 0 10px">영상/오디오에서 말 없는 구간을 잘라냅니다</div>
        <button class="btn blue" data-act="toolSilence">파일 선택</button></div>
      <div class="panel"><div class="ic">📝</div><b>자막 추출</b><div class="muted small" style="margin:4px 0 10px">영상의 음성을 글자로 받아씁니다 (AI 키 필요)</div>
        <button class="btn blue" data-act="toolTranscribe" ${state.aiStatus.ai ? '' : 'disabled'}>파일 선택</button></div>
      <div class="panel"><div class="ic">🧰</div><b>필수 도구</b><div class="muted small" style="margin:4px 0 10px">yt-dlp ${state.tools.ytdlp ? '✅' : '❌'} · FFmpeg ${state.tools.ffmpeg ? '✅' : '❌'}</div>
        <button class="btn" data-act="installTools">다시 설치 / 업데이트</button></div>
    </div>`;
}

function viewSettings() {
  const s = state.settings;
  const field = (k, l, ph = '입력하지 않음', type = 'password') => `<span>${l}</span><input type="${type}" value="${esc(s[k] || '')}" data-setting="${k}" placeholder="${ph}" />`;
  return `
    <h2>설정</h2>
    <div class="settings-grid">
      <div class="panel">
        <div class="panel-title">🧠 AI (분석·대본·문구)</div>
        <div class="form-grid">
          <span>기본 AI</span><select data-setting="aiProvider"><option value="gemini" ${s.aiProvider !== 'openai' ? 'selected' : ''}>Gemini</option><option value="openai" ${s.aiProvider === 'openai' ? 'selected' : ''}>OpenAI</option></select>
          ${field('gemini', 'Gemini API Key', '분석·대본·자막·음성')}
          ${field('geminiModel', 'Gemini 모델', 'gemini-3.5-flash', 'text')}
          ${field('openai', 'OpenAI API Key (선택, 별도 과금)', '비우면 Gemini만 사용')}
          ${field('openaiModel', 'OpenAI 모델', 'gpt-4o-mini', 'text')}
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">🔎 트렌드 · 🔊 음성 · 🛒 쿠팡</div>
        <div class="form-grid">
          ${field('youtubeApi', 'YouTube Data API Key', '없으면 검색 결과 기준으로 동작')}
          ${field('elevenlabs', 'ElevenLabs API Key (선택)')}
          ${field('typecast', 'Typecast API Key (선택)')}
          ${field('coupangAccess', '쿠팡 파트너스 Access Key')}
          ${field('coupangSecret', '쿠팡 파트너스 Secret Key')}
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">📤 업로드 계정</div>
        <div class="form-grid">
          ${field('ytClientId', 'YouTube OAuth 클라이언트 ID', 'xxx.apps.googleusercontent.com (데스크톱 앱)', 'text')}
          ${field('ytClientSecret', 'YouTube OAuth 보안 비밀')}
          <span>YouTube 계정</span><div class="row"><span class="muted">${s.ytRefresh ? `연결됨 · ${channelName('youtube', s.ytChannel || '')}` : '연결 안 됨'}</span><div class="grow"></div><button class="btn blue sm" data-act="youtubeConnect">${s.ytRefresh ? '다시 연결' : '계정 연결'}</button></div>
          ${field('igClientId', 'Instagram 앱 ID', 'Instagram 로그인 설정의 앱 ID', 'text')}
          ${field('igClientSecret', 'Instagram 앱 시크릿')}
          ${field('tiktokClientKey', 'TikTok Client Key', 'developers.tiktok.com 앱의 Client key', 'text')}
          ${field('tiktokClientSecret', 'TikTok Client Secret')}
          <span>TikTok 공개 범위</span><select data-setting="tiktokPrivacy">${['SELF_ONLY', 'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR'].map((v) => `<option ${s.tiktokPrivacy === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div>
        <div class="muted small wrap-text" style="margin-top:10px">틱톡은 심사 전 앱이면 SELF_ONLY(나만 보기)만 가능합니다. 인스타그램은 페이스북 페이지 없이 인스타 로그인으로 연결합니다. 개발 모드 앱은 그 앱에 추가된 프로페셔널 계정만 로그인됩니다.</div>
      </div>
      <div class="panel">
        <div class="panel-title">✈ 텔레그램으로 폰에 보내기</div>
        <div class="form-grid">
          ${field('tgToken', '봇 토큰', 'BotFather가 준 토큰')}
          <span>연결 상태</span><div class="row"><span class="muted">${s.tgChat ? `연결됨 · @${esc(s.tgBot || '')}` : '연결 안 됨'}</span><div class="grow"></div><button class="btn blue sm" data-act="telegramConnect">연결</button></div>
        </div>
        <div class="muted small wrap-text" style="margin-top:10px">텔레그램에서 @BotFather 에게 /newbot 을 보내 봇을 만들고, 받은 토큰을 넣은 뒤 연결을 누르세요. 열린 대화에서 시작을 누른 다음 다시 연결하면 완성 영상의 텔레그램 버튼으로 보낼 수 있습니다. 50MB 이하 영상만 됩니다.</div>
      </div>
      <div class="panel">
        <div class="panel-title">🧰 필수 도구 · 저장 위치</div>
        <div class="form-grid">
          <span>yt-dlp</span><span>${state.tools.ytdlp ? '✅ 설치됨' : '❌ 없음'}</span>
          <span>FFmpeg</span><span>${state.tools.ffmpeg ? '✅ 설치됨' : '❌ 없음'}</span>
          <span>작업 폴더</span><div class="row"><span class="muted">문서\\ShoppingLens</span><div class="grow"></div><button class="btn sm" data-act="folder" data-val="__root">열기</button></div>
        </div>
        <button class="btn" style="margin-top:12px" data-act="installTools">도구 다시 설치 / 업데이트</button>
      </div>
      <div class="panel">
        <div class="panel-title">🍯 꿀템나라 제목 훅</div>
        <div class="muted small wrap-text" style="margin-bottom:12px">200개 훅을 안 겹치게 쓰고, 다 쓰면 같은 말투로 새 훅을 학습해 만듭니다. 영상 시작 자막·상단 제목에 들어갑니다.</div>
        <div class="form-grid">
          <span>자동 훅</span><select data-setting="hookAuto"><option value="on" ${s.hookAuto !== 'off' ? 'selected' : ''}>켜기</option><option value="off" ${s.hookAuto === 'off' ? 'selected' : ''}>끄기 (고정 문구)</option></select>
          <span>뽑는 방식</span><select data-setting="hookStyle">
            <option value="both" ${!s.hookStyle || s.hookStyle === 'both' ? 'selected' : ''}>200개 안 겹치게 → 끝나면 새 훅 학습</option>
            <option value="rotate" ${s.hookStyle === 'rotate' ? 'selected' : ''}>200개만 로테이션</option>
            <option value="learn" ${s.hookStyle === 'learn' ? 'selected' : ''}>매번 새 훅 학습</option>
          </select>
          <span>카테고리</span><select data-setting="hookCategory">
            <option value="auto" ${!s.hookCategory || s.hookCategory === 'auto' ? 'selected' : ''}>자동 (제품에 맞춤)</option>
            <option value="all" ${s.hookCategory === 'all' ? 'selected' : ''}>전체 섞기</option>
            ${(state.hookStatus.groups || []).map((g) => `<option value="${esc(g.id)}" ${s.hookCategory === g.id ? 'selected' : ''}>${esc(g.name)} (${g.count})</option>`).join('')}
          </select>
        </div>
        <div class="muted small" style="margin-top:12px">은행 ${state.hookStatus.bank || 200} · 사용 ${state.hookStatus.used || 0} · 남음 ${state.hookStatus.left ?? 200} · 학습 ${state.hookStatus.learned || 0}</div>
        <div class="row" style="margin-top:10px">
          <button class="btn sm" data-act="hookReset">사용한 훅 기록 초기화</button>
          <button class="btn sm" data-act="hookPreview">지금 제품으로 훅 뽑기</button>
        </div>
      </div>
    </div>
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn blue" data-act="saveSettings">설정 저장</button></div>`;
}

/* ---------- 원클릭배포 ---------- */
const SNS = [
  {
    key: 'youtube', name: 'YouTube', glyph: '▶', bg: '#ff0033', oauth: true, link: 'https://console.cloud.google.com/apis/credentials',
    fields: [['ytClientId', 'OAuth 클라이언트 ID', 'text'], ['ytClientSecret', 'OAuth 보안 비밀']],
    guide: ['Google Cloud에서 프로젝트를 만들고 YouTube Data API v3를 사용 설정합니다.', '사용자 인증 정보 → OAuth 클라이언트 ID → 애플리케이션 유형은 반드시 "데스크톱 앱"으로 만듭니다. (웹 앱이면 리디렉션 URI에 http://127.0.0.1:53681 을 추가하세요.)', '클라이언트 ID는 xxx.apps.googleusercontent.com 형식입니다. Data API 키(AIza…)가 아닙니다.', 'ID와 보안 비밀을 넣고 저장하면 브라우저에서 구글 로그인 창이 열립니다. 확인 화면이 뜨면 고급 → 쇼핑렌즈로 이동을 누르세요.'],
    note: '쇼츠로 올라가며, 예약 시 유튜브 예약 공개 기능을 씁니다.',
  },
  {
    key: 'tiktok', name: 'TikTok', glyph: '♪', bg: '#111', oauth: true, link: 'https://developers.tiktok.com/apps',
    fields: [['tiktokClientKey', 'Client Key', 'text'], ['tiktokClientSecret', 'Client Secret'], ['tiktokPrivacy', '공개 범위', 'select', ['SELF_ONLY', 'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR']]],
    guide: ['TikTok for Developers에서 앱을 만들고 Login Kit와 Content Posting API를 추가합니다.', 'Login Kit 리디렉션 URI에 http://127.0.0.1:53683/callback/ 을 그대로 넣습니다.', '권한은 user.info.basic, user.info.profile, video.upload, video.publish 를 켭니다.', 'Client Key와 Client Secret을 넣고 저장하면 브라우저에서 틱톡 로그인 창이 열립니다.'],
    note: '심사 전 앱은 개발자로 등록된 계정만 연결되고, 게시가 SELF_ONLY(나만 보기)로 제한될 수 있습니다. 채널명을 누르면 틱톡 채널이 열립니다.',
  },
  {
    key: 'instagram', name: 'Instagram', glyph: '◎', bg: 'linear-gradient(45deg,#f9a825,#e91e63 55%,#7b1fa2)', oauth: true, link: 'https://developers.facebook.com/apps/',
    fields: [['igClientId', 'Instagram 앱 ID', 'text'], ['igClientSecret', 'Instagram 앱 시크릿']],
    guide: ['Meta 개발자 앱에 Instagram 로그인(Instagram API with Instagram Login)을 추가합니다. 페이스북 페이지는 연결하지 않습니다.', 'Business login settings의 OAuth 리디렉션 URI에 http://127.0.0.1:53684/callback/ 을 그대로 넣습니다.', '권한은 instagram_business_basic, instagram_business_content_publish 입니다. 개발 모드에서는 앱에 추가한 인스타 프로페셔널 계정만 로그인됩니다.', 'Instagram 앱 ID와 앱 시크릿을 넣고 저장하면 브라우저에서 인스타 로그인 창이 열립니다.'],
    note: '릴스로 게시됩니다. Meta가 영상을 가져가므로 업로드 중에만 임시 공개 주소를 엽니다. 토큰은 약 60일입니다. 채널명을 누르면 인스타 프로필이 열립니다.',
  },
  {
    key: 'threads', name: 'Threads', glyph: '@', bg: '#111', link: 'https://developers.facebook.com/docs/threads',
    fields: [['threadsToken', '액세스 토큰']],
    guide: ['Meta 개발자 앱에 Threads API 사용 사례를 추가합니다.', 'threads_basic, threads_content_publish 권한으로 사용자 토큰을 발급합니다.'],
    note: 'Threads API는 내 PC의 영상 파일을 직접 받지 않습니다. 제목·설명 글과 함께, 같이 올린 유튜브 쇼츠 링크를 붙여 게시합니다.',
  },
  {
    key: 'facebook', name: 'Facebook', glyph: 'f', bg: '#1877f2', link: 'https://developers.facebook.com/tools/explorer/',
    fields: [['fbPageId', '페이지 ID', 'text'], ['fbPageToken', '페이지 액세스 토큰']],
    guide: ['Graph API 탐색기에서 pages_manage_posts, pages_read_engagement, publish_video 권한을 선택합니다.', 'me/accounts 를 조회해 올릴 페이지의 id와 access_token을 복사합니다.'],
    note: '페이지에 동영상으로 게시되며, 예약 시 페이스북 예약 게시 기능을 씁니다(10분~30일 이내).',
  },
  {
    key: 'x', name: 'X', glyph: '𝕏', bg: '#111', oauth: true, link: 'https://developer.x.com/en/portal/dashboard',
    fields: [['xClientId', 'OAuth 2.0 Client ID', 'text'], ['xClientSecret', 'Client Secret (선택)']],
    guide: ['X 개발자 포털에서 앱 → User authentication settings → OAuth 2.0을 켭니다. 권한은 Read and write.', 'Callback URI에 http://127.0.0.1:53682/x-callback 을 그대로 넣습니다.', 'Client ID를 넣고 "연결하기"를 누르면 브라우저에서 X 로그인 창이 열립니다.'],
    note: '본문은 280자로 잘립니다. X API 게시는 요금제(크레딧)가 필요할 수 있습니다.',
  },
];
const snsOf = (k) => SNS.find((s) => s.key === k);
const snsConn = (k) => (state.settings.sns || {})[k];
const channelUrl = (key) => snsConn(key)?.url || (key === 'youtube' ? state.settings.ytChannelUrl : '') || '';
const channelName = (key, name) => {
  const url = channelUrl(key);
  if (key !== 'youtube' && !url) return esc(name);
  return `<button type="button" class="ch-link" data-act="openChannel" data-val="${esc(url)}" title="채널 열기">${esc(name)}</button>`;
};
const snsHasCreds = (s) => s.key === 'youtube' ? !!state.settings.ytRefresh : s.key === 'x' ? !!state.settings.xRefresh : s.fields.filter(([, , t]) => t !== 'select').some(([f]) => state.settings[f]);
const snsIcon = (s, size = 34) => `<span class="sns-ic" style="background:${s.bg};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.44)}px">${s.glyph}</span>`;
const blastTargets = () => SNS.filter((s) => state.blast.targets[s.key] && snsConn(s.key));

const CAPTION_LIMITS = [
  ['youtube', '제목', 100, (b) => b.title.length],
  ['tiktok', '캡션', 2200, (b) => b.desc.length || b.title.length],
  ['instagram', '캡션', 2200, (b) => b.desc.length || b.title.length],
  ['threads', '글', 500, (b) => [b.title, b.desc].filter(Boolean).join('\n\n').length],
  ['x', '글', 280, (b) => [b.title, b.desc].filter(Boolean).join('\n\n').length],
];

function blastMeters() {
  const b = state.blast;
  const picked = blastTargets().map((s) => s.key);
  const rows = CAPTION_LIMITS.filter(([k]) => !picked.length || picked.includes(k));
  if (!rows.length) return '<div class="muted small">선택한 채널에는 글자 수 제한이 거의 없습니다.</div>';
  return rows.map(([k, label, max, count]) => {
    const n = count(b);
    const pct = Math.min(100, (n / max) * 100);
    return `<div class="meter ${n > max ? 'over' : ''}"><span class="m-name">${snsIcon(snsOf(k), 16)} ${snsOf(k).name} ${label}</span><span class="m-bar"><i style="width:${pct}%"></i></span><span class="m-num">${n}/${max}</span></div>`;
  }).join('');
}

function relTime(t) {
  const m = Math.round((t - Date.now()) / 60000);
  if (m <= 0) return '곧 실행';
  if (m < 60) return `${m}분 후`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 ${m % 60}분 후`;
  return `${Math.floor(m / 1440)}일 후`;
}

function phoneCaption() {
  const b = state.blast;
  return `<b>${esc(b.title || '제목을 입력하세요')}</b><span>${esc(b.desc || '설명과 해시태그가 여기에 표시됩니다.')}</span>`;
}

function viewBlast() {
  const b = state.blast;
  const targets = blastTargets();
  const connected = SNS.filter((s) => snsConn(s.key));
  const recent = b.history.slice(0, 10).flatMap((h) => h.results);
  const okCount = recent.filter((r) => r.ok).length;
  const hasText = !!(b.title.trim() || b.desc.trim());
  const blocker = !b.file ? '영상을 먼저 선택하세요' : !hasText ? '제목이나 설명을 입력하세요' : !targets.length ? '배포할 채널을 하나 이상 켜세요' : '';
  const step = (n, title, done, right = '') => `<div class="ocd-step-head"><span class="ocd-num ${done ? 'done' : ''}">${done ? '✓' : n}</span><b>${title}</b><div class="grow"></div>${right}</div>`;
  const status = (s) => snsConn(s.key) ? '<span class="pill ok">연결됨</span>' : snsHasCreds(s) ? '<span class="pill warn">확인 필요</span>' : '<span class="pill">미연결</span>';
  const result = (x) => {
    const s = snsOf(x.platform);
    return `<span class="res-chip ${x.ok ? 'ok' : 'fail'}" title="${esc(x.text || '')}">${s ? snsIcon(s, 16) : ''} ${esc(s?.name || x.platform)} ${x.ok ? '성공' : '실패'}${x.url ? ` <a data-act="openUrl" data-val="${esc(x.url)}">열기 ↗</a>` : ''}</span>`;
  };
  return `
    <div class="ocd">
      <section class="ocd-hero">
        <div>
          <div class="eyebrow">ONE-CLICK DEPLOY</div>
          <h1>원클릭배포</h1>
          <p>영상 하나와 문구 하나로 연결된 채널 모두에 동시에 올립니다.</p>
          <div class="hero-chans">${SNS.map((s) => `<span class="${snsConn(s.key) ? '' : 'off'}" title="${s.name}">${snsIcon(s, 30)}</span>`).join('')}</div>
        </div>
        <div class="hero-stats">
          <div><small>연결 채널</small><b>${connected.length}<em>/${SNS.length}</em></b></div>
          <div><small>예약 대기</small><b>${b.jobs.length}<em>건</em></b></div>
          <div><small>최근 성공</small><b>${recent.length ? okCount : '-'}<em>${recent.length ? `/${recent.length}` : ''}</em></b></div>
        </div>
      </section>

      <div class="ocd-grid">
        <div class="ocd-main">
          <section class="ocd-card">
            ${step(1, '영상 선택', !!b.file, b.file ? `<button class="btn sm" data-act="blastPick">변경</button><button class="btn sm" data-act="blastClearFile">제거</button>` : '')}
            ${b.file ? `
              <div class="file-row"><span class="file-ic">🎞</span><div class="grow ellipsis"><b>${esc(b.name)}</b><div class="muted small">${mb(b.size)} · 오른쪽 미리보기에서 재생할 수 있습니다</div></div></div>`
            : `
              <div class="ocd-drop" id="blast-drop" data-act="blastPick">
                <div class="cloud">⬆</div>
                <div><b>영상을 여기로 끌어다 놓거나 클릭해서 선택</b><div class="muted small">MP4 · MOV · WebM</div></div>
              </div>
              ${state.p.exported ? `<button class="btn sm" style="margin-top:10px" data-act="blastFromWork">🎬 작업실 최종 영상 불러오기 · ${esc(state.p.name)}</button>` : ''}`}
          </section>

          <section class="ocd-card">
            ${step(2, '문구 작성', hasText, state.p.upload.desc || state.p.upload.title ? '<button class="btn sm" data-act="blastTextFromWork">작업실 문구 가져오기</button>' : '')}
            <input class="ocd-title" placeholder="제목" value="${esc(b.title)}" data-blast="title" />
            <textarea rows="7" placeholder="설명, 해시태그, 링크" data-blast="desc">${esc(b.desc)}</textarea>
            <div class="row" style="margin:10px 0 6px"><span class="muted small">채널별 글자 수</span><div class="grow"></div><span class="muted small" id="blast-count">총 ${b.title.length + b.desc.length}자</span></div>
            <div id="ocd-meters">${blastMeters()}</div>
          </section>

          <section class="ocd-card">
            ${step(3, '배포 채널', targets.length > 0, '<button class="btn sm" data-act="snsManage">⚙ 채널 관리</button><button class="btn sm" data-act="snsRefresh">연결 상태 확인</button>')}
            <div class="ch-list">
              ${SNS.map((s) => {
                const c = snsConn(s.key);
                const on = c && b.targets[s.key];
                return `
                <div class="ch-row ${on ? 'on' : ''} ${c ? '' : 'off'}">
                  ${snsIcon(s, 36)}
                  <div class="grow" style="min-width:0"><b>${s.name}</b><div class="muted small ellipsis">${c ? channelName(s.key, c.name) : esc(s.note)}</div></div>
                  ${status(s)}
                  <button class="btn sm" data-act="snsOpen" data-val="${s.key}">${c ? '설정' : '연결'}</button>
                  ${c ? `<button class="switch ${on ? 'on' : ''}" data-act="snsToggle" data-val="${s.key}" title="배포 대상 켜기/끄기"></button>` : '<span class="switch ghost"></span>'}
                </div>`;
              }).join('')}
            </div>
          </section>
        </div>

        <aside class="ocd-side">
          <div class="phone">
            <div class="phone-screen">
              ${b.file ? `<video src="${fileUrl(b.file)}" controls loop></video>` : '<div class="phone-empty" data-act="blastPick"><span>⬆</span>영상 선택</div>'}
              <div class="phone-cap" id="phone-cap">${phoneCaption()}</div>
            </div>
          </div>
          <div class="ocd-opts">
            <div class="opt"><div class="grow"><b>내 피드에서 제외</b><div class="muted small">인스타 릴스를 프로필 그리드에 안 보이게</div></div><button class="switch ${b.excludeFeed ? 'on' : ''}" data-act="blastToggle" data-key="excludeFeed"></button></div>
            <div class="opt"><div class="grow"><b>예약 배포</b><div class="muted small">정한 시간에 자동으로 올립니다</div></div><button class="switch ${b.scheduleOn ? 'on' : ''}" data-act="blastToggle" data-key="scheduleOn"></button></div>
            ${b.scheduleOn ? `<div class="row"><input type="datetime-local" style="width:100%" value="${esc(b.schedule)}" data-blast="schedule" /><button class="btn sm" data-act="openCal" data-val="blast">달력</button></div>
              <div class="muted small wrap-text" style="margin-top:6px">유튜브·페이스북은 지금 올려 두고 정한 시간에 공개됩니다. 나머지는 그 시간에 프로그램이 올리며, 꺼져 있었다면 다음 실행 때 바로 올립니다.</div>` : ''}
          </div>
          <div class="ocd-targets">${targets.length ? `${targets.map((s) => snsIcon(s, 24)).join('')}<span>${targets.length}개 채널로 배포</span>` : '<span class="muted">선택된 채널 없음</span>'}</div>
          <button class="deploy-btn" data-act="blastGo" ${blocker || state.busy ? 'disabled' : ''}>${b.scheduleOn ? '⏰ 예약 배포' : '🚀 원클릭 배포'}</button>
          ${blocker ? `<div class="muted small" style="text-align:center;margin-top:8px">${blocker}</div>` : ''}
        </aside>
      </div>

      <section class="ocd-card ocd-log">
        <div class="row">
          <div class="seg">
            <button class="${b.tab !== 'jobs' ? 'active' : ''}" data-act="blastTab" data-val="history">배포 기록 <em>${b.history.length}</em></button>
            <button class="${b.tab === 'jobs' ? 'active' : ''}" data-act="blastTab" data-val="jobs">예약 대기 <em>${b.jobs.length}</em></button>
          </div>
          <div class="grow"></div>
          <button class="btn ghost sm" data-act="blastRefresh">새로고침</button>
          ${b.tab !== 'jobs' ? `<button class="btn sm" data-act="blastClear" ${b.history.length ? '' : 'disabled'}>기록 비우기</button>` : ''}
        </div>
        ${b.tab === 'jobs'
          ? b.jobs.length ? b.jobs.map((j) => `
            <div class="tl">
              <div class="tl-time"><b>${relTime(j.when)}</b><small>${new Date(j.when).toLocaleString('ko-KR')}</small></div>
              <span class="tl-dot wait"></span>
              <div class="grow" style="min-width:0"><b class="ellipsis">${esc(j.title)}</b><div class="row" style="margin-top:6px">${j.targets.map((k) => snsOf(k) ? snsIcon(snsOf(k), 20) : '').join('')}</div></div>
              <button class="btn sm" data-act="blastCancel" data-val="${j.id}">예약 취소</button>
            </div>`).join('') : '<div class="empty" style="padding:28px 0">예약 대기 중인 배포가 없습니다.</div>'
          : b.history.length ? b.history.map((h) => {
            const ok = h.results.every((x) => x.ok);
            return `
            <div class="tl">
              <div class="tl-time"><b>${new Date(h.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</b><small>${new Date(h.time).toLocaleDateString('ko-KR')}</small></div>
              <span class="tl-dot ${ok ? 'ok' : 'fail'}"></span>
              <div class="grow" style="min-width:0">
                <div class="row"><b class="ellipsis">${esc(h.title)}</b>${h.scheduledFor ? `<span class="pill">예약 ${new Date(h.scheduledFor).toLocaleString('ko-KR')}</span>` : ''}${h.late ? '<span class="pill warn">늦게 실행됨</span>' : ''}</div>
                <div class="row wrap" style="margin-top:6px">${h.results.map(result).join('')}</div>
                ${h.results.filter((x) => !x.ok).map((x) => `<div class="bad small wrap-text" style="margin-top:4px">${esc(snsOf(x.platform)?.name || x.platform)} · ${esc(x.text)}</div>`).join('')}
              </div>
            </div>`;
          }).join('') : '<div class="empty" style="padding:28px 0">아직 배포 기록이 없습니다.</div>'}
      </section>
    </div>`;
}


function snsModal(key) {
  const s = snsOf(key);
  const st = state.settings;
  const c = snsConn(key);
  const input = ([f, label, type = 'password', opts]) => type === 'select'
    ? `<span>${label}</span><select data-setting="${f}">${opts.map((o) => `<option ${st[f] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
    : `<span>${label}</span><input type="${type}" data-setting="${f}" value="${esc(st[f] || '')}" placeholder="입력하지 않음" />`;
  return `
    <div class="modal sns-modal">
      <button class="close" data-act="closeModal">✕</button>
      <div class="row" style="margin-bottom:6px">${snsIcon(s, 40)}<div><h3 style="margin:0">${s.name} 연결</h3><div class="muted small">${c ? `연결됨 · ${channelName(key, c.name)}` : '연결 안 됨'}</div></div></div>
      <ol class="guide">${s.guide.map((g) => `<li>${esc(g)}</li>`).join('')}</ol>
      <button class="btn sm" data-act="openUrl" data-val="${s.link}">개발자 페이지 열기 ↗</button>
      <div class="form-grid" style="grid-template-columns:150px 1fr;margin-top:14px">${s.fields.map(input).join('')}</div>
      <div class="notice" style="margin-top:14px">${esc(s.note)}</div>
      <div class="row" style="margin-top:6px">${c || snsHasCreds(s) ? `<button class="btn" data-act="snsDisconnect" data-val="${key}">연결 해제</button>` : ''}<div class="grow"></div>
        <button class="btn" data-act="closeModal">닫기</button><button class="btn blue" data-act="snsSave" data-val="${key}">${s.oauth ? '저장 후 로그인 연결' : '저장 후 연결 확인'}</button></div>
    </div>`;
}

function snsListModal() {
  return `
    <div class="modal sns-modal">
      <button class="close" data-act="closeModal">✕</button>
      <h3>채널 관리</h3>
      ${SNS.map((s) => {
        const c = snsConn(s.key);
        return `<div class="list-item">${snsIcon(s, 26)}<span class="t">${s.name}</span><span class="small ${c ? 'ok' : 'muted'}">${c ? channelName(s.key, c.name) : snsHasCreds(s) ? '확인 필요' : '연결 안 됨'}</span><button class="btn sm" data-act="snsOpen" data-val="${s.key}">설정</button></div>`;
      }).join('')}
    </div>`;
}

async function loadBlast() {
  if (!window.native) return;
  Object.assign(state.blast, await api('blastState'));
  if (state.view === 'blast' && !state.modal) render();
}

async function setBlastFile(file) {
  if (!file) return;
  if (!/\.(mp4|mov|webm|m4v)$/i.test(file)) return toast('MP4, MOV, WebM 영상만 올릴 수 있습니다.');
  const info = await api('fileInfo', file);
  if (!info) return toast('파일을 찾을 수 없습니다.');
  Object.assign(state.blast, { file: info.file, name: info.name, size: info.size });
  render();
}

function saveBlastTargets() {
  localStorage.setItem('sl-blast-targets', JSON.stringify(state.blast.targets));
}

function saveLensGroups() {
  localStorage.setItem('sl-lens-groups', JSON.stringify(state.lens.groups));
}

function lensRows() {
  const raw = state.lens.rows || [];
  const views = raw.map((r) => r.views || 0).filter((n) => n > 0).sort((a, b) => a - b);
  const mid = views[Math.floor(views.length / 2)] || 1;
  return raw.map((r) => {
    const ratio = (r.views || 0) / mid;
    const contrib = r.subs ? (r.views || 0) / r.subs : 0;
    const engage = r.views ? ((r.likes || 0) + (r.comments || 0)) / r.views : 0;
    let cii = 'Bad';
    if (ratio >= 3) cii = 'Great';
    else if (ratio >= 1.5) cii = 'Good';
    else if (ratio >= 0.8) cii = 'Soso';
    else if (ratio >= 0.35) cii = 'Not bad';
    return { ...r, ratio, contrib, engage, cii };
  });
}

function lensVisible() {
  const L = state.lens;
  return lensRows().filter((r) => (r.views || 0) >= L.minViews && (r.subs || 0) >= L.minSubs && !(L.shorts && r.dur > 60) && L.ciiOn[r.cii] !== false);
}

function lensChecked() {
  return lensVisible().filter((r) => state.lens.checked[r.url]);
}

function lensMark(name) {
  const hue = [...name].reduce((h, c) => (h * 33 + c.charCodeAt(0)) % 360, 0);
  return `<span class="ch-mark" style="background:hsl(${hue} 70% 52%)">${esc(name.slice(0, 1) || '?')}</span>`;
}

function viewLens() {
  const L = state.lens;
  const rows = lensVisible();
  const checked = lensChecked();
  const groups = L.groups || [];
  const shown = L.groupId === 'all' ? groups.flatMap((g) => g.channels.map((c) => ({ ...c, tag: g.name }))) : (groups.find((g) => g.id === L.groupId)?.channels || []).map((c) => ({ ...c, tag: groups.find((g) => g.id === L.groupId)?.name || '' }));
  const q = L.channelQ.trim();
  const bookmarks = q ? shown.filter((c) => c.name.includes(q)) : shown;
  return `
    <div class="tabs">
      <button class="tab ${L.tab === 'search' ? 'active' : ''}" data-act="lensTab" data-val="search">실시간 검색</button>
      <button class="tab ${L.tab === 'channels' ? 'active' : ''}" data-act="lensTab" data-val="channels">채널 즐겨찾기</button>
    </div>
    ${L.tab === 'channels' ? lensChannels(groups, bookmarks) : lensSearchView(rows, checked)}`;
}

function lensSearchView(rows, checked) {
  const L = state.lens;
  const ciiBtn = (name) => `<button class="pill ${L.ciiOn[name] ? 'active' : ''}" data-act="lensCii" data-val="${name}">${name}</button>`;
  return `
    <div class="lens">
      <aside class="lens-side panel">
        <div class="group-label">검색 설정</div>
        <div class="row" style="margin-bottom:8px">
          <button class="pill ${L.sort === 'date' ? 'active' : ''}" data-act="lensSet" data-key="sort" data-val="date">최신순</button>
          <button class="pill ${L.sort === 'views' ? 'active' : ''}" data-act="lensSet" data-key="sort" data-val="views">조회수순</button>
        </div>
        <label class="small">영상 수</label>
        <select data-lens="limit" data-num data-lenslive>${[20, 30, 50].map((n) => `<option value="${n}" ${L.limit === n ? 'selected' : ''}>${n}개</option>`).join('')}</select>
        <label class="small">기간</label>
        <select data-lens="period" data-lenslive>${[['all', '전체'], ['week', '1주일'], ['month', '1개월'], ['year', '1년 이내']].map(([v, l]) => `<option value="${v}" ${L.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="small">국가</label>
        <select data-lens="region" data-lenslive>${[['KR', '한국(KR)'], ['US', '미국(US)'], ['JP', '일본(JP)']].map(([v, l]) => `<option value="${v}" ${L.region === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input style="width:100%;margin:8px 0" placeholder="검색어 (예: 다이소 꿀템)" value="${esc(L.query)}" data-lens="query" data-enter="lensSearch" />
        <label class="row" style="margin:8px 0;white-space:nowrap"><input type="checkbox" data-act="lensToggle" data-key="shorts" ${L.shorts ? 'checked' : ''} /> 쇼츠만</label>
        <button class="btn blue" style="width:100%" data-act="lensSearch">검색</button>
        <button class="btn" style="width:100%;margin-top:6px" data-act="lensClearRows">Clear</button>
        <div class="group-label" style="margin-top:14px">필터</div>
        <label class="small">조회수</label>
        <select data-lens="minViews" data-num data-lenslive>${[[0, '전체'], [10000, '1만 이상'], [100000, '10만 이상'], [500000, '50만 이상'], [1000000, '100만 이상']].map(([v, l]) => `<option value="${v}" ${L.minViews === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="small">구독자</label>
        <select data-lens="minSubs" data-num data-lenslive>${[[0, '전체'], [1000, '1천 이상'], [10000, '1만 이상'], [50000, '5만 이상'], [100000, '10만 이상']].map(([v, l]) => `<option value="${v}" ${L.minSubs === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="row wrap" style="margin-top:8px">${['Great', 'Good', 'Soso', 'Not bad', 'Bad'].map(ciiBtn).join('')}</div>
        <button class="btn sm" style="width:100%;margin-top:8px" data-act="lensResetFilter">필터 해제</button>
        <button class="btn sm" style="width:100%;margin-top:6px" data-act="lensCaptions" ${checked.length ? '' : 'disabled'}>자막 수집 (${checked.length})</button>
      </aside>
      <section class="lens-main">
        <div class="row wrap" style="margin-bottom:8px">
          <input class="grow" id="lens-url" placeholder="YouTube URL 붙여넣기" data-enter="lensUrl" />
          <button class="btn sm" data-act="lensAddUrl">URL 추가</button>
          <button class="btn sm" data-act="lensSearch">새로고침</button>
          <button class="btn sm" data-act="lensIdeas">AI 추천 아이디어</button>
          <button class="btn sm" data-act="lensTitles">타이틀 메이커</button>
          <button class="btn blue sm" data-act="lensOpenChecked" ${checked.length ? '' : 'disabled'}>분석 및 대본</button>
        </div>
        <div class="row wrap" style="margin-bottom:8px">
          <button class="btn sm" data-act="lensDownload" data-val="mp4" ${checked.length ? '' : 'disabled'}>MP4 다운</button>
          <button class="btn sm" data-act="lensDownload" data-val="mp3" ${checked.length ? '' : 'disabled'}>MP3 다운</button>
          <button class="btn blue sm" data-act="lensToWork" ${checked.length ? '' : 'disabled'}>작업실로 보내기 (${checked.length})</button>
          <button class="btn sm" data-act="lensExcel" ${rows.length ? '' : 'disabled'}>엑셀(CSV) 저장</button>
          <div class="grow"></div>
          <span class="muted small">${rows.length}개 표시${L.source === 'ytdlp' ? ' · 상위 12개만 구독자·게시일을 채움' : L.source === 'api' ? ' · YouTube API' : ''}</span>
        </div>
        ${L.source === 'ytdlp' ? '<div class="notice">구독자·좋아요·게시일은 상위 영상부터 채웁니다. 설정에 YouTube Data API 키를 넣으면 국가·기간 필터와 수치가 한 번에 맞습니다. 기여도는 조회수÷구독자, 성과 배율은 이번 목록의 중간 조회수 대비입니다.</div>' : ''}
        <div class="lens-table-wrap">
          <table class="lens-table">
            <tr><th></th><th>썸네일</th><th>채널</th><th>제목</th><th>게시일</th><th>구독자</th><th>조회수</th><th>기여도</th><th>성과</th><th>CII</th><th>길이</th><th>좋아요</th><th>댓글</th><th>참여</th><th>자막</th></tr>
            ${rows.map((r) => `<tr>
              <td><input type="checkbox" data-act="lensCheck" data-url="${esc(r.url)}" ${L.checked[r.url] ? 'checked' : ''} /></td>
              <td><img class="lens-thumb" src="${esc(r.img)}" alt="" /></td>
              <td class="small">${esc(r.channel)}</td>
              <td class="lens-title" data-act="lensOpen" data-url="${esc(r.url)}">${esc(r.title)}</td>
              <td class="small">${esc(r.date || '-')}</td>
              <td class="small">${r.subs ? fmt(r.subs) : '-'}</td>
              <td class="small">${fmt(r.views)}</td>
              <td class="small">${r.subs ? `${(r.contrib * 100).toFixed(1)}%` : '-'}</td>
              <td class="small">${r.ratio.toFixed(1)}배</td>
              <td><span class="cii ${r.cii.replace(' ', '-')}">${r.cii}</span></td>
              <td class="small">${durText(r.dur) || '-'}</td>
              <td class="small">${r.likes ? fmt(r.likes) : '-'}</td>
              <td class="small">${r.comments ? fmt(r.comments) : '-'}</td>
              <td class="small">${r.views ? `${(r.engage * 100).toFixed(1)}%` : '-'}</td>
              <td class="small">${r.caption == null ? '-' : r.caption ? '있음' : '없음'}</td>
            </tr>`).join('') || `<tr><td colspan="15"><div class="empty">검색어를 입력하고 검색을 누르세요. 채널 즐겨찾기에서 모아 온 영상도 여기 표시됩니다.</div></td></tr>`}
          </table>
        </div>
      </section>
    </div>`;
}

function lensChannels(groups, bookmarks) {
  const L = state.lens;
  const found = L.found || [];
  return `
    <div class="lens-ch">
      <div class="panel">
        <div class="row" style="margin-bottom:8px">
          <span class="small">그룹</span>
          <select data-lens="groupId" data-lenslive>${`<option value="all" ${L.groupId === 'all' ? 'selected' : ''}>전체 (${groups.reduce((n, g) => n + g.channels.length, 0)})</option>`}${groups.map((g) => `<option value="${g.id}" ${L.groupId === g.id ? 'selected' : ''}>${esc(g.name)} (${g.channels.length})</option>`).join('')}</select>
          <button class="btn sm" data-act="lensGroup" data-val="add">＋</button>
          <button class="btn sm" data-act="lensGroup" data-val="rename" ${L.groupId === 'all' ? 'disabled' : ''}>이름</button>
          <button class="btn sm" data-act="lensGroup" data-val="del" ${L.groupId === 'all' ? 'disabled' : ''}>삭제</button>
        </div>
        <div class="row" style="margin-bottom:8px"><input class="grow" placeholder="저장한 채널 검색" data-lens="channelQ" data-lenslive /></div>
        <div class="ch-list">
          ${bookmarks.map((c) => `<label class="ch-item"><input type="checkbox" data-act="lensPickCh" data-url="${esc(c.url)}" ${L.pickedCh[c.url] ? 'checked' : ''} />${c.img ? `<img src="${esc(c.img)}" alt="" />` : lensMark(c.name)}<div class="grow"><b>${esc(c.name)}</b><div class="muted small">구독자 ${c.subs ? fmt(c.subs) : '-'} · 영상 ${c.videos || '-'}</div></div><span class="chip">${esc(c.tag || '저장')}</span></label>`).join('') || '<div class="empty">저장된 채널이 없습니다. 오른쪽에서 찾아 추가하세요.</div>'}
        </div>
        <div class="row" style="margin-top:8px"><span class="small">채널당</span><input style="width:70px" type="number" min="5" max="40" value="${L.perChannel}" data-lens="perChannel" data-num /><span class="small">개</span><div class="grow"></div><button class="btn blue sm" data-act="lensCollect" ${bookmarks.some((c) => L.pickedCh[c.url]) ? '' : 'disabled'}>선택 채널 영상 모으기</button></div>
      </div>
      <div class="panel">
        <div class="row" style="margin-bottom:8px">
          <input class="grow" placeholder="채널명 또는 YouTube 링크" data-lens="findCh" data-enter="lensChannel" />
          <button class="btn blue" data-act="lensChannel">검색</button>
        </div>
        <div class="ch-list">
          ${found.map((c) => `<label class="ch-item"><input type="checkbox" data-act="lensPickFound" data-url="${esc(c.url)}" ${L.pickedFound[c.url] ? 'checked' : ''} />${c.img ? `<img src="${esc(c.img)}" alt="" />` : lensMark(c.name)}<div class="grow"><b>${esc(c.name)}</b><div class="muted small">구독자 ${c.subs ? fmt(c.subs) : '-'}</div></div></label>`).join('') || '<div class="empty">채널 이름이나 주소를 검색하세요.</div>'}
        </div>
        <button class="btn" style="width:100%;margin-top:8px" data-act="lensSaveFound" ${Object.values(L.pickedFound).some(Boolean) ? '' : 'disabled'}>선택 채널 즐겨찾기에 추가</button>
      </div>
    </div>`;
}

function lensModal(url) {
  const row = (state.lens.rows || []).find((r) => r.url === url) || { url, title: url, channel: '', views: 0 };
  const a = state.analysis[url];
  const info = a && a !== 'loading' && !a.error ? a.info : row;
  const rep = a?.report;
  const pane = state.lens.pane;
  let body;
  if (a === 'loading') body = `<div class="empty"><div class="spinner"></div><div id="live-progress">${esc(state.liveText || '분석 중')}</div></div>`;
  else if (!rep) body = `<div class="empty">${a?.error ? esc(a.error) : '자막과 제목을 바탕으로 후킹, 키워드, 타임라인을 정리합니다.'}<div style="margin-top:12px"><button class="btn blue" data-act="lensAnalyze" data-url="${esc(url)}">분석하기</button></div></div>`;
  else if (pane === 'timeline') {
    body = `<div class="lens-lines">${(rep.timeline || []).map((t) => `<div class="lens-line"><b>${esc(t.t)}</b><span>${esc(t.text)}</span></div>`).join('') || '<div class="muted">시간 정보가 없습니다.</div>'}</div>`;
  } else if (pane === 'script') {
    body = `
      <div class="row" style="margin-bottom:8px">
        <button class="pill ${state.lens.scriptMode === 'recreate' ? 'active' : ''}" data-act="lensMode" data-val="recreate">원본 재구성 (쇼츠)</button>
        <button class="pill ${state.lens.scriptMode === 'structure' ? 'active' : ''}" data-act="lensMode" data-val="structure">3단 구조 (몸통)</button>
      </div>
      <textarea rows="2" style="width:100%" placeholder="추가 지시. 비워 두면 분석 내용만 사용합니다." data-lens="scriptPrompt">${esc(state.lens.scriptPrompt)}</textarea>
      ${state.lens.scriptFallback ? '<div class="notice">AI 키가 없어 자막을 문장으로 나눠 대본 초안을 만들었습니다.</div>' : ''}
      <textarea rows="10" style="width:100%;margin-top:8px" data-lens="scriptText">${esc(state.lens.scriptText)}</textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn blue" data-act="lensScriptMake">대본 생성</button>
        <button class="btn" data-act="lensScriptCopy">대본 복사</button>
        <button class="btn" data-act="lensSendScript" ${state.lens.scriptText.trim() ? '' : 'disabled'}>작업실 대본으로</button>
      </div>`;
  } else {
    body = `
      ${rep.fallback ? '<div class="notice">AI 키가 없어 자막·제목으로 초안을 만들었습니다. 설정에서 키를 넣으면 후킹과 키워드가 더 구체적입니다.</div>' : ''}
      <ol class="lens-ol">${(rep.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
      <div class="lens-h">초반 후킹 방법</div>
      <ol class="lens-ol">${(rep.hooks || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
      <div class="lens-h">주요 키워드</div>
      <ol class="lens-ol">${(rep.keywords || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`;
  }
  return `
    <div class="modal lens-modal">
      <button class="close" data-act="closeModal">✕</button>
      <h3>분석 및 대본</h3>
      <div class="muted small wrap-text">${esc(info.title || row.title)} · ${esc(info.channel || '')} · 조회수 ${fmt(info.views || row.views)}</div>
      <div class="row" style="margin:10px 0">
        ${thumb({ ...row, img: info.img || row.img }, 'r34')}
        <div class="grow">
          <div class="tabs">
            <button class="tab ${pane === 'report' ? 'active' : ''}" data-act="lensPane" data-val="report">분석 결과</button>
            <button class="tab ${pane === 'timeline' ? 'active' : ''}" data-act="lensPane" data-val="timeline">타임라인</button>
            <button class="tab ${pane === 'script' ? 'active' : ''}" data-act="lensPane" data-val="script">대본 생성</button>
          </div>
          <div class="row wrap">
            <button class="btn blue sm" data-act="lensAnalyze" data-url="${esc(url)}">분석하기</button>
            <button class="btn sm" data-act="lensFind" data-url="${esc(url)}">제품찾기</button>
            <button class="btn sm" data-act="styleFromTrend" data-url="${esc(url)}">스타일로 작업실</button>
            <button class="btn sm" data-act="openUrl" data-val="${esc(url)}">원본 보기</button>
          </div>
        </div>
      </div>
      ${body}
    </div>`;
}

function lensIdeasModal() {
  const d = state.lens.ideas || { ideas: [], titles: [] };
  const block = (title, arr, act) => `<div class="group-label">${title}</div>${(arr || []).map((t) => `<div class="list-item"><span class="t wrap-text">${esc(t)}</span><button class="btn sm" data-act="${act}" data-val="${esc(t)}">복사</button></div>`).join('')}`;
  return `
    <div class="modal lens-modal">
      <button class="close" data-act="closeModal">✕</button>
      <h3>${state.lens.ideaMode === 'titles' ? '타이틀 메이커' : 'AI 추천 아이디어'}</h3>
      ${d.fallback ? '<div class="notice">AI 키가 없어 검색어로 기본 문장을 만들었습니다.</div>' : ''}
      ${state.lens.ideaMode === 'titles' ? block('제목', d.titles, 'lensCopyIdea') : `${block('아이디어', d.ideas, 'lensCopyIdea')}${block('같이 나온 제목', d.titles, 'lensUseTitle')}`}
    </div>`;
}

/* ---------- render ---------- */
function render() {
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.val === state.view));
  const main = $('#main');
  const scroll = main.scrollTop;
  main.innerHTML = { trend: viewTrend, lens: viewLens, work: viewWork, blast: viewBlast, projects: viewProjects, tools: viewTools, settings: viewSettings }[state.view]();
  main.scrollTop = scroll;
  const m = state.modal;
  const prevModal = $('#modal-root .modal');
  const keepMedia = prevModal && m && (m.type === 'video' || m.type === 'slideshow') && prevModal.dataset.key === `${m.type}:${m.file || ''}`;
  if (!keepMedia) {
    $('#modal-root').innerHTML = m ? `<div class="modal-back" data-act="backdrop">${{ trend: () => trendModal(m.url), prep: prepModal, upload: uploadModal, video: () => videoModal(m.file), slideshow: slideshowModal, sns: () => snsModal(m.key), snsList: snsListModal, calendar: calendarModal, done: () => doneModal(m.file), intro: introModal, sfxai: sfxModal, lens: () => lensModal(m.url), lensIdeas: lensIdeasModal }[m.type]()}</div>` : '';
    const nm = $('#modal-root .modal');
    if (nm && m) nm.dataset.key = `${m.type}:${m.file || ''}`;
  }
  updateStatus();
  if (state.view === 'work' && state.workTab === 5) updatePlayer();
}

/* ---------- audio / player ---------- */
let audioEl = null;
let rafId = null;

function stopAudio() {
  if (audioEl) {
    audioEl.pause();
    audioEl.onended = null;
  }
  audioEl = null;
}

function playFiles(files) {
  stopAudio();
  const queue = files.filter(Boolean);
  const next = () => {
    const f = queue.shift();
    if (!f) return stopAudio();
    audioEl = new Audio(fileUrl(f));
    audioEl.onended = next;
    audioEl.play().catch(() => toast('재생할 수 없습니다.'));
  };
  next();
}

function setPlaying(on) {
  state.playing = on;
  cancelAnimationFrame(rafId);
  const btn = document.querySelector('.player [data-act="play"]');
  if (btn) btn.textContent = on ? '⏸' : '▶';
  const voice = state.p.prepared?.voiceFile;
  if (!on) {
    if (audioEl && audioEl.dataset?.role === 'editor') audioEl.pause();
    const vid = $('#pv-video');
    if (vid) vid.pause();
    return;
  }
  if (voice) {
    if (!audioEl || audioEl.dataset?.role !== 'editor') {
      stopAudio();
      audioEl = new Audio(fileUrl(voice));
      audioEl.dataset.role = 'editor';
    }
    audioEl.currentTime = state.time;
    audioEl.play().catch(() => toast('음성을 재생할 수 없습니다.'));
  }
  updatePlayer();
  let last = performance.now();
  const loop = (now) => {
    if (audioEl && audioEl.dataset?.role === 'editor' && !audioEl.paused) state.time = audioEl.currentTime;
    else state.time += (now - last) / 1000;
    last = now;
    if (state.time >= totalDuration()) {
      state.time = 0;
      setPlaying(false);
      updatePlayer();
      return;
    }
    updatePlayer();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

function updatePlayer() {
  const t = $('#pv-time');
  if (t) t.textContent = sec2(state.time);
  const bar = $('#pv-bar');
  if (bar) bar.value = state.time;
  const cur = currentSub();
  const sub = $('#pv-sub');
  if (sub) sub.textContent = state.p.edit.sub && cur ? cur.text : '';
  const sc = sceneAt(state.time);
  const img = sc ? `url('${fileUrl(sceneThumb(sc))}')` : '';
  const el = $('#pv-img');
  if (el && el.dataset.img !== img) {
    el.style.backgroundImage = img;
    el.dataset.img = img;
  }
  const place = placeAt(state.time);
  const vid = $('#pv-video');
  if (!vid || !place?.file) return;
  const url = fileUrl(place.file);
  vid.muted = !!state.p.prepared?.voiceFile;
  if (vid.dataset.src !== url) {
    vid.src = url;
    vid.dataset.src = url;
    vid.dataset.seeking = '1';
    if (state.playing) vid.play().catch(() => {});
    vid.addEventListener('loadedmetadata', () => {
      const at = placeAt(state.time)?.inPoint || 0;
      if (Math.abs((vid.currentTime || 0) - at) < 0.08) {
        vid.dataset.seeking = '';
        if (state.playing && vid.paused) vid.play().catch(() => {});
        return;
      }
      vid.addEventListener('seeked', () => {
        vid.dataset.seeking = '';
        if (state.playing) vid.play().catch(() => {});
      }, { once: true });
      try { vid.currentTime = at; } catch { vid.dataset.seeking = ''; }
    }, { once: true });
    return;
  }
  if (vid.dataset.seeking === '1') return;
  const drift = Math.abs((vid.currentTime || 0) - place.inPoint);
  if (vid.readyState >= 1 && drift > 0.45) {
    vid.dataset.seeking = '1';
    vid.addEventListener('seeked', () => {
      vid.dataset.seeking = '';
      if (state.playing) vid.play().catch(() => {});
    }, { once: true });
    try { vid.currentTime = place.inPoint; } catch { vid.dataset.seeking = ''; }
    return;
  }
  if (state.playing) vid.play().catch(() => {});
  else if (!vid.paused) vid.pause();
}

function paintLive(t) {
  const e = state.p.edit;
  if (t?.dataset?.model === 'edit.size' || t?.dataset?.model === 'edit.font') {
    const sub = $('#pv-sub');
    if (sub) {
      sub.style.fontFamily = `'${e.font}'`;
      sub.style.fontSize = `${Math.round(e.size * (270 / 1080) * 1.1)}px`;
      sub.style.fontStyle = e.italic ? 'italic' : 'normal';
    }
  }
  if (t?.dataset?.model === 'edit.thumbTime') {
    const stage = $('.thumb-stage');
    const scn = sceneAt(Number(e.thumbTime) || 0);
    if (stage && scn) stage.style.backgroundImage = `url('${fileUrl(sceneThumb(scn))}')`;
    const lab = t.closest('.row')?.querySelector('.small');
    if (lab) lab.textContent = `위치 ${sec2(e.thumbTime || 0)}`;
  }
  if (t?.dataset?.box) {
    const box = e[t.dataset.box];
    const edge = t.dataset.box === 'topBox' ? 'top' : 'bottom';
    const el = document.querySelector(`.preview .pv-box.${edge}`);
    if (el && box) {
      const alpha = Math.round(((box.opacity ?? 80) / 100) * 255).toString(16).padStart(2, '0');
      el.style.height = `${box.height || 18}%`;
      el.style.background = `${box.color || '#000'}${alpha}`;
    }
    const names = { height: '높이', opacity: '투명', zoom: '줌' };
    const lab = t.closest('.row')?.querySelector('.small');
    if (lab && names[t.dataset.bf]) lab.textContent = `${names[t.dataset.bf]} ${box[t.dataset.bf]}%`;
  }
  if (t?.dataset?.ov) {
    const o = selectedLayer();
    const node = o ? document.querySelector(`[data-overlay="${o.id}"]`) : null;
    if (node && o?.kind === 'text') {
      node.textContent = o.text || '문구';
      node.style.fontSize = `${Math.max(11, Math.round((o.size || 72) * 270 / 1080))}px`;
      node.style.color = o.color || '#fff';
      node.style.opacity = String((o.opacity ?? 100) / 100);
      node.style.fontWeight = o.bold ? '800' : '500';
      node.style.fontStyle = o.italic ? 'italic' : 'normal';
    }
  }
}

let slideTimer;
function runSlideshow() {
  const p = state.p;
  const start = performance.now();
  if (p.prepared?.voiceFile) playFiles([p.prepared.voiceFile]);
  else if (p.audio.length === p.lines.length) playFiles(p.audio.map((a) => a.file));
  cancelAnimationFrame(slideTimer);
  const paint = (t) => {
    const img = $('#ss-img');
    if (!img || state.modal?.type !== 'slideshow') return false;
    const sc = sceneAt(t);
    img.style.backgroundImage = sc ? `url('${fileUrl(sceneThumb(sc))}')` : '';
    const sub = p.subtitles.find((s) => t >= s.start && t < s.end);
    const cap = $('#ss-sub');
    if (cap) cap.textContent = sub ? sub.text : '';
    return true;
  };
  paint(0);
  const loop = (now) => {
    const t = (now - start) / 1000;
    if (!paint(t)) return stopAudio();
    if (t < totalDuration()) slideTimer = requestAnimationFrame(loop);
  };
  slideTimer = requestAnimationFrame(loop);
}

/* ---------- data loaders ---------- */
async function loadTrends(query) {
  state.trendsLoading = true;
  state.trendsError = '';
  render();
  try {
    const r = await api('trends', { query: state.trendMode === 'keyword' ? query || state.trendQuery : '', period: state.period });
    state.trends = r.items;
    state.trendSource = r.source;
    state.trendNotice = r.notice || '';
  } catch (e) {
    state.trendsError = e.message;
  }
  state.trendsLoading = false;
  render();
}

let searchSeq = 0;
function hasHan(s) {
  return /[\u4e00-\u9fff]/.test(s || '');
}
function addUnique(list, value) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (s.length >= 2 && !list.includes(s)) list.push(s);
  return list;
}

function koSeeds(keyword, title) {
  const out = [];
  addUnique(out, keyword);
  addUnique(out, shortName(title));
  addUnique(out, String(keyword || '').replace(/\s+/g, ''));
  const words = String(keyword || '').split(/\s+/).filter((w) => w.length >= 2);
  if (words.length) addUnique(out, words[words.length - 1]);
  if (words.length >= 2) addUnique(out, words.slice(-2).join(' '));
  const titleWords = shortName(title).split(/\s+/).filter((w) => /[가-힣]/.test(w) && w.length >= 2);
  if (titleWords.length) addUnique(out, titleWords[titleWords.length - 1]);
  return out;
}

function activeZh(keyword) {
  const cur = String(state.findQ2 || '').replace(/\s+/g, ' ').trim();
  if (!hasHan(cur)) return '';
  if (state.zhManual) return cur;
  const src = String(keyword || '').trim();
  if (src && state.zhSource === src) return cur;
  return '';
}

function rememberZh(keyword, zh, manual = false) {
  state.findQ2 = zh || '';
  state.zhSource = String(keyword || '').trim();
  state.zhManual = !!manual && hasHan(zh);
}

async function zhQueriesFor(sources) {
  const out = [];
  for (const src of sources) {
    const s = String(src || '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (hasHan(s)) { addUnique(out, s); continue; }
    try {
      const z = String(await api('translateZh', s) || '').trim();
      if (hasHan(z)) addUnique(out, z);
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
    }
  }
  return out;
}

async function ensureZh() {
  const src = (state.findQ1 || '').trim();
  const cur = activeZh(src);
  if (!src) return String(state.findQ2 || '').trim();
  if (hasHan(src) && !/[가-힣A-Za-z]/.test(src)) {
    rememberZh(src, src);
    return src;
  }
  if (cur) return cur;
  state.findQ2 = '';
  const zhList = await zhQueriesFor(koSeeds(src, src));
  const zh = zhList[0] || '';
  if (hasHan(zh)) {
    rememberZh(src, zh);
    return zh;
  }
  return '';
}
const SOCIAL = ['tiktok', 'instagram', 'xhs', 'douyin', 'taobao', 'ali1688'];

async function fetchCoupang(keyword) {
  const q = String(keyword || '').trim();
  if (!q) return [];
  return api(state.aiStatus.coupang ? 'coupangSearch' : 'coupangBrowse', q);
}

function shortName(title) {
  const core = String(title || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/[,，|/]/)[0]
    .replace(/[0-9]+\s*개/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const drop = /^(블랙|화이트|그레이|에보니|클래식|세트|옵션|1개|2개)$/;
  return core.split(' ').filter((w) => w.length >= 2 && !drop.test(w)).slice(0, 4).join(' ').slice(0, 28);
}

const SOCIAL_SEARCH_PLATFORMS = ['ali1688', 'xhs', 'douyin'];

function videoIdOf(url) {
  const xhsId = noteIdOf(url);
  if (xhsId) return xhsId;
  const dy = String(url || '').match(/douyin\.com\/video\/(\d+)/);
  if (dy) return `dy_${dy[1]}`;
  const tb = String(url || '').match(/(?:item\.taobao|detail\.tmall)\.com\/.*[?&]id=(\d+)/);
  if (tb) return `tb_${tb[1]}`;
  const al = String(url || '').match(/detail\.1688\.com\/offer\/(\d+)/);
  if (al) return `al_${al[1]}`;
  const dj = String(url || '').match(/dj\.1688\.com\/ci_bb\?/);
  if (dj) return `dj_${String(url).split('#')[0]}`;
  const tk = String(url || '').match(/tiktok\.com\/.*video\/(\d+)/);
  if (tk) return `tk_${tk[1]}`;
  return String(url || '').split('?')[0];
}

function mediaKey(url) {
  const s = String(url || '').split('#')[0].split('?')[0];
  if (!s) return '';
  const tb = s.match(/cloud\.video\.taobao\.com\/play\/u\/(\d+)\/.*\/(\d+)\.mp4/i);
  if (tb) return `tbv_${tb[1]}_${tb[2]}`;
  const mp4 = s.match(/(\d{6,})\.mp4$/i);
  if (mp4) return `mp4_${mp4[1]}`;
  return s.toLowerCase();
}

function lookKey(row) {
  return String(row?.title || '').replace(/\s+/g, '').replace(/[0-9]/g, '').slice(0, 18);
}

function sameSource(a, b) {
  const idA = videoIdOf(a?.url);
  const idB = videoIdOf(b?.url);
  if (idA && idB && idA === idB) return true;
  const mA = mediaKey(a?.media);
  const mB = mediaKey(b?.media);
  if (mA && mB && mA === mB) return true;
  const tA = lookKey(a);
  const tB = lookKey(b);
  return !!(tA && tB && tA === tB);
}

async function socialForProducts(products, seq, keyword, platforms) {
  const searchPlats = platforms || SOCIAL_SEARCH_PLATFORMS;
  const kept = [];
  const seen = new Set();
  let needLogin = false;
  const picks = shuffle(products).slice(0, 8);
  for (let i = 0; i < picks.length; i++) {
    if (seq !== searchSeq) return null;
    const product = picks[i];
    const query = shortName(product.title);
    if (query.length < 2) continue;
    let zh = query;
    try {
      zh = String(await api('translateZh', query) || query).trim();
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
    }
    if (!hasHan(zh)) {
      try {
        const fromKw = String(await api('translateZh', keyword || state.findQ1 || query) || '').trim();
        if (hasHan(fromKw)) zh = fromKw;
        else {
          const override = activeZh(keyword || state.findQ1 || query);
          if (override) zh = override;
        }
      } catch (e) {
        if (/CANCELLED/.test(String(e.message))) throw e;
      }
    }
    for (const plat of searchPlats) {
      if (seq !== searchSeq) return null;
      if (kept.length >= 10) break;
      const platLabel = PRESETS.platforms.find((p) => p.id === plat)?.label || plat;
      state.findNote = `${platLabel}에서 ${query} 영상 찾는 중 (${i + 1}/${picks.length})`;
      render();
      let found;
      try {
        if (plat === 'taobao') continue;
        if (plat === 'ali1688') {
          const zhList = await zhQueriesFor([zh, ...koSeeds(query, product.title), keyword]);
          const rows = await videosFrom1688Keyword(zhList, seq, 4, keyword);
          let got1688 = 0;
          for (const cand of rows) {
            const id = videoIdOf(cand.url);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            kept.push({
              ...cand,
              platform: 'ali1688',
              coupang: [product],
              coupangName: query,
              coupangQuery: query,
            });
            got1688 += 1;
            if (got1688 >= 3 || kept.length >= 10) break;
          }
          continue;
        }
        if (plat === 'xhs' && !hasHan(zh)) continue;
        found = await api('searchSocial', plat, hasHan(zh) ? zh : query);
      } catch (e) {
        if (/CANCELLED/.test(String(e.message))) throw e;
        continue;
      }
      if (seq !== searchSeq) return null;
      if (found.needLogin && !(found.items || []).length) {
        needLogin = true;
        continue;
      }
      const items = (found.items || []).filter((v) => {
        const id = videoIdOf(v.url);
        return id && !seen.has(id);
      });
      let got = 0;
      for (const cand of items.slice(0, 12)) {
        if (seq !== searchSeq) return null;
        state.findNote = `제품만 있는 원본 고르는 중 · ${(cand.title || '').slice(0, 16)}`;
        render();
        seen.add(videoIdOf(cand.url));
        kept.push({
          ...cand,
          platform: plat,
          coupang: [product],
          coupangName: query,
          coupangQuery: query,
        });
        got += 1;
        if (got >= 3 || kept.length >= 10) break;
      }
      if (kept.length >= 10) break;
    }
    if (kept.length >= 10) break;
  }
  return { kept, needLogin };
}

async function xhsForProducts(products, seq, keyword) {
  return socialForProducts(products, seq, keyword, ['xhs']);
}

async function fillFromCoupang(keyword, seq, prev) {
  state.findNote = '쿠팡에서 제품 찾는 중';
  render();
  const products = await fetchCoupang(keyword);
  if (seq !== searchSeq) return null;
  if (!products.length) {
    state.coupangHits = [];
    state.findResults = prev;
    state.findNote = '쿠팡에서 제품을 찾지 못했습니다. 검색어를 바꿔 주세요.';
    return { showList: true, message: state.findNote, videos: [] };
  }
  const shuffled = shuffle(products);
  state.coupangHits = shuffled.slice(0, 1);
  const found = await socialForProducts(shuffled, seq, keyword);
  if (!found || seq !== searchSeq) return null;
  state.coupangHits = [];
  state.findResults = [...prev, ...found.kept];
  state.view = 'trend';
  state.trendTab = 'find';
  state.platform = 'all';
  if (keyword && !state.findQ1) state.findQ1 = keyword;
  if (found.needLogin && !found.kept.length) {
    state.findNote = '해외 플랫폼 목록이 비어 있습니다. 열린 창에서 로그인을 확인한 뒤 다시 누르세요.';
  } else if (found.kept.length) {
    state.findNote = `쿠팡에 있는 제품의 해외 영상 ${found.kept.length}개만 보여 줍니다.`;
  } else {
    state.findNote = '쿠팡 제품과 맞는 해외 영상을 찾지 못했습니다.';
  }
  return { showList: !found.kept.length, message: state.findNote, videos: found.kept };
}

async function keepCoupangVideos(videos, keyword, seq) {
  const kept = [];
  const list = (videos || []).slice(0, 8);
  for (let i = 0; i < list.length; i++) {
    if (seq !== searchSeq) return null;
    state.findNote = `쿠팡에 있는 제품 확인 중 ${i + 1}/${list.length}`;
    render();
    const v = list[i];
    const verified = await api('verifyCoupang', { title: v.title || '', keyword });
    if (seq !== searchSeq) return null;
    if (verified?.ok && verified.items?.length) {
      kept.push({
        ...v,
        coupang: verified.items,
        coupangName: verified.name || verified.items[0].title || '',
        coupangQuery: verified.query || keyword,
      });
    }
  }
  return kept;
}

const COUPANG_FILTER_PLATFORMS = ['xhs', 'douyin', 'taobao', 'ali1688'];

async function runSocialSearch(platform) {
  if (platform === 'taobao') return toast('타오바오는 보안이 강해 검색에서 뺐습니다. 1688을 사용하세요.');
  const seq = ++searchSeq;
  const src = (state.findQ1 || '').trim();
  if (!src && !state.findQ2) return toast('검색어를 입력하세요.');
  state.platform = platform;
  state.findLoading = true;
  state.findNote = '';
  render();
  try {
    let q = src;
    if (['xhs', 'douyin', 'taobao', 'ali1688'].includes(platform)) q = await ensureZh();
    if (platform === 'xhs' && !hasHan(q) && !hasHan(state.findQ2)) {
      throw new Error('샤오홍슈는 중국어 검색어가 필요합니다. 번역을 확인한 뒤 다시 누르세요.');
    }
    let r;
    if (platform === 'ali1688') {
      const zhList = await zhQueriesFor([q, ...koSeeds(src, src)]);
      if (zhList[0]) {
        rememberZh(src, zhList[0], state.zhManual && zhList[0] === q);
        q = zhList[0];
      }
      const rows = await videosFrom1688Keyword(zhList, seq);
      r = { items: rows, needLogin: false };
    } else {
      r = await api('searchSocial', platform, (hasHan(q) ? q : state.findQ2) || q);
    }
    if (seq !== searchSeq) return;
    const prev = state.findResults.filter((v) => v.platform !== platform);
    const label = PRESETS.platforms.find((p) => p.id === platform)?.label || '이 플랫폼';
    if (!COUPANG_FILTER_PLATFORMS.includes(platform)) {
      state.coupangHits = [];
      state.findResults = [...prev, ...(r.items || [])];
      state.findNote = r.needLogin ? `${label}은 로그인이나 확인 뒤에 목록이 나옵니다. 열린 창에서 마친 뒤 같은 버튼을 다시 누르세요.` : '';
    } else if (r.needLogin || !(r.items || []).length) {
      state.coupangHits = [];
      state.findResults = prev;
      state.findNote = `${label}은 로그인이나 확인 뒤에 목록이 나옵니다. 열린 창에서 마친 뒤 같은 버튼을 다시 누르세요.`;
    } else {
      const kept = await keepCoupangVideos(r.items, src || q, seq);
      if (kept === null || seq !== searchSeq) return;
      state.findResults = [...prev, ...kept];
      if (kept.length) {
        state.coupangHits = [];
        state.findNote = `쿠팡에 있는 제품의 ${label} 영상 ${kept.length}개만 보여 줍니다.`;
      } else {
        const filled = await fillFromCoupang(src || q, seq, prev);
        if (!filled || seq !== searchSeq) return;
      }
    }
  } catch (e) {
    if (seq !== searchSeq) return;
    if (/CANCELLED/.test(e.message)) state.findNote = '';
    else state.findNote = e.message;
  }
  state.findLoading = false;
  if (seq === searchSeq) render();
}
async function runMatch() {
  const src = (state.findQ1 || '').trim();
  if (!src && !state.findQ2) return toast('검색어를 입력하세요.');
  const seq = ++searchSeq;
  state.platform = 'all';
  state.findLoading = true;
  state.findNote = '';
  state.pairs = [];
  render();
  try {
    const zh = await ensureZh();
    const r = await api('matchSocial', src || zh, zh || state.findQ2);
    if (seq !== searchSeq) return;
    const socialItems = r.social || r.xhs || [];
    if (r.needLogin || !socialItems.length) {
      state.findResults = [...(r.youtube || [])];
      state.pairs = [];
      state.coupangHits = [];
      state.findNote = '해외 플랫폼 목록이 비어 있습니다. 열린 창에서 로그인을 확인한 뒤 비교를 다시 누르세요.';
    } else {
      const kept = await keepCoupangVideos(socialItems, src || zh, seq);
      if (kept === null || seq !== searchSeq) return;
      const urls = new Set(kept.map((v) => v.url));
      state.findResults = [...(r.youtube || []), ...kept];
      state.pairs = (r.pairs || []).filter((p) => urls.has(p.xhs?.url)).map((p) => {
        const hit = kept.find((v) => v.url === p.xhs.url);
        return hit ? { ...p, xhs: { ...p.xhs, coupang: hit.coupang, coupangName: hit.coupangName, coupangQuery: hit.coupangQuery } } : p;
      });
      if (kept.length) {
        state.coupangHits = [];
        state.findNote = state.pairs.length
          ? `쿠팡에 있는 제품의 해외 영상 ${kept.length}개입니다. 거의 같은 영상 ${state.pairs.length}쌍입니다.`
          : `쿠팡에 있는 제품의 해외 영상 ${kept.length}개만 보여 줍니다.`;
      } else {
        const filled = await fillFromCoupang(src || state.findQ1, seq, r.youtube || []);
        if (!filled || seq !== searchSeq) return;
      }
    }
  } catch (e) {
    if (seq !== searchSeq) return;
    if (!/CANCELLED/.test(e.message)) state.findNote = e.message;
  }
  state.findLoading = false;
  if (seq === searchSeq) render();
}
async function runSearch() {
  if (SOCIAL.includes(state.platform)) return runSocialSearch(state.platform);
  if (!state.findQ1) return;
  const seq = ++searchSeq;
  state.findLoading = true;
  state.findNote = '';
  render();
  const zhJob = ensureZh().then((zh) => {
    if (seq !== searchSeq || !zh) return;
    render();
  }).catch((e) => {
    if (seq === searchSeq) toast(`중국어 번역 실패: ${e.message}`);
  });
  try {
    const r = await api('searchVideos', state.findQ1);
    if (seq !== searchSeq) return;
    state.findResults = r;
  } catch (e) {
    if (seq !== searchSeq) return;
    toast(`검색 실패: ${e.message}`);
  }
  await zhJob;
  state.findLoading = false;
  if (seq === searchSeq) render();
}

async function loadVoices(provider, force = false) {
  if (!force && state.voices[provider] && state.voices[provider] !== 'loading') return;
  state.voices[provider] = 'loading';
  try {
    state.voices[provider] = await api('voices', provider);
  } catch (e) {
    state.voices[provider] = { error: e.message };
  }
  if (provider === 'eleven') state.credits = await api('credits', 'eleven').catch(() => null);
  render();
}

async function refreshMeta() {
  state.settings = await api('getSettings');
  state.tools = await api('toolsStatus');
  state.aiStatus = await api('aiStatus');
  state.hookStatus = await api('hookStatus').catch(() => state.hookStatus);
}

async function installTools(force = false) {
  await task('필수 도구 설치 중 (yt-dlp, FFmpeg)', () => api('installTools', force), '필수 도구 설치 완료');
  state.tools = await api('toolsStatus');
  render();
}

function runDownload() {
  if (!state.p.videos.length) return toast('먼저 내 PC 영상을 올리거나, 제품찾기에서 추가하거나, 링크를 붙여넣으세요.');
  return task('영상 다운로드 중', async () => {
    const p = state.p;
    let failed = 0;
    for (let i = 0; i < p.videos.length; i++) {
      const v = p.videos[i];
      if (v.done) continue;
      state.status.text = `영상 다운로드 중 (${i + 1}/${p.videos.length})`;
      updateStatus();
      try {
        Object.assign(v, await api('download', p.name, v, i), { done: true, error: '' });
      } catch (e) {
        if (/CANCELLED/.test(e.message)) throw e;
        v.error = /이용할 수 없|not available|unavailable|private|removed/i.test(e.message) ? '이용할 수 없는 영상' : '다운로드 실패';
        failed++;
      }
      render();
    }
    p.analyzed = false;
    if (!p.videos.some((v) => v.done)) throw new Error('모든 영상 다운로드에 실패했습니다. 다른 영상을 추가하세요.');
    return failed;
  }, (failed) => `영상 다운로드 완료 — ${state.p.videos.filter((v) => v.done).length}개${failed ? ` (실패 ${failed}개는 빨간 표시를 확인하고 삭제하세요)` : ''}`);
}

function markStep(text) {
  if (state.status) {
    state.status.text = text;
    pushStatusLog(text);
  }
  updateStatus();
}

async function pullPair(pair) {
  const p = state.p;
  if (!pair?.xhs?.url) throw new Error('소셜 영상이 없는 쌍입니다.');
  if (pair.youtube?.url) {
    markStep('유튜브 영상 분석 중');
    try {
      const style = await api('analyzeStyle', pair.youtube.url);
      state.analysis[pair.youtube.url] = { info: style.info, transcript: style.transcript, analysis: style.analysis };
      addStyle(style);
      setProductFromAnalysis(pair.youtube.url);
    } catch (e) {
      if (/CANCELLED/.test(e.message)) throw e;
    }
  }
  const video = {
    ...pair.xhs, platform: pair.xhs.platform || platformOf(pair.xhs.url) || 'xhs', done: false,
    refUrl: pair.youtube?.url || '', refTitle: pair.youtube?.title || '', refImg: pair.youtube?.img || '',
  };
  if (!p.videos.some((v) => v.url === video.url)) {
    if (p.videos.length >= 8) throw new Error('최대 8개까지 넣을 수 있습니다.');
    p.videos.push(video);
  }
  if (p.name === '새 프로젝트' && p.product?.name) p.name = p.product.name.slice(0, 30);
}

async function ensureSocialVideo(pairIndex) {
  const p = state.p;
  if (pairIndex >= 0 && state.pairs[pairIndex]) {
    await pullPair(state.pairs[pairIndex]);
    return;
  }
  const isSocialPlat = (v) => COUPANG_FILTER_PLATFORMS.includes(v.platform || platformOf(v.url));
  if (p.videos.some(isSocialPlat)) return;
  const added = state.added.filter(isSocialPlat);
  if (added.length) {
    added.slice(0, 8 - p.videos.length).forEach((v) => p.videos.push({ ...v, platform: v.platform || platformOf(v.url) || 'xhs', done: false }));
    state.added = state.added.filter((v) => !isSocialPlat(v));
    if (state.selected) setProductFromAnalysis(state.selected.url);
    if (p.name === '새 프로젝트' && p.product?.name) p.name = p.product.name.slice(0, 30);
    return;
  }
  if (state.pairs[0]) {
    await pullPair(state.pairs[0]);
    return;
  }
  throw new Error('해외 플랫폼 영상을 먼저 고르거나 링크를 넣으세요.');
}

async function ensureXhs(pairIndex) {
  return ensureSocialVideo(pairIndex);
}

function noteIdOf(url) {
  const m = String(url || '').match(/\/(?:explore|discovery\/item|search_result)\/([0-9a-f]{16,})/i);
  return m ? m[1].toLowerCase() : '';
}

async function usedVideoIds() {
  const ids = new Set();
  const take = (videos) => (videos || []).forEach((v) => {
    const id = videoIdOf(v.url);
    if (id) ids.add(id);
  });
  take(state.p?.videos);
  const list = await api('listProjects').catch(() => []);
  for (const item of list || []) {
    const saved = await api('loadProject', item.name).catch(() => null);
    take(saved?.videos);
  }
  return ids;
}
function usedNoteIds() { return usedVideoIds(); }

async function pickVerifiedSource(keyword, used, pairIndex) {
  if (pairIndex >= 0 && state.pairs[pairIndex]) {
    const chosen = state.pairs[pairIndex];
    if (used.has(videoIdOf(chosen?.xhs?.url))) throw new Error('이 영상은 이미 만들었습니다. 다른 영상을 고르세요.');
    if (chosen.xhs?.coupang?.length) {
      return {
        pair: chosen,
        verified: { ok: true, name: chosen.xhs.coupangName || '', query: chosen.xhs.coupangQuery || keyword, items: chosen.xhs.coupang, why: '' },
      };
    }
    markStep('쿠팡에서 같은 제품 확인 중');
    const verified = await api('verifyCoupang', { title: chosen?.xhs?.title || '', keyword: keyword || chosen?.xhs?.title || '' });
    if (!verified.ok) throw new Error(`쿠팡에 같은 제품이 없어 영상을 만들지 않았습니다. ${verified.why || ''}`.trim());
    return { pair: chosen, verified };
  }
  const key = String(keyword || '').replace(/\s+/g, '');
  const ready = state.findResults.filter((v) => {
    if (!COUPANG_FILTER_PLATFORMS.includes(v.platform) || !v.coupang?.length || !videoIdOf(v.url) || used.has(videoIdOf(v.url))) return false;
    const q = String(v.coupangQuery || v.coupangName || '').replace(/\s+/g, '');
    return !key || !q || q.includes(key) || key.includes(q);
  });
  if (ready.length) {
    const next = pickRandom(ready);
    const rest = ready.filter((v) => v !== next);
    return { video: next, candidates: [next, ...rest].slice(0, 5), verified: { ok: true, name: next.coupangName || '', query: next.coupangQuery || keyword, items: next.coupang, why: '' } };
  }
  if (state.coupangHits.length) {
    const found = await socialForProducts(shuffle(state.coupangHits), searchSeq, keyword);
    if (found?.kept?.length) {
      const kept = found.kept.filter((v) => videoIdOf(v.url) && !used.has(videoIdOf(v.url)));
      const next = pickRandom(kept);
      if (next) return { video: next, candidates: kept.slice(0, 5), verified: { ok: true, name: next.coupangName || '', query: next.coupangQuery || keyword, items: next.coupang, why: '' } };
    }
  }
  if (!keyword) throw new Error('새 영상을 만들 검색어가 없습니다. 제품찾기에 검색어를 입력한 뒤 다시 누르세요.');
  if (!state.findQ1) state.findQ1 = keyword;
  markStep('쿠팡에서 제품 있는지 확인 중');
  const filled = await fillFromCoupang(keyword, searchSeq, state.findResults.filter((v) => !COUPANG_FILTER_PLATFORMS.includes(v.platform)));
  if (!filled) return { showList: true, message: '검색이 다른 작업으로 바뀌었습니다.' };
  const pool = (filled.videos || []).filter((v) => videoIdOf(v.url) && !used.has(videoIdOf(v.url)));
  const next = pickRandom(pool);
  if (next) return { video: next, candidates: pool.slice(0, 5), verified: { ok: true, name: next.coupangName || '', query: next.coupangQuery || keyword, items: next.coupang, why: '' } };
  return { showList: true, message: filled.message || '쿠팡에 같은 제품이 없어 영상을 만들지 않았습니다.' };
}

function narrationLength(n) {
  return [25, 30, 35, 40].includes(+n) ? +n : 30;
}

function voiceSeconds(audio) {
  return (audio || []).reduce((a, x) => a + Number(x.dur || 0), 0);
}

function scriptContext(p, extra = {}) {
  const style = allStyles().find((s) => s.key === p.styleKey) || allStyles()[0];
  return {
    length: narrationLength(p.length),
    instruction: p.instruction,
    product: productContext(),
    productName: p.product?.name || p.name,
    sources: p.videos.map((v, i) => `소스${i + 1}: ${v.title}${v.summary ? ` / ${v.summary}` : ''}`).join('\n'),
    style: `${style?.title || ''}\n${Object.entries(style?.summary || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}`,
    styleTranscript: style?.transcript || '',
    ...extra,
  };
}

function ensureTts(p) {
  if (p.tts?.provider === 'typecast' && state.settings?.typecast) return;
  if (p.tts?.provider === 'sapi' || p.tts?.provider === 'openai' || p.tts?.provider === 'eleven') return;
  p.tts = {
    provider: 'gemini',
    voice: /Kore|Zephyr|Leda|Aoede|Sulafat|Achird|Puck|Charon|Fenrir|Algieba|Gacrux|Schedar/i.test(p.tts?.voice || '') ? p.tts.voice : 'Kore',
    model: p.tts?.model === 'gemini-3.8-flash-tts' ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts',
    emotion: 'normal',
    speed: p.tts?.speed || 'brisk',
  };
}

async function synthLines(p) {
  ensureTts(p);
  const tries = [];
  if (p.tts.provider === 'typecast') tries.push('typecast', 'gemini', 'sapi');
  else if (p.tts.provider === 'gemini') tries.push('gemini', 'typecast', 'sapi');
  else tries.push(p.tts.provider, 'sapi');
  let last = null;
  for (const provider of [...new Set(tries)]) {
    try {
      if (provider !== p.tts.provider) {
        if (provider === 'gemini') {
          if (!state.settings?.gemini) continue;
          p.tts = { provider: 'gemini', voice: 'Kore', model: 'gemini-3.8-flash-lite-tts', emotion: 'normal', speed: p.tts.speed || 'brisk' };
        }
        if (provider === 'typecast') {
          if (!state.settings?.typecast) continue;
          p.tts = { provider: 'typecast', voice: '', model: 'ssfm-v21', emotion: 'normal', speed: p.tts.speed || 'brisk' };
        }
        if (provider === 'sapi') {
          const voices = await api('voices', 'sapi');
          if (!voices?.length) continue;
          p.tts = { provider: 'sapi', voice: voices[0].id, model: '', emotion: 'normal', speed: p.tts.speed || 'brisk' };
        }
      }
      return await api('genVoice', p.name, p.lines, p.tts);
    } catch (e) {
      if (/CANCELLED/.test(e.message)) throw e;
      last = e;
    }
  }
  throw last || new Error('음성을 만들지 못했습니다.');
}

async function speakLines(p) {
  p.length = narrationLength(p.length);
  if (!p.tts.speed) p.tts.speed = 'brisk';
  ensureTts(p);
  p.audio = await synthLines(p);
  if (voiceSeconds(p.audio) < 25) {
    const script = await api('genScript', scriptContext(p, {
      length: 32,
      rewrite: p.lines.join('\n'),
      spoken: voiceSeconds(p.audio),
    }));
    const lines = withHookLine(script.lines, reelHookTitle(p.edit));
    if (lines.join('').length > p.lines.join('').length + 20) {
      p.lines = lines;
      p.audio = await synthLines(p);
    }
  }
  if (voiceSeconds(p.audio) > 40) p.audio = await api('fitVoice', p.name, p.audio);
}

async function judgeSoft(input) {
  try {
    return await api('judgeSource', input);
  } catch (e) {
    if (/CANCELLED/.test(String(e.message))) throw e;
    return { ok: true, person: false, chinese: false };
  }
}

async function pickUsableSource(pool, p) {
  let login = false;
  for (let n = 0; n < pool.length; n++) {
    const cand = pool[n];
    if (!cand?.url) continue;
    markStep('원본 영상 받는 중');
    p.videos = [{ ...cand, platform: cand.platform || platformOf(cand.url), done: false }];
    try {
      Object.assign(p.videos[0], await api('download', p.name, p.videos[0], 0), { done: true, error: '' });
    } catch (e) {
      if (/CANCELLED/.test(e.message)) throw e;
      if (/XHS_LOGIN/.test(e.message)) { login = true; continue; }
      continue;
    }
    const row = p.videos[0];
    if (!row.file) continue;
    let capHas = false;
    try {
      capHas = !!(await api('probeCaption', row.file))?.has;
    } catch (e) {
      if (/CANCELLED/.test(e.message)) throw e;
    }
    return { ...row, burnedCaption: capHas, coupang: cand.coupang || row.coupang };
  }
  if (login) throw new Error('해외 플랫폼 로그인이 필요합니다. 열린 창에서 로그인한 뒤 다시 누르세요.');
  return null;
}

async function downloadPool(pool, p) {
  const out = (p.videos || []).filter((v) => v?.file && v.done);
  let login = false;
  const MAX = 8;
  state.view = 'work';
  state.workTab = 1;
  p.videos = [...out];
  render();
  for (let i = 0; i < pool.length && out.length < MAX; i++) {
    const cand = pool[i];
    if (!cand?.url) continue;
    if (out.some((x) => sameSource(x, cand))) continue;
    markStep(`원본 받는 중 (${out.length + 1}/${MAX})`);
    const row = { ...cand, platform: cand.platform || platformOf(cand.url), done: false, error: '' };
    p.videos = [...out, row];
    render();
    try {
      Object.assign(row, await api('download', p.name, row, out.length), { done: true, error: '' });
    } catch (e) {
      if (/CANCELLED/.test(e.message)) throw e;
      if (/XHS_LOGIN/.test(e.message)) { login = true; continue; }
      markStep(`다운 실패 · ${(cand.title || cand.url || '').slice(0, 28)} · ${e.message}`);
      p.videos = [...out];
      render();
      continue;
    }
    if (!row.file) {
      p.videos = [...out];
      render();
      continue;
    }
    if (out.some((x) => sameSource(x, row) || (x.size && row.size && x.size === row.size && Math.abs((x.dur || 0) - (row.dur || 0)) < 0.4))) {
      markStep(`같은 영상이라 건너뜀 · ${(cand.title || cand.url || '').slice(0, 28)}`);
      p.videos = [...out];
      render();
      continue;
    }
    out.push(row);
    p.videos = [...out];
    if (out.length === 1) p.pick = 0;
    render();
  }
  p.videos = out;
  p.analyzed = false;
  p.scenes = [];
  if (!out.length && login) throw new Error('해외 플랫폼 로그인이 필요합니다. 열린 창에서 로그인한 뒤 다시 누르세요.');
  return out;
}

function filledLines(p) {
  return (p?.lines || []).filter((x) => String(x || '').trim());
}

function voiceReady(p) {
  return !!(p.ttsReady && filledLines(p).length && Array.isArray(p.audio) && p.audio.length === p.lines.length && p.audio.every((a) => a?.file));
}

function scenesReady(p) {
  return !!(filledLines(p).length && Array.isArray(p.scenes) && p.scenes.length === p.lines.length && p.scenes.every((s) => p.videos[s.src]?.scenes?.[s.clip]));
}

function oneClickResumeAt(p) {
  if (!p?.videos?.some((v) => v?.file) || p.exported) return '';
  if (!(p.analyzed && p.videos.some((v) => v.scenes?.length))) return '';
  if (!filledLines(p).length) return '대본 생성';
  if (!voiceReady(p)) return '음성 생성';
  if (!scenesReady(p)) return '장면 매칭';
  if (!p.prepared?.voiceFile) return '편집 준비';
  return '영상 내보내기';
}

function resetOneClick(p) {
  p.analyzed = false;
  p.scenes = [];
  p.lines = [];
  p.audio = [];
  p.ttsReady = false;
  p.prepared = null;
  p.exported = null;
  p.subtitles = [];
}

const stepBusy = (msg) => /시간 초과|비어|503|429|502|504|UNAVAILABLE|high demand|overloaded/i.test(String(msg || ''));

async function pauseStep(sec) {
  for (let i = 0; i < sec * 2; i++) {
    if (state.stop) throw new Error('CANCELLED');
    await new Promise((r) => setTimeout(r, 500));
  }
  if (state.stop) throw new Error('CANCELLED');
}

async function retryStep(label, fn) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      markStep(i ? `${label} 같은 단계에서 다시 시작 (${i + 1}/3)` : label);
      return await fn();
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
      last = e;
      if (!stepBusy(e.message) || i === 2) throw e;
      const sec = i === 0 ? 10 : 20;
      markStep(`${label}이 잠깐 막혀 ${sec}초 후 같은 단계에서 다시 시작합니다`);
      await pauseStep(sec);
    }
  }
  throw last;
}

async function produceFromPicked() {
  const p = state.p;
  const idx = Math.max(0, Math.min((p.videos || []).length - 1, +p.pick || 0));
  const chosen = p.videos[idx];
  if (!chosen?.file) throw new Error('미리보기로 확인한 뒤, 쓸 영상을 선택하세요.');
  const same = p.videos.length === 1 && p.videos[0]?.file === chosen.file;
  p.videos = [chosen];
  p.pick = 0;
  if (!same || p.exported) resetOneClick(p);
  p.length = 30;
  if (!p.tts.speed) p.tts.speed = 'brisk';
  state.view = 'work';
  state.workTab = 1;
  render();
  return finishOneClick(p);
}

async function finishOneClick(p) {
  const resumeAt = oneClickResumeAt(p);
  if (resumeAt) markStep(`${resumeAt}부터 이어서 진행`);

  if (p.coupang?.length && !p.coupang[0]?.partner) {
    await retryStep('쿠팡 파트너스 링크 만드는 중', async () => {
      p.coupang = await pickOnePartner(p.coupang);
    });
    autosave();
  }

  if (!p.analyzed || !p.videos.some((v) => v.scenes?.length)) {
    state.workTab = 1;
    await retryStep('소스 영상 분석 중', async () => {
      const ready = p.videos.filter((v) => v.file);
      const analyzed = await api('analyzeSources', p.name, ready.map((v) => ({ file: v.originalFile || v.file, local: !!v.local, forceClean: !v.cleaned })));
      analyzed.forEach((x, i) => Object.assign(ready[i], x));
      applyCaptionSubY(p);
      p.analyzed = true;
      p.scenes = [];
    });
    autosave();
  }
  if (!p.product?.name) {
    const titled = p.videos.find((v) => v.title && !/^https?:/.test(v.title));
    if (titled) p.product = { name: titled.title.slice(0, 40), features: [], kw: { ko: [titled.title.slice(0, 24)] }, flow: '' };
    else if (p.cpKeyword || p.name) p.product = { name: String(p.cpKeyword || p.name).slice(0, 40), features: [], kw: { ko: [String(p.cpKeyword || p.name).slice(0, 24)] }, flow: '' };
  }
  if (p.name === '새 프로젝트' && p.product?.name) p.name = p.product.name.slice(0, 30);

  if (!filledLines(p).length) {
    state.workTab = 2;
    await retryStep('대본 생성 중', async () => {
      p.length = narrationLength(p.length);
      if (!p.tts.speed) p.tts.speed = 'brisk';
      await fillReelHook(p.edit, p.product?.name || p.cpKeyword || p.name);
      const script = await api('genScript', scriptContext(p));
      p.lines = withHookLine(script.lines, reelHookTitle(p.edit));
      if (!filledLines(p).length) throw new Error('대본을 만들지 못했습니다.');
      p.audio = [];
      p.ttsReady = false;
      p.prepared = null;
      p.scenes = [];
    });
    autosave();
  }

  if (!voiceReady(p)) {
    state.workTab = 2;
    await retryStep('음성 생성 중', async () => {
      p.prepared = null;
      await speakLines(p);
      p.ttsReady = true;
      buildSubtitles();
    });
    autosave();
  } else if (!p.subtitles?.length) buildSubtitles();

  if (!scenesReady(p)) {
    state.workTab = 3;
    await retryStep('장면 매칭 중', async () => {
      let scenes = heuristicScenes();
      try {
        const matches = await api('aiMatch', p.lines, p.videos.map((v) => (v.scenes || []).map((s) => s.label)));
        if (Array.isArray(matches)) {
          scenes = scenes.map((s, i) => {
            const m = matches.find((x) => +x.line === i);
            return m && p.videos[m.src]?.scenes?.[m.clip] ? { ...s, src: +m.src, clip: +m.clip } : s;
          });
        }
      } catch (e) {
        if (/CANCELLED/.test(e.message)) throw e;
        if (stepBusy(e.message)) throw e;
      }
      p.scenes = scenes;
      buildSubtitles();
    });
    autosave();
  }

  if (!p.prepared?.voiceFile) {
    await retryStep('편집 준비 중', async () => {
      p.prepared = await api('prepareEdit', p.name, p.audio, p.edit.prep.silence || 'none');
      buildSubtitles();
    });
    autosave();
  }

  if (!p.exported) {
    state.workTab = 5;
    await retryStep('영상 내보내는 중', async () => {
      ensureTimeline();
      applyReelHook(p.edit);
      const scenePayload = p.scenes.map((s) => {
        const v = p.videos[s.src];
        const c = v?.scenes?.[s.clip];
        return { file: v?.file, start: c?.start || 0, dur: s.dur, hasAudio: !!v?.hasAudio };
      });
      if (scenePayload.some((s) => !s.file)) throw new Error('장면에 연결된 소스 영상이 없습니다.');
      p.exported = await api('render', p.name, {
        scenes: scenePayload, subs: p.subtitles, edit: coverEdit(p, p.edit), voiceFile: p.prepared?.voiceFile || null,
        header: headerPayload(p),
        templateImage: p.edit.showTemplateImage ? p.edit.templateImage : null,
        bgm: p.edit.bgm, sfx: p.edit.sfx, keepAudio: p.edit.prep.keepAudio || !p.prepared?.voiceFile, voiceOn: !!(p.edit.voice && p.prepared?.voiceFile), subOn: p.edit.sub,
      });
    });
    autosave();
  }
  let coupangNote = p.coupang?.[0]?.url ? (p.coupang[0].partner ? ', 파트너스 링크 생성' : ', 쿠팡 1개') : '';
  if (!p.coupang?.length) {
    try {
      markStep('쿠팡 상품 검색 중');
      const kw = p.cpKeyword || p.product?.kw?.ko?.[0] || p.product?.name || p.name;
      p.cpKeyword = kw;
      const rows = await api(state.aiStatus.coupang ? 'coupangSearch' : 'coupangBrowse', kw);
      markStep('쿠팡 파트너스 링크 만드는 중');
      p.coupang = await pickOnePartner(rows);
      coupangNote = p.coupang[0]?.partner ? ', 파트너스 링크 생성' : (p.coupang.length ? ', 쿠팡 1개' : ', 쿠팡 없음');
    } catch (e) {
      if (/CANCELLED/.test(e.message)) throw e;
      coupangNote = ', 쿠팡 검색 실패';
    }
  }
  state.workTab = 6;
  state.modal = { type: 'done', file: p.exported };
  return `원클릭 생성 완료 — ${p.lines.length}문장${coupangNote}`;
}

async function makeOneClick(d) {
  const pairIndex = d && d.i !== undefined && d.i !== '' ? +d.i : -1;
  if (pairIndex < 0 && state.p?.videos?.some((v) => v.file)) return produceFromPicked();
  const keyword = (state.findQ1 || '').trim() || state.p?.cpKeyword || state.p?.product?.kw?.ko?.[0] || state.p?.product?.name || '';
  const used = await usedNoteIds();
  const picked = await pickVerifiedSource(keyword, used, pairIndex);
  if (picked.showList) return picked.message;
  if (state.p?.videos?.length && state.p.name && state.p.name !== '새 프로젝트') await api('saveProject', state.p).catch(() => {});
  state.p = newProject();
  state.p.length = 30;
  state.p.tts.speed = 'brisk';
  state.added = [];
  state.view = 'work';
  state.workTab = 1;
  render();

  if (picked.pair) {
    await pullPair(picked.pair);
  } else {
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const label = picked.verified.name || keyword;
    state.p.videos = [{ ...picked.video, platform: picked.video.platform || platformOf(picked.video.url) || 'xhs', done: false }];
    state.p.product = { name: label.slice(0, 40), features: [], kw: { ko: [(picked.verified.query || keyword).slice(0, 24)] }, flow: '' };
    state.p.cpKeyword = picked.verified.query || keyword;
    if (!state.p.searchKo) state.p.searchKo = state.p.cpKeyword;
    state.p.name = `${label.slice(0, 16)} ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
  }
  state.p.coupang = picked.verified.items || picked.video?.coupang || [];
  state.p.cpKeyword = picked.verified.query || state.p.cpKeyword || keyword;
  if (picked.verified.name) {
    state.p.product = {
      ...(state.p.product || { features: [], kw: { ko: [] }, flow: '' }),
      name: picked.verified.name.slice(0, 40),
      kw: { ...(state.p.product?.kw || {}), ko: [picked.verified.query || picked.verified.name].filter(Boolean) },
    };
  }
  const p = state.p;
  if (!p.videos.some((v) => v.file || v.url)) throw new Error('새 해외 영상을 찾지 못했습니다.');
  render();

  const extras = (picked.candidates || []).filter((v) => v?.url && videoIdOf(v.url) !== videoIdOf(p.videos[0]?.url));
  const pool = [p.videos[0], ...extras].filter((v) => v?.url);
  let chosen = await pickUsableSource(pool, p);
  if (!chosen?.file && keyword) {
    markStep('더 많은 해외 원본을 찾는 중');
    const more = await socialForProducts(p.coupang?.length ? p.coupang : [{ title: keyword }], searchSeq, keyword);
    const extraPool = (more?.kept || []).filter((v) => v?.url && !pool.some((x) => videoIdOf(x.url) === videoIdOf(v.url)));
    if (extraPool.length) chosen = await pickUsableSource(extraPool, p);
  }
  if (!chosen?.file && keyword) {
    markStep('유튜브에서 같은 제품 원본을 찾는 중');
    try {
      const yts = await api('searchVideos', keyword);
      chosen = await pickUsableSource((yts || []).slice(0, 10), p);
    } catch (e) {
      if (/CANCELLED/.test(e.message)) throw e;
    }
  }
  if (!chosen?.file) throw new Error('쓸 수 있는 원본 영상을 받지 못했습니다. 해외 플랫폼 로그인 창을 확인한 뒤 다시 누르세요.');
  p.videos = [chosen];
  if (chosen.coupang?.length) p.coupang = chosen.coupang;
  return finishOneClick(p);
}

function keywordFromCoupangUrl(raw) {
  try {
    const href = /https?:\/\//i.test(raw) ? raw : `https://${String(raw).replace(/^\/+/, '')}`;
    return (new URL(href).searchParams.get('q') || '').trim();
  } catch {
    return '';
  }
}

function isShopMp4(href) {
  return href && (/\.(mp4|m3u8)(\?|$)/i.test(href) || /cloud\.video\.taobao|cloudvideocdn|video\.alicdn|xhscdn|sns-video/i.test(href));
}

async function withoutZhThumbs(items, seq) {
  const imgs = [...new Set(items.map((it) => String(it.img || '').trim()).filter((u) => /^https?:\/\//i.test(u)))];
  if (!imgs.length) return items;
  markStep(`썸네일 중국어 확인 중 · ${imgs.length}장`);
  let bad = [];
  try {
    bad = (await api('thumbZh', imgs)) || [];
  } catch (e) {
    if (/CANCELLED/.test(String(e.message))) throw e;
    return items;
  }
  if (seq !== searchSeq) return [];
  const skip = new Set(bad);
  const kept = items.filter((it) => !skip.has(String(it.img || '').trim()));
  const dropped = items.length - kept.length;
  if (dropped) markStep(`썸네일 중국어 ${dropped}개 제외`);
  return kept;
}

function videoHit(raw) {
  if (!raw) return { url: '', poster: '' };
  if (typeof raw === 'string') return { url: raw, poster: '' };
  return { url: String(raw.url || ''), poster: String(raw.poster || '') };
}

async function videoThumbHasZh(poster, mediaUrl) {
  const cover = String(poster || '').trim();
  if (/^https?:\/\//i.test(cover)) {
    try {
      const bad = (await api('thumbZh', [cover])) || [];
      if (bad.includes(cover)) return true;
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
    }
  }
  const href = String(mediaUrl || '').trim();
  if (!/^https?:\/\//i.test(href) || /\.m3u8(\?|$)/i.test(href)) return false;
  try {
    return !!(await api('videoFrameZh', href));
  } catch (e) {
    if (/CANCELLED/.test(String(e.message))) throw e;
    return false;
  }
}

async function videosFrom1688Keyword(zhOrList, seq, want = 8, sourceKeyword = '') {
  const queries = [...new Set((Array.isArray(zhOrList) ? zhOrList : [zhOrList]).map((s) => String(s || '').trim()).filter(hasHan))];
  const tried = new Set(queries);
  const withVideo = [];
  const seen = new Set();
  const goal = Math.max(want, 6);
  let extraRounds = 0;
  for (let qi = 0; qi < queries.length && withVideo.length < goal; qi++) {
    if (seq !== searchSeq) return withVideo;
    const q = queries[qi];
    const before = withVideo.length;
    for (let page = 1; page <= 4 && withVideo.length < goal; page++) {
      if (seq !== searchSeq) return withVideo;
      markStep(page === 1
        ? `1688에서 "${q}" 상품 검색 중 · 영상 ${withVideo.length}/${goal}`
        : `1688 "${q}" ${page}페이지 · 영상 ${withVideo.length}/${goal}`);
      let products = [];
      try {
        const r = await api('searchSocial', 'ali1688', q, page);
        products = (r.items || []).filter((row) => /detail\.1688\.com\/offer\/\d+/.test(row.url || ''));
      } catch (e) {
        if (/CANCELLED|접속 이상/.test(e.message)) throw e;
        break;
      }
      const unique = [];
      for (const row of products) {
        const id = videoIdOf(row.url);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        unique.push({ ...row, platform: 'ali1688' });
      }
      if (!unique.length) break;
      unique.sort((a, b) => Number(!!b.video) - Number(!!a.video));
      for (let i = 0; i < unique.length && withVideo.length < goal; i++) {
        if (seq !== searchSeq) return withVideo;
        const item = unique[i];
        markStep(`1688 상품 영상 확인 중 (${withVideo.length + 1}/${goal}) · ${q}`);
        if (withVideo.length || i) await new Promise((ok) => setTimeout(ok, 900));
        try {
          const hit = videoHit(await api('grabSocialVideo', item.url, 'ali1688'));
          if (!isShopMp4(hit.url)) continue;
          markStep(`영상 썸네일 확인 중 · ${(item.title || q).slice(0, 18)}`);
          if (await videoThumbHasZh(hit.poster, hit.url)) {
            markStep(`영상 썸네일 중국어라 건너뜀 · ${(item.title || item.url || '').slice(0, 24)}`);
            continue;
          }
          const row = { ...item, video: true, media: hit.url, img: hit.poster || item.img };
          if (withVideo.some((x) => sameSource(x, row))) continue;
          withVideo.push(row);
        } catch (e) {
          if (/CANCELLED|접속 이상/.test(e.message)) throw e;
        }
      }
    }
    const needMore = withVideo.length < 6 && (withVideo.length === before || qi === queries.length - 1);
    if (needMore && sourceKeyword && extraRounds < 2) {
      extraRounds += 1;
      markStep(`"${q}"에서 영상이 부족합니다 · "${sourceKeyword}" 관련 중국어 검색어 만드는 중`);
      let more = [];
      try {
        more = await api('relatedZh', sourceKeyword, [...tried]);
      } catch (e) {
        if (/CANCELLED/.test(String(e.message))) throw e;
      }
      for (const s of more || []) {
        if (tried.has(s)) continue;
        tried.add(s);
        queries.push(s);
      }
    }
  }
  return withVideo;
}

async function videosFromXhsKeyword(zhOrList, seq, want = 6) {
  const queries = [...new Set((Array.isArray(zhOrList) ? zhOrList : [zhOrList]).map((s) => String(s || '').trim()).filter(hasHan))];
  const withVideo = [];
  const seen = new Set();
  for (const q of queries) {
    if (seq !== searchSeq || withVideo.length >= want) break;
    markStep(`샤오홍슈에서 "${q}" 영상 검색 중`);
    let items = [];
    try {
      const r = await api('searchSocial', 'xhs', q);
      items = r.items || [];
    } catch (e) {
      if (/CANCELLED/.test(e.message)) throw e;
      if (/XHS_LOGIN/.test(e.message)) throw e;
      continue;
    }
    const clean = await withoutZhThumbs(items, seq);
    if (seq !== searchSeq) return withVideo;
    for (const it of clean) {
      if (seq !== searchSeq || withVideo.length >= want) break;
      const id = videoIdOf(it.url);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      markStep(`샤오홍슈 영상 확인 중 (${withVideo.length + 1}/${want})`);
      try {
        const href = await api('grabSocialVideo', it.url, 'xhs');
        if (!isShopMp4(href) && !/xhscdn|sns-video/i.test(href || '')) continue;
        if (!href) continue;
        const row = { ...it, platform: 'xhs', video: true, media: href };
        if (withVideo.some((x) => sameSource(x, row))) continue;
        withVideo.push(row);
      } catch (e) {
        if (/CANCELLED/.test(e.message)) throw e;
        if (/XHS_LOGIN/.test(e.message)) {
          if (!withVideo.length) throw e;
          break;
        }
      }
    }
  }
  return withVideo;
}

async function videosFromShopImage(plat, images, seq) {
  if (plat === 'taobao') return [];
  const names = { taobao: '타오바오', ali1688: '1688' };
  const products = [];
  for (const img of (images || []).slice(0, 3)) {
    if (seq !== searchSeq) return [];
    if (!img) continue;
    markStep(`${names[plat]}에서 같은 제품을 이미지로 찾는 중 · 접속 이상이 뜨면 크롬에서 사라질 때까지 기다립니다`);
    try {
      const r = await api('searchByImage', plat, img);
      if (r.items?.length) {
        products.push(...r.items);
        break;
      }
    } catch (e) {
      if (/CANCELLED/.test(e.message)) throw e;
    }
  }
  const seen = new Set();
  const unique = [];
  for (const row of products) {
    const id = videoIdOf(row.url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push({ ...row, platform: plat });
  }
  const withVideo = [];
  for (let i = 0; i < unique.length && withVideo.length < 4; i++) {
    if (seq !== searchSeq) return withVideo;
    const item = unique[i];
    markStep(`${names[plat]} 상품 영상 확인 중 (${withVideo.length + 1}/4) · 접속 이상이 뜨면 영상 상세가 숨겨집니다. 크롬에서 안내가 사라지면 이어갑니다`);
    if (i) await new Promise((ok) => setTimeout(ok, 1800));
    try {
      const hit = videoHit(await api('grabSocialVideo', item.url, plat));
      if (!hit.url) continue;
      if (plat === 'ali1688' && await videoThumbHasZh(hit.poster, hit.url)) {
        markStep(`영상 썸네일 중국어라 건너뜀 · ${(item.title || item.url || '').slice(0, 24)}`);
        continue;
      }
      withVideo.push({ ...item, video: true, media: hit.url, img: hit.poster || item.img });
    } catch (e) {
      if (/CANCELLED|접속 이상/.test(e.message)) throw e;
    }
  }
  return withVideo;
}

async function coupangOneClick(rawUrl) {
  const href = /https?:\/\//i.test(rawUrl) ? rawUrl : `https://${String(rawUrl).replace(/^\/+/, '')}`;
  markStep('쿠팡 시크릿 창에서 상품 이미지·검색어 추출 중');
  const info = await api('coupangProductInfo', href);
  const fromUrl = keywordFromCoupangUrl(href) || info.query || '';
  return produceFromCoupangProduct({ ...info, url: info.url || href }, fromUrl);
}

async function coupangKeywordOneClick(rawKeyword) {
  const keyword = String(rawKeyword || '').trim();
  if (keyword.length < 2) throw new Error('검색어를 입력하세요.');
  markStep(`쿠팡에서 "${keyword}" 제품 찾는 중`);
  let products = [];
  try {
    products = await fetchCoupang(keyword);
  } catch (e) {
    if (/CANCELLED/.test(e.message)) throw e;
  }
  if (!products.length) {
    markStep('쿠팡 시크릿 창에서 다시 찾는 중');
    products = await api('coupangBrowse', keyword);
  }
  if (!products.length) throw new Error('쿠팡에서 제품을 찾지 못했습니다. 검색어를 바꿔 주세요.');
  const info = products[0];
  return produceFromCoupangProduct({
    title: info.title || keyword,
    price: info.price || 0,
    img: info.img || '',
    imgs: info.imgs || (info.img ? [info.img] : []),
    url: info.url || '',
    rocket: info.rocket,
  }, keyword);
}

async function produceFromCoupangProduct(info, query) {
  let keyword = String(query || '').trim() || shortName(info.title);
  if (!keyword || keyword.length < 2) {
    keyword = String(info.title || '').replace(/\[[^\]]*\]/g, ' ').replace(/[^\w가-힣\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28);
  }
  if (!keyword || keyword.length < 2) throw new Error('상품명에서 검색어를 만들지 못했습니다.');
  const images = [...new Set([...(info.imgs || []), info.img].filter(Boolean))];

  const typedZh = activeZh(keyword);
  state.findQ1 = keyword;
  if (!typedZh) state.findQ2 = '';
  render();

  markStep(`"${keyword}" 중국어 번역 중`);
  const zhList = await zhQueriesFor(typedZh ? [typedZh, ...koSeeds(keyword, info.title)] : koSeeds(keyword, info.title));
  if (!zhList.length) throw new Error('중국어 검색어를 만들지 못했습니다.');
  rememberZh(keyword, zhList[0], state.zhManual && zhList[0] === typedZh);
  render();

  markStep('같은 제품 영상 찾는 중');
  const seq = ++searchSeq;
  state.platform = 'all';
  state.findLoading = true;
  state.findNote = `쿠팡 · ${keyword} → ${zhList.join(', ')}`;
  state.pairs = [];
  render();

  const coupangProduct = { title: info.title, price: info.price, img: info.img || images[0] || '', url: info.url, rocket: info.rocket };
  const pool = [];
  const take = (rows, plat) => {
    for (const row of rows || []) {
      const item = { ...row, platform: plat || row.platform };
      if (!item.url) continue;
      if (pool.some((x) => sameSource(x, item))) continue;
      item.coupang = [coupangProduct];
      item.coupangName = keyword;
      item.coupangQuery = keyword;
      pool.push(item);
    }
  };
  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const productName = String(info.title || keyword).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || keyword;
  const ensureProject = async () => {
    if (state.p?.cpKeyword === keyword && state.p.name && state.p.name !== '새 프로젝트') {
      state.view = 'work';
      state.workTab = 1;
      return state.p;
    }
    if (state.p?.videos?.length && state.p.name && state.p.name !== '새 프로젝트') await api('saveProject', state.p).catch(() => {});
    state.p = newProject();
    state.p.length = 30;
    state.p.tts.speed = 'brisk';
    state.added = [];
    state.p.product = { name: productName, features: [], kw: { ko: [keyword.slice(0, 24)] }, flow: '' };
    state.p.cpKeyword = keyword;
    state.p.searchKo = keyword;
    state.p.name = `${keyword.slice(0, 16)} ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
    state.p.coupang = [coupangProduct];
    state.view = 'work';
    state.workTab = 1;
    render();
    markStep('쿠팡 파트너스 링크 만드는 중');
    state.p.coupang = await pickOnePartner([coupangProduct]);
    return state.p;
  };

  if (seq !== searchSeq) return '검색이 중단되었습니다.';
  markStep('1688에서 같은 제품 영상 찾는 중');
  try { take(await videosFrom1688Keyword(zhList, seq, 8, keyword), 'ali1688'); } catch (e) {
    if (/CANCELLED|접속 이상/.test(e.message)) throw e;
  }
  if (pool.length) {
    const p = await ensureProject();
    markStep(`찾은 영상 ${pool.length}개 받는 중`);
    await downloadPool(pool, p);
  }
  if (seq !== searchSeq) return '검색이 중단되었습니다.';
  if (pool.length < 8) {
    markStep('샤오홍슈에서 같은 제품 영상 찾는 중');
    try { take(await videosFromXhsKeyword(zhList.slice(0, 3), seq, 8 - pool.length), 'xhs'); } catch (e) {
      if (/CANCELLED/.test(e.message)) throw e;
    }
  }
  state.findLoading = false;
  if (!pool.length) {
    state.findNote = '해외 플랫폼에서 영상을 찾지 못했습니다. 플랫폼 로그인을 확인한 뒤 다시 시도하세요.';
    render();
    throw new Error(state.findNote);
  }
  state.findResults = pool;
  const n1688 = pool.filter((v) => v.platform === 'ali1688').length;
  const nXhs = pool.filter((v) => v.platform === 'xhs').length;
  state.findNote = `쿠팡 "${keyword}" — 1688 ${n1688}개 · 샤오홍슈 ${nXhs}개. 미리보고 고른 뒤 원클릭 생성하세요.`;
  const p = await ensureProject();
  const got = await downloadPool(pool, p);
  if (!got.length) throw new Error('원본 영상을 받지 못했습니다. 다른 검색어로 다시 누르세요.');
  p.pick = 0;
  state.workTab = 1;
  render();
  return `${got.length}개 원본을 받았습니다. 미리보고 고른 뒤 원클릭 영상 생성을 누르세요.`;
}

function headerPayload(p) {
  const tpl = PRESETS.templates[p.edit.template] || PRESETS.templates[0];
  const e = p.edit;
  return {
    show: !!(e.header && (e.headTop || e.headTitle || tpl.look === 'reel')),
    top: e.headTop, title: e.headTitle, stat: ensureHeadStat(e),
    color: tpl.color, frame: tpl.frame, bg: tpl.bg, bar: tpl.bar || tpl.color, look: tpl.look,
  };
}

function applyReelHook(edit, title) {
  const i = PRESETS.templates.findIndex((t) => t.look === 'reel');
  if (i < 0) return;
  edit.template = i;
  edit.header = true;
  if (!edit.headTop) edit.headTop = '꿀템나라';
  if (title) edit.headTitle = title;
  else if (!edit.headTitle) edit.headTitle = '일본 천재가 개발해 떼돈 번 제품';
  ensureHeadStat(edit);
}

async function fillReelHook(edit, product) {
  applyReelHook(edit);
  try {
    const r = await api('nextHook', { product: product || '' });
    if (r?.text) applyReelHook(edit, r.text);
  } catch (e) {
    if (/CANCELLED/.test(String(e.message))) throw e;
  }
  return edit.headTitle;
}

function reelHookTitle(edit) {
  return String(edit?.headTitle || '일본 천재가 개발해 떼돈 번 제품').replace(/\s+/g, ' ').trim();
}

function deployTitle(p) {
  const headline = String(p?.edit?.headTitle || '').replace(/\s+/g, ' ').trim();
  if (p?.edit?.header && headline) return headline;
  return String(p?.upload?.title || '').trim() || (p?.name && p.name !== '새 프로젝트' ? p.name : '');
}

function hashTag(word) {
  const t = String(word || '').replace(/[^\w가-힣]/g, '');
  return t.length >= 2 ? `#${t}` : '';
}

function deployTags(p) {
  const kw = koSearchKeyword(p);
  const kwFlat = kw.replace(/\s+/g, '');
  const kwParts = kw.split(/\s+/).filter((w) => w.length >= 2);
  const skip = /세일|할인|특가|최저|휴대용|가정용|다용도|자동|인증|정품|국내|무료|배송|로켓|고주파|진동|회백|블랙|화이트|세트|당일|추천|인기/;
  const used = new Set([kwFlat, ...kwParts]);
  const related = [];
  const title = productTitleText(p);
  for (const w of title.split(/[^가-힣A-Za-z]+/)) {
    if (w.length < 2 || used.has(w) || skip.test(w)) continue;
    if (kwParts.some((part) => w.includes(part) || part.includes(w))) continue;
    used.add(w);
    related.push(w);
    if (related.length === 2) break;
  }
  for (const w of kwParts) {
    if (related.length === 2) break;
    if (!related.includes(w)) related.push(w);
  }
  const tags = [];
  const add = (word) => {
    const tag = hashTag(word);
    if (tag && !tags.includes(tag)) tags.push(tag);
  };
  add(kwFlat);
  related.forEach(add);
  add('꿀템');
  return tags.slice(0, 4).join(' ');
}

function applyBlastCopy(p, force) {
  const key = `${p?.name || ''}|${p?.exported || ''}`;
  const same = state.blast.copyFor === key;
  if (force || !same) {
    state.blast.title = deployTitle(p);
    state.blast.desc = String(p?.upload?.desc || '').trim() || deployDesc(p);
    state.blast.copyFor = key;
    return;
  }
  if (!state.blast.title) state.blast.title = deployTitle(p);
  if (!state.blast.desc) state.blast.desc = String(p?.upload?.desc || '').trim() || deployDesc(p);
}

function deployDesc(p) {
  const body = '제품 구매는 프로필 하단 구매링크 확인\n구매링크 내 1번째 제품 클릭!!';
  const tags = deployTags(p);
  return tags ? `${body}\n\n${tags}` : body;
}

function deployCaption(p) {
  const title = deployTitle(p);
  const desc = String(p?.upload?.desc || '').trim() || deployDesc(p);
  return [title, desc].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
}

function projectForFinished(item) {
  const base = String(item?.name || '');
  return (state.projects || [])
    .filter((p) => p?.name && base.startsWith(p.name))
    .sort((a, b) => b.name.length - a.name.length)[0] || null;
}

function withHookLine(lines, title) {
  const hook = String(title || reelHookTitle()).replace(/\s+/g, ' ').trim();
  const next = (lines || []).map((l) => String(l).trim()).filter(Boolean);
  if (!hook) return next;
  const compact = (s) => String(s).replace(/\s+/g, '');
  return [hook, ...next.filter((l) => compact(l) !== compact(hook))];
}

function captionBandOf(p) {
  const vids = p?.videos || [];
  for (const v of [vids[p.pick], ...vids].filter(Boolean)) {
    const b = v.captionBand;
    if (b && Number(b.h) >= 0.04) return b;
  }
  return null;
}

function subYFromBand(band) {
  if (!band || Number(band.h) < 0.04) return 1375;
  return Math.max(120, Math.min(1800, Math.round((Number(band.y) + Number(band.h) / 2) * 1920)));
}

function applyCaptionSubY(p) {
  p.edit.subY = subYFromBand(captionBandOf(p));
}

function coverEdit(p, edit) {
  const subY = Number.isFinite(Number(edit.subY)) ? Number(edit.subY) : subYFromBand(captionBandOf(p));
  return { ...edit, bg: false, border: true, captionCover: false, subY };
}

function productContext() {
  const p = state.p;
  const pr = p.product || {};
  return [pr.name || p.name, pr.features?.length ? `특징: ${pr.features.join(', ')}` : '', pr.flow ? `원본 영상 흐름: ${pr.flow}` : ''].filter(Boolean).join('\n');
}

function setProductFromAnalysis(url) {
  const a = state.analysis[url];
  if (a?.analysis && !a.analysis.fallback) state.p.product = { name: a.analysis.product, features: a.analysis.features, kw: a.analysis.kw, flow: a.analysis.flow };
  else if (a?.info && !state.p.product) state.p.product = { name: a.info.title, features: [], kw: a.analysis?.kw };
}

function heuristicScenes() {
  const p = state.p;
  const durs = lineDurations();
  const counters = p.videos.map(() => 0);
  return p.lines.map((text, i) => {
    let src = i % p.videos.length;
    for (let k = 0; k < p.videos.length && !p.videos[src].scenes?.length; k++) src = (src + 1) % p.videos.length;
    const n = p.videos[src].scenes?.length || 1;
    const clip = counters[src]++ % n;
    return { text, line: i, src, clip, dur: +durs[i].toFixed(2) };
  });
}

function addStyle(r) {
  state.p.benchMine.push({ title: r.title, img: r.img, summary: r.summary, transcript: r.transcript, url: r.url, emoji: '✨', hue: 280 });
  state.p.styleKey = `my-${state.p.benchMine.length - 1}`;
}

function readCoupangFindUrl() {
  const typed = String(document.getElementById('find-coupang-url')?.value || state.findCoupangUrl || '').trim();
  if (!/coupang\.com|coupa\.ng/i.test(typed)) return '';
  return /^https?:\/\//i.test(typed) ? typed : `https://${typed.replace(/^\/+/, '')}`;
}

function startFindOneClick(keywordFromEnter) {
  if (keywordFromEnter) state.findQ1 = String(keywordFromEnter).trim();
  const url = readCoupangFindUrl();
  if (url) {
    state.findCoupangUrl = url;
    task('쿠팡 URL → 해외 영상 찾는 중', () => coupangOneClick(url), (msg) => msg || '원클릭 생성 완료');
    return false;
  }
  const keyword = (state.findQ1 || '').trim() || (state.findQ2 || '').trim();
  if (!keyword) return toast('쿠팡 상품 URL을 넣거나 검색어를 입력하세요.');
  task('쿠팡 검색 → 해외 영상 찾는 중', () => coupangKeywordOneClick(keyword), (msg) => msg || '원클릭 생성 완료');
  return false;
}

/* ---------- actions ---------- */
function setPath(obj, path, val) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = val;
}

const LOCAL_VIDEO = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;

function ensureLocalProjectName() {
  const p = state.p;
  if (!p.name || p.name === '새 프로젝트') {
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    p.name = `내영상 ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
  }
}

function acceptLocalVideos(rows, skipped) {
  const p = state.p;
  if (!rows?.length) return '선택한 영상이 없습니다.';
  p.videos.push(...rows);
  p.pick = p.videos.length - 1;
  p.analyzed = false;
  p.scenes = [];
  if (!p.product?.name && rows[0]?.title) {
    p.product = { name: String(rows[0].title).slice(0, 40), features: [], kw: { ko: [String(rows[0].title).slice(0, 24)] }, flow: '' };
  }
  return `${rows.length}개 영상을 올렸습니다.${skipped ? ` ${skipped}개는 8개 제한으로 빠졌습니다.` : ''} 고른 뒤 원클릭 영상 생성을 누르세요.`;
}

function addDroppedVideos(paths) {
  const p = state.p;
  const files = (paths || []).filter((f) => LOCAL_VIDEO.test(f));
  if (!files.length) return toast('MP4, MOV, MKV, WebM, AVI 영상만 끌어다 놓을 수 있습니다.');
  if (p.videos.length >= 8) return toast('영상은 최대 8개까지 넣을 수 있습니다.');
  ensureLocalProjectName();
  const room = 8 - p.videos.length;
  const take = files.slice(0, room);
  task('내 PC 영상 넣는 중', async () => {
    const rows = await api('importVideoFiles', p.name, take);
    return acceptLocalVideos(rows, files.length - take.length);
  });
}

const actions = {
  nav: (d) => {
    state.view = d.val;
    state.modal = null;
    if (d.val === 'projects') {
      api('listProjects').then((l) => { state.projects = l; render(); }).catch(() => {});
      api('listFinished').then((l) => { state.finished = l; render(); }).catch(() => {});
    }
    if (d.val === 'settings' || d.val === 'tools') refreshMeta().then(render);
    if (d.val === 'blast') {
      if (!state.blast.file && state.p.exported) setBlastFile(state.p.exported);
      applyBlastCopy(state.p, false);
      loadBlast();
    }
  },
  set: (d) => { state[d.key] = d.val; },
  toggleFindVideoOnly: () => { state.findVideoOnly = !state.findVideoOnly; },
  help: () => toast('트렌드에서 소재를 고르고, 분석기에서 채널·조회수를 걸러 작업실로 보낼 수 있습니다. API 키는 설정에서 넣습니다.'),

  /* lens */
  lensTab: (d) => { state.lens.tab = d.val; },
  lensSet: (d) => { state.lens[d.key] = d.val; },
  lensToggle: (d) => { state.lens[d.key] = !state.lens[d.key]; },
  lensCii: (d) => { state.lens.ciiOn[d.val] = !state.lens.ciiOn[d.val]; },
  lensResetFilter: () => {
    state.lens.minViews = 0;
    state.lens.minSubs = 0;
    state.lens.shorts = false;
    state.lens.ciiOn = { Great: true, Good: true, Soso: true, 'Not bad': true, Bad: true };
  },
  lensClearRows: () => { state.lens.rows = []; state.lens.checked = {}; state.lens.source = ''; },
  lensCheck: (d) => { state.lens.checked[d.url] = !state.lens.checked[d.url]; },
  lensPickCh: (d) => { state.lens.pickedCh[d.url] = !state.lens.pickedCh[d.url]; },
  lensPickFound: (d) => { state.lens.pickedFound[d.url] = !state.lens.pickedFound[d.url]; },
  lensSearch: () => {
    const L = state.lens;
    if (!String(L.query || '').trim()) return toast('검색어를 입력하세요.');
    task('분석기 검색 중', async () => {
      const r = await api('lensSearch', { query: L.query.trim(), sort: L.sort, limit: +L.limit || 30, shorts: !!L.shorts, region: L.region, period: L.period });
      L.rows = r.items || [];
      L.source = r.source;
      L.checked = {};
      L.tab = 'search';
      return L.rows.length;
    }, (n) => `${n || 0}개 영상을 모았습니다`);
    return false;
  },
  lensAddUrl: () => {
    const url = $('#lens-url')?.value.trim();
    if (!/^https?:\/\//.test(url || '')) return toast('유튜브 주소를 붙여넣으세요.');
    task('주소 확인 중', async () => {
      const v = await api('lensInfo', url);
      state.lens.rows = [{ ...v, img: v.img || '', platform: 'youtube' }, ...state.lens.rows.filter((r) => r.url !== v.url)];
      state.lens.tab = 'search';
      $('#lens-url') && ($('#lens-url').value = '');
    }, '목록 맨 위에 넣었습니다');
    return false;
  },
  lensOpen: (d) => {
    state.lens.focus = d.url;
    state.lens.pane = 'report';
    state.modal = { type: 'lens', url: d.url };
  },
  lensOpenChecked: () => {
    const row = lensChecked()[0];
    if (!row) return toast('영상을 선택하세요.');
    actions.lensOpen({ url: row.url });
  },
  lensAnalyze: (d) => {
    const url = d.url || state.lens.focus;
    if (!url) return;
    state.analysis[url] = 'loading';
    state.lens.focus = url;
    state.modal = { type: 'lens', url };
    task('영상 분석 중', async () => { state.analysis[url] = await api('lensReport', url); }, '분석 완료');
    return false;
  },
  lensPane: (d) => { state.lens.pane = d.val; },
  lensMode: (d) => { state.lens.scriptMode = d.val; },
  lensFind: (d) => {
    const row = state.lens.rows.find((r) => r.url === d.url) || state.analysis[d.url]?.info;
    if (row) state.selected = { ...row, url: d.url, title: row.title || d.url };
    actions.findProduct({ url: d.url });
    return false;
  },
  lensScriptMake: () => {
    const url = state.lens.focus || state.modal?.url;
    const a = state.analysis[url];
    if (!a || a === 'loading' || a.error || !a.report) return toast('먼저 분석하기를 누르세요.');
    task('대본 생성 중', async () => {
      const r = await api('lensScript', {
        mode: state.lens.scriptMode, title: a.info?.title, channel: a.info?.channel,
        transcript: a.transcript, summary: (a.report.points || []).slice(0, 4).join(' '), prompt: state.lens.scriptPrompt,
      });
      state.lens.scriptText = r.text || '';
      state.lens.scriptFallback = !!r.fallback;
    }, '대본을 만들었습니다');
    return false;
  },
  lensScriptCopy: () => { copyText(state.lens.scriptText, '대본을 복사했습니다.'); return false; },
  lensSendScript: () => {
    const lines = state.lens.scriptText.split(/\n+/).map((s) => s.replace(/^\d+[\.\)]\s*/, '').replace(/^(문제|시연|마무리)\s*/, '').trim()).filter((s) => s.length > 1);
    if (!lines.length) return toast('보낼 대본이 없습니다.');
    state.p.lines = lines;
    state.p.ttsReady = false;
    state.modal = null;
    state.view = 'work';
    state.workTab = 2;
    toast('대본을 작업실 2단계에 넣었습니다.');
  },
  lensToWork: () => {
    const picked = lensChecked().slice(0, 8);
    if (!picked.length) return toast('영상을 선택하세요.');
    state.added = picked.map((v) => ({ ...v, platform: 'youtube' }));
    state.selected = picked[0];
    if (!state.p.product) state.p.product = { name: String(picked[0].title || '분석 영상').replace(/#\S+/g, '').trim().slice(0, 24) || '분석 영상', features: [], kw: {} };
    actions.toPrepare();
    return false;
  },
  lensDownload: (d) => {
    const rows = lensChecked().slice(0, 3);
    if (!rows.length) return toast('영상을 선택하세요.');
    if (lensChecked().length > 3) toast('한 번에 3개까지 받습니다.');
    task(d.val === 'mp3' ? 'MP3 추출 중' : 'MP4 받는 중', async () => {
      for (const r of rows) await api('lensDownload', r.url, d.val);
    }, '받은 파일을 폴더에서 열었습니다');
    return false;
  },
  lensCaptions: () => {
    const rows = lensChecked().slice(0, 8);
    if (!rows.length) return toast('영상을 선택하세요.');
    task('자막 확인 중', async () => {
      for (const r of rows) {
        const cap = await api('lensCaption', r.url);
        const hit = state.lens.rows.find((x) => x.url === r.url);
        if (hit) hit.caption = !!cap.has;
      }
    }, '자막 유무를 표시했습니다');
    return false;
  },
  lensExcel: () => {
    const rows = lensVisible();
    if (!rows.length) return toast('저장할 영상이 없습니다.');
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['채널', '제목', '게시일', '구독자', '조회수', '기여도', '성과배율', 'CII', '길이', '좋아요', '댓글', '참여율', '주소'].join(',')];
    rows.forEach((r) => lines.push([r.channel, r.title, r.date, r.subs, r.views, r.subs ? (r.contrib * 100).toFixed(1) + '%' : '', r.ratio.toFixed(2), r.cii, r.dur, r.likes || '', r.comments || '', r.views ? (r.engage * 100).toFixed(2) + '%' : '', r.url].map(cell).join(',')));
    api('saveText', '_분석기', `output/lens_${Date.now().toString(36)}.csv`, `\ufeff${lines.join('\n')}`).then((f) => api('showItem', f)).catch((e) => toast(e.message));
    return false;
  },
  lensIdeas: () => {
    const row = lensChecked()[0] || state.lens.rows[0];
    const topic = row ? `${row.title} / ${row.channel}` : state.lens.query;
    state.lens.ideaMode = 'ideas';
    task('아이디어 만드는 중', async () => { state.lens.ideas = await api('lensIdeas', topic); state.modal = { type: 'lensIdeas' }; }, '아이디어를 만들었습니다');
    return false;
  },
  lensTitles: () => {
    const row = lensChecked()[0] || state.lens.rows[0];
    const topic = row ? row.title : state.lens.query;
    state.lens.ideaMode = 'titles';
    task('제목 만드는 중', async () => { state.lens.ideas = await api('lensIdeas', topic); state.modal = { type: 'lensIdeas' }; }, '제목을 만들었습니다');
    return false;
  },
  lensCopyIdea: (d) => { copyText(d.val, '복사했습니다.'); return false; },
  lensUseTitle: (d) => { state.p.edit.headTitle = String(d.val).slice(0, 40); toast('작업실 헤드라인에 넣었습니다.'); return false; },
  lensChannel: () => {
    const q = state.lens.findCh || '';
    if (!q.trim()) return toast('채널명이나 주소를 입력하세요.');
    task('채널 찾는 중', async () => { state.lens.found = await api('lensChannels', q.trim()); state.lens.pickedFound = {}; }, (list) => `${(list || []).length}개 채널`);
    return false;
  },
  lensSaveFound: () => {
    const L = state.lens;
    let g = L.groupId !== 'all' ? L.groups.find((x) => x.id === L.groupId) : L.groups.find((x) => x.name === '임시');
    if (!g) {
      g = { id: Date.now().toString(36), name: '임시', channels: [] };
      L.groups.push(g);
      L.groupId = g.id;
    }
    L.found.filter((c) => L.pickedFound[c.url]).forEach((c) => {
      if (!g.channels.some((x) => x.url === c.url)) g.channels.push({ ...c, tag: /쇼핑|리뷰|템|살림|추천/.test(c.name) ? '쇼핑채널' : g.name });
    });
    L.pickedFound = {};
    saveLensGroups();
    toast('즐겨찾기에 넣었습니다.');
  },
  lensCollect: () => {
    const L = state.lens;
    const groups = L.groups || [];
    const shown = L.groupId === 'all'
      ? groups.flatMap((g) => g.channels.map((c) => ({ ...c, tag: g.name })))
      : (groups.find((g) => g.id === L.groupId)?.channels || []);
    const channels = shown.filter((c) => L.pickedCh[c.url]);
    if (!channels.length) return toast('채널을 선택하세요.');
    task('채널 영상 모으는 중', async () => {
      const r = await api('lensChannelVideos', channels.map((c) => ({ url: c.url, name: c.name, subs: c.subs })), +L.perChannel || 20);
      L.rows = r.items || [];
      L.source = r.source;
      L.checked = {};
      L.tab = 'search';
      return L.rows.length;
    }, (n) => `${n || 0}개 영상을 표에 넣었습니다`);
    return false;
  },
  lensGroup: (d) => {
    const L = state.lens;
    if (d.val === 'add') {
      const name = prompt('그룹 이름', '임시');
      if (!name) return false;
      const g = { id: Date.now().toString(36), name: name.trim(), channels: [] };
      L.groups.push(g);
      L.groupId = g.id;
    } else if (d.val === 'rename') {
      const g = L.groups.find((x) => x.id === L.groupId);
      if (!g) return false;
      const name = prompt('그룹 이름', g.name);
      if (!name) return false;
      g.name = name.trim();
    } else {
      L.groups = L.groups.filter((g) => g.id !== L.groupId);
      L.groupId = 'all';
    }
    saveLensGroups();
  },
  closeModal: () => { state.modal = null; state.exportOpen = false; stopAudio(); api('shareStop').catch(() => {}); },
  openFinishedDir: () => { api('openFinishedDir').catch(() => {}); return false; },
  projectPreview: (d) => {
    const item = state.projects[+d.i];
    if (!item?.preview) return toast('아직 미리볼 영상이 없습니다.');
    state.modal = { type: 'video', file: item.preview };
  },
  finishedPreview: (d) => {
    const item = state.finished[+d.i];
    if (!item?.file) return toast('영상을 찾지 못했습니다.');
    state.modal = { type: 'video', file: item.file };
  },
  finishedTelegram: (d) => {
    const item = state.finished[+d.i];
    if (!item?.file) return toast('영상을 찾지 못했습니다.');
    task('텔레그램으로 보내는 중', async () => {
      let caption = item.name;
      if (state.blast.file === item.file && (String(state.blast.title || '').trim() || String(state.blast.desc || '').trim())) {
        caption = [state.blast.title, state.blast.desc].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
      } else {
        const listed = projectForFinished(item);
        const loaded = listed?.name ? await api('loadProject', listed.name).catch(() => null) : null;
        const project = loaded || (state.p?.name && String(item.name).startsWith(state.p.name) ? state.p : null);
        if (project) caption = deployCaption(project) || caption;
      }
      return api('telegramSend', item.file, caption);
    }, (r) => `텔레그램으로 보냈습니다. 제목과 설명도 함께 갔습니다. 휴대폰에서 @${r.bot || '봇'} 대화를 여세요.`);
    return false;
  },
  telegramConnect: () => {
    actions.saveSettings().then(() => task('텔레그램 봇 연결 중', async () => {
      const r = await api('telegramConnect');
      if (!r.ok) {
        if (r.url) api('openExternal', r.url);
        throw new Error(r.bot ? `텔레그램에서 @${r.bot} 대화를 열고 시작을 누른 뒤, 다시 연결을 누르세요.` : '봇 토큰을 확인하세요.');
      }
      return r;
    }, (r) => `텔레그램 연결됨 — @${r.bot}`).then(refreshMeta).then(render));
    return false;
  },
  backdrop: (d, e) => {
    if (e.target.classList.contains('modal-back')) { state.modal = null; stopAudio(); } else return false;
  },
  stop: () => { state.stop = true; api('cancel'); return false; },
  copyStatusLog: () => {
    const text = statusLogText();
    if (!text) return toast('복사할 로그가 없습니다.');
    copyText(text, '진행 로그를 복사했습니다.');
    return false;
  },
  toggleStatusLog: () => {
    if (!state.status) return false;
    state.status.logClosed = !state.status.logClosed;
    updateStatus();
    return false;
  },
  clearStatus: () => { state.status = null; updateStatus(); return false; },
  openUrl: (d) => { openUrl(d.val); return false; },
  openChannel: async (d) => {
    try {
      let url = d.val || '';
      if (!/^https?:\/\//.test(url)) {
        await api('youtubeChannelUrl');
        await refreshMeta();
        url = channelUrl('youtube');
        render();
      }
      if (!/^https?:\/\//.test(url)) toast('채널 주소를 찾지 못했습니다.');
      else openUrl(url);
    } catch (e) {
      toast(e.message || '채널을 열지 못했습니다.');
    }
    return false;
  },
  showItem: (d) => { api('showItem', d.val); return false; },
  folder: (d) => { api('openFolder', d.val === '__root' ? '' : state.p.name, d.val === '__root' ? '' : d.val); return false; },

  /* trend */
  trendMode: (d) => {
    state.trendMode = d.val;
    state.trendQuery = '';
    if (d.val === 'today') loadTrends();
    if (d.val === 'keyword') state.trends = [];
  },
  period: (d) => { state.period = d.val; loadTrends(); return false; },
  refreshTrend: () => { loadTrends(); return false; },
  openTrend: (d) => { const item = findItem(d.url); state.modal = { type: 'trend', url: d.url }; ensureAnalysis(item); return false; },
  aiAnalyze: (d) => { ensureAnalysis(findItem(d.url), true); return false; },
  fav: (d) => {
    const exists = state.favs.some((f) => f.url === d.url);
    state.favs = exists ? state.favs.filter((f) => f.url !== d.url) : [...state.favs, findItem(d.url)];
    localStorage.setItem('sl-favs', JSON.stringify(state.favs));
  },
  findProduct: (d) => {
    const item = findItem(d.url);
    state.selected = item;
    state.trendTab = 'find';
    state.view = 'trend';
    state.modal = null;
    state.platform = 'all';
    const kw = state.analysis[d.url]?.analysis?.kw;
    state.findQ1 = kw?.en?.[0] || kw?.ko?.[0] || item.title.replace(/#\S+/g, '').trim().slice(0, 40);
    rememberZh(state.findQ1, kw?.zh?.[0] || '');
    setProductFromAnalysis(d.url);
    runSearch();
    return false;
  },
  kwSearch: (d) => {
    actions.findProduct(d);
    state.findQ1 = d.val;
    runSearch();
    return false;
  },
  pickKw: (d) => {
    if (/[\u4e00-\u9fff]/.test(d.val) && !/[가-힣]/.test(d.val)) rememberZh(state.findQ1, d.val, true);
    else { state.findQ1 = d.val; runSearch(); }
  },
  styleFromTrend: (d) => {
    state.modal = null;
    state.view = 'work';
    state.workTab = 2;
    task('스타일 분석 중', async () => addStyle(await api('analyzeStyle', d.url)), '스타일 분석 완료');
    return false;
  },
  searchSources: () => { runSearch(); return false; },
  matchXhs: () => startFindOneClick(),
  openPlatformSearch: (d) => { runSocialSearch(d.val); return false; },
  addSource: (d) => {
    if (state.added.length >= 8) return toast('최대 8개까지 추가할 수 있습니다.');
    const v = state.findResults.find((x) => x.url === d.url);
    if (!v) return;
    const vPlat = v.platform || platformOf(v.url);
    if (!COUPANG_FILTER_PLATFORMS.includes(vPlat) && vPlat !== 'tiktok') return toast('작업 영상은 해외 플랫폼(샤오홍슈·도우인·틱톡·타오바오·1688)만 넣습니다.');
    state.added.push(v);
  },
  usePair: (d) => {
    const pair = state.pairs[+d.i];
    if (!pair?.xhs?.url || !pair.youtube?.url) return false;
    task('유튜브 분석 후 해외 영상을 받는 중', async () => {
      const p = state.p;
      let analyzed = false;
      try {
        state.status.text = '유튜브 영상 분석 중';
        updateStatus();
        const style = await api('analyzeStyle', pair.youtube.url);
        state.analysis[pair.youtube.url] = { info: style.info, transcript: style.transcript, analysis: style.analysis };
        addStyle(style);
        setProductFromAnalysis(pair.youtube.url);
        analyzed = true;
      } catch (e) {
        if (/CANCELLED/.test(e.message)) throw e;
        toast(`유튜브 분석 실패: ${e.message}`);
      }
      const video = {
        ...pair.xhs, platform: pair.xhs.platform || platformOf(pair.xhs.url) || 'xhs', done: false,
        refUrl: pair.youtube.url, refTitle: pair.youtube.title, refImg: pair.youtube.img,
      };
      let i = p.videos.findIndex((v) => v.url === video.url);
      if (i < 0) {
        if (p.videos.length >= 8) throw new Error('최대 8개까지 넣을 수 있습니다.');
        p.videos.push(video);
        i = p.videos.length - 1;
      } else {
        p.videos[i].refUrl = video.refUrl;
        p.videos[i].refTitle = video.refTitle;
        p.videos[i].refImg = video.refImg;
      }
      if (p.name === '새 프로젝트' && p.product?.name) p.name = p.product.name.slice(0, 30);
      state.added = state.added.filter((v) => v.url !== video.url);
      state.view = 'work';
      state.workTab = 1;
      render();
      if (!p.videos[i].done) {
        state.status.text = '해외 영상 다운로드 중';
        updateStatus();
        Object.assign(p.videos[i], await api('download', p.name, p.videos[i], i), { done: true, error: '' });
        p.analyzed = false;
      }
      return analyzed;
    }, (ok) => (ok ? '유튜브 분석을 붙였고, 작업 영상은 받아 두었습니다.' : '해외 영상은 받아 두었습니다. 유튜브 분석은 다시 시도하세요.'));
    return false;
  },
  removeAdded: (d) => { state.added.splice(+d.i, 1); },
  clearAdded: () => { state.added = []; },
  toPrepare: () => {
    const p = state.p;
    const isSocial = (v) => [...COUPANG_FILTER_PLATFORMS, 'tiktok'].includes(v.platform || platformOf(v.url));
    const work = state.added.filter(isSocial);
    if (!work.length) return toast('작업에 넣을 해외 영상이 없습니다. 비교로 쌍을 고르세요.');
    const existing = new Set(p.videos.map((v) => v.url));
    work.filter((v) => !existing.has(v.url)).slice(0, 8 - p.videos.length).forEach((v) => p.videos.push({ ...v, platform: v.platform || platformOf(v.url), done: false }));
    if (state.selected) setProductFromAnalysis(state.selected.url);
    if (p.name === '새 프로젝트' && p.product?.name) p.name = p.product.name.slice(0, 30);
    state.added = [];
    state.view = 'work';
    state.workTab = 1;
    runDownload();
    return false;
  },

  /* workroom */
  workTab: (d) => {
    state.workTab = +d.val;
    if (state.workTab !== 5) setPlaying(false);
    if (state.workTab === 2) loadVoices(state.p.tts.provider);
  },
  saveProject: async () => {
    try {
      state.p.step = state.workTab;
      state.p.coverThumb = state.p.videos[0]?.thumb || null;
      await api('saveProject', state.p);
      toast('프로젝트를 저장했습니다.');
    } catch (e) {
      toast(`저장 실패: ${e.message}`);
    }
    return false;
  },
  newProject: () => {
    state.p = newProject();
    state.added = [];
    state.status = null;
    state.view = 'work';
    state.workTab = 1;
    state.time = 0;
    setPlaying(false);
  },
  openProject: async (d) => {
    try {
      state.p = Object.assign(newProject(), await api('loadProject', d.val));
      state.p.edit = Object.assign(newProject().edit, state.p.edit);
      dropSampleHeader(state.p.edit);
      state.view = 'work';
      state.workTab = state.p.step || 1;
      state.time = 0;
      render();
    } catch (e) {
      toast(`불러오기 실패: ${e.message}`);
    }
    return false;
  },
  download: () => { runDownload(); return false; },
  addLocalVideos: () => {
    const p = state.p;
    if (p.videos.length >= 8) return toast('영상은 최대 8개까지 넣을 수 있습니다.');
    ensureLocalProjectName();
    task('내 PC 영상 넣는 중', async () => {
      const rows = await api('importLocalVideos', p.name, 8 - p.videos.length);
      return acceptLocalVideos(rows, 0);
    });
    return false;
  },
  oneClick: (d) => {
    task('원클릭 영상 생성 중', () => makeOneClick(d), (msg) => msg || '원클릭 생성 완료');
    return false;
  },
  removeVideo: (d) => {
    state.p.videos.splice(+d.i, 1);
    state.p.analyzed = false;
    state.p.scenes = [];
    if (state.p.pick >= state.p.videos.length) state.p.pick = Math.max(0, state.p.videos.length - 1);
  },
  clearVideos: () => { state.p.videos = []; state.p.pick = 0; state.p.analyzed = false; state.p.scenes = []; },
  pickVideo: (d) => { state.p.pick = +d.i; },
  playVideo: (d) => { const v = state.p.videos[+d.i]; if (v?.file) { state.p.pick = +d.i; state.modal = { type: 'video', file: v.file }; } },
  analyzeSources: () => {
    if (!state.p.videos.some((v) => v.file)) return toast('먼저 영상을 다운로드하세요.');
    task('소스 영상 분석 중', async () => {
      const p = state.p;
      const ready = p.videos.filter((v) => v.file);
      const r = await api('analyzeSources', p.name, ready.map((v) => ({ file: v.originalFile || v.file, local: !!v.local, forceClean: true })));
      r.forEach((x, i) => Object.assign(ready[i], x));
      applyCaptionSubY(p);
      p.analyzed = true;
      p.scenes = [];
    }, () => `소스 영상 분석 완료 — ${state.p.videos.reduce((a, v) => a + (v.scenes?.length || 0), 0)}개 장면, 원본 음성과 자막 자리를 지웠습니다`);
    return false;
  },
  analyzeStyle: () => {
    const link = $('#style-link').value.trim();
    if (!link) return toast('스타일을 참조할 쇼츠 링크를 입력하세요.');
    task('스타일 분석 중', async () => addStyle(await api('analyzeStyle', link)), '스타일 분석 완료');
    return false;
  },
  pickStyle: (d) => { state.p.styleKey = d.val; },
  removeStyle: (d) => {
    state.p.benchMine.splice(+d.val.split('-')[1], 1);
    state.p.styleKey = 'lens-0';
  },
  genScript: () => {
    const p = state.p;
    p.length = narrationLength(p.length);
    const ctx = scriptContext(p);
    task('대본 생성 중', async () => {
      const r = await api('genScript', ctx);
      p.lines = withHookLine(r.lines, reelHookTitle(p.edit));
      p.audio = [];
      p.ttsReady = false;
      p.prepared = null;
      p.scenes = [];
      buildSubtitles();
      if (r.fallback) toast('AI 키가 없어 기본 템플릿으로 만들었습니다. 문장을 직접 고쳐 쓰세요.');
    }, () => `대본 생성 완료 — ${state.p.lines.length}문장`);
    return false;
  },
  genVoice: () => {
    const p = state.p;
    p.lines = withHookLine(p.lines, reelHookTitle(p.edit));
    if (!p.lines.length) return toast('대본을 먼저 입력하세요.');
    task('음성 생성 중', async () => {
      await speakLines(p);
      p.ttsReady = true;
      p.prepared = null;
      buildSubtitles();
    }, () => `음성 생성 완료 — ${voiceSeconds(state.p.audio).toFixed(1)}초`);
    return false;
  },
  addLine: () => { state.p.lines.push(''); state.p.ttsReady = false; },
  removeLine: (d) => { state.p.lines.splice(+d.i, 1); state.p.audio = []; state.p.ttsReady = false; state.p.prepared = null; },
  ttsTab: (d) => { state.p.tts.provider = d.val; state.p.tts.voice = ''; loadVoices(d.val); },
  playLine: (d) => {
    const a = state.p.audio[+d.i];
    if (a && state.p.audio.length === state.p.lines.length) playFiles([a.file]);
    else toast('먼저 음성생성을 하세요.');
    return false;
  },
  playAllLines: () => {
    if (state.p.audio.length && state.p.audio.length === state.p.lines.length) playFiles(state.p.audio.map((a) => a.file));
    else toast('먼저 음성생성을 하세요.');
    return false;
  },

  matchScenes: () => {
    if (!state.p.lines.length) return toast('먼저 대본을 만드세요.');
    if (!state.p.videos.some((v) => v.scenes?.length)) return toast('먼저 영상 준비 탭에서 소스 영상 분석을 하세요.');
    task('장면 매칭 중', async () => {
      const p = state.p;
      let scenes = heuristicScenes();
      try {
        const matches = await api('aiMatch', p.lines, p.videos.map((v) => (v.scenes || []).map((s) => s.label)));
        if (Array.isArray(matches)) {
          scenes = scenes.map((s, i) => {
            const m = matches.find((x) => +x.line === i);
            return m && p.videos[m.src]?.scenes?.[m.clip] ? { ...s, src: +m.src, clip: +m.clip } : s;
          });
        }
      } catch {}
      p.scenes = scenes;
      state.selectedScene = 0;
    }, '장면 매칭 완료');
    return false;
  },
  previewScenes: () => { state.modal = { type: 'slideshow' }; render(); runSlideshow(); return false; },
  resetScenes: () => { state.p.scenes = []; },
  pickScene: (d) => { state.selectedScene = +d.i; },
  assignClip: (d) => {
    const s = state.p.scenes[state.selectedScene];
    if (!s) return toast('먼저 위에서 장면 카드를 선택하세요.');
    s.src = +d.src;
    s.clip = +d.clip;
    autosave();
  },

  splitSubs: () => { buildSubtitles(); toast(`${state.p.subtitles.length}개 자막으로 나눴습니다.`); },
  fixSubs: () => {
    task('자막 교정 중', async () => {
      const texts = await api('fixSubs', state.p.subtitles.map((s) => s.text));
      texts.forEach((t, i) => (state.p.subtitles[i].text = t));
    }, '자막 교정 완료');
    return false;
  },
  exportSrt: async () => {
    const ts = (t) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${(t % 60).toFixed(3).padStart(6, '0').replace('.', ',')}`;
    const srt = state.p.subtitles.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text}\n`).join('\n');
    try {
      const file = await api('saveText', state.p.name, 'output/subs.srt', srt);
      copyText(srt, 'SRT를 저장하고 클립보드에도 복사했습니다.');
      api('showItem', file);
    } catch (e) {
      toast(e.message);
    }
    return false;
  },

  prepModal: () => { state.modal = { type: 'prep' }; },
  togglePrep: (d) => { const pr = state.p.edit.prep; pr[d.val] = !pr[d.val]; },
  startPrep: () => {
    state.modal = null;
    const p = state.p;
    ensureTimeline();
    if (!p.ttsReady || !p.audio.length || p.audio.length !== p.lines.length) {
      buildSubtitles();
      p.prepared = { voiceFile: null, audios: [], sourceAudio: true };
      state.time = 0;
      toast(p.videos.some((v) => v.hasAudio) ? '음성이 없어 원본 소리와 자막으로 준비했습니다.' : '자막과 장면을 준비했습니다. 소리는 대본 탭에서 음성을 만들면 들어갑니다.');
      return;
    }
    task('편집 준비 중', async () => {
      p.prepared = await api('prepareEdit', p.name, p.audio, p.edit.prep.silence);
      if (!p.scenes.length && p.analyzed) p.scenes = heuristicScenes();
      buildSubtitles();
      state.time = 0;
    }, () => `편집 준비 완료 — 총 ${totalDuration().toFixed(1)}초`);
  },
  export: () => {
    setPlaying(false);
    const p = state.p;
    ensureTimeline();
    if (!p.scenes.length) return toast('장면이 없습니다. 영상 준비에서 분석을 하거나 장면 구성에서 맞춰 주세요.');
    const scenes = p.scenes.map((s) => {
      const v = p.videos[s.src];
      const c = v?.scenes?.[s.clip];
      return { file: v?.file, start: c?.start || 0, dur: s.dur, hasAudio: !!v?.hasAudio };
    });
    if (p.edit.intro) scenes.unshift({ file: p.edit.intro, start: 0, dur: 2.4, hasAudio: true });
    if (scenes.some((s) => !s.file)) return toast('장면에 연결된 소스 영상이 없습니다. 장면 구성을 확인하세요.');
    state.exportOpen = false;
    task('영상 내보내기 중', async () => {
      let file = await api('render', p.name, {
        scenes, subs: p.subtitles, edit: coverEdit(p, p.edit), voiceFile: p.prepared?.voiceFile || null,
        header: headerPayload(p),
        templateImage: p.edit.showTemplateImage ? p.edit.templateImage : null,
        bgm: p.edit.bgm, sfx: p.edit.sfx, keepAudio: p.edit.prep.keepAudio || !p.prepared?.voiceFile, voiceOn: !!(p.edit.voice && p.prepared?.voiceFile), subOn: p.edit.sub,
      });
      if (p.edit.thumbLead && p.thumbnail) file = await api('prependThumb', p.name, file, p.thumbnail);
      p.exported = file;
      state.modal = { type: 'done', file };
    }, '내보내기 완료');
    return false;
  },
  toggleExport: () => { state.exportOpen = !state.exportOpen; },
  exportCapcut: () => {
    state.exportOpen = false;
    if (!state.p.exported) return toast('먼저 MP4로 내보내기 하세요.');
    task('캡컷 묶음 만드는 중', async () => api('exportCapcut', state.p.name, state.p.exported), () => '영상과 타임라인 파일을 폴더에 저장했습니다. 캡컷에서 바로 안 열리면 그 영상을 불러오세요.');
    return false;
  },
  playExported: () => { state.modal = { type: 'video', file: state.p.exported }; },
  toggleEdit: (d) => {
    state.p.edit[d.val] = !state.p.edit[d.val];
    if (state.modal?.type === 'prep') return;
  },
  setEdit: (d) => { state.p.edit[d.key] = d.val; },
  subMode: (d) => { state.p.edit.subMode = d.val; state.p.subMaxChars = d.val === 'short' ? 8 : 16; if (state.p.lines.length) buildSubtitles(); },
  rightPanel: (d) => { state.rightPanel = d.val; state.selectedOverlay = null; },
  pickLayer: (d) => { state.selectedOverlay = d.val; },
  removeLayer: (d) => {
    const list = activeLayers();
    const i = list.findIndex((o) => o.id === d.val);
    if (i >= 0) list.splice(i, 1);
    if (state.selectedOverlay === d.val) state.selectedOverlay = null;
  },
  addLayer: async (d) => {
    const list = activeLayers();
    const id = Date.now().toString(36);
    if (d.val === 'image') {
      const file = await api('pickFile', 'image').catch(() => null);
      if (!file) return;
      list.push({ id, kind: 'image', file, x: 50, y: 46, w: 32, opacity: 100 });
    } else if (d.val === 'text') {
      list.push({ id, kind: 'text', text: '문구 입력', x: 50, y: 42, size: 72, bold: true, italic: false, color: '#ffffff', outline: true, shadow: true, opacity: 100 });
    } else {
      list.push({ id, kind: 'shape', shape: d.val, x: 50, y: 58, w: d.val === 'line' ? 30 : 16, color: '#ffffff', opacity: 100 });
    }
    state.selectedOverlay = id;
    render();
    return false;
  },
  addBg: async () => {
    const file = await api('pickFile', 'image').catch(() => null);
    if (!file) return;
    activeLayers().unshift({ id: Date.now().toString(36), kind: 'image', file, x: 50, y: 50, w: 100, opacity: 100 });
    render();
  },
  toggleStickers: () => { state.stickerOpen = !state.stickerOpen; },
  addSticker: (d) => {
    const id = Date.now().toString(36);
    activeLayers().push({ id, kind: 'text', text: d.val, x: 62, y: 38, size: 96, bold: false, italic: false, color: '#ffffff', outline: false, shadow: false, opacity: 100 });
    state.selectedOverlay = id;
  },
  ovToggle: (d) => {
    const o = selectedLayer();
    if (o) o[d.val] = !o[d.val];
  },
  boxToggle: (d) => { state.p.edit[d.val].on = !state.p.edit[d.val].on; },
  boxReset: (d) => {
    state.p.edit[d.val] = d.val === 'topBox'
      ? { on: true, color: '#000000', height: 18, opacity: 85, zoom: 50 }
      : { on: true, color: '#000000', height: 22, opacity: 70, zoom: 50 };
  },
  thumbSuggest: () => {
    const p = state.p;
    if (!p.scenes.length) return toast('먼저 장면을 준비하세요.');
    let best = 0;
    let acc = 0;
    p.scenes.forEach((s, i) => {
      if ((s.dur || 0) > (p.scenes[best].dur || 0)) best = i;
    });
    p.scenes.slice(0, best).forEach((s) => { acc += s.dur || 0; });
    p.edit.thumbTime = acc + (p.scenes[best]?.dur || 0) / 2;
  },
  thumbScene: (d) => {
    let acc = 0;
    state.p.scenes.slice(0, +d.i).forEach((s) => { acc += s.dur || 0; });
    state.p.edit.thumbTime = acc + 0.2;
  },
  clearThumbDecor: () => { state.p.edit.thumbItems = []; state.selectedOverlay = null; },
  finishThumb: () => {
    const p = state.p;
    const place = placeAt(p.edit.thumbTime || 0);
    const file = p.exported || place?.file;
    if (!file) return toast('먼저 영상을 받거나 내보내기 하세요.');
    const t = p.exported ? (p.edit.thumbTime || 0) : (place?.inPoint || 0);
    task('썸네일 만드는 중', async () => {
      p.thumbnail = await api('composeThumb', p.name, file, t, {
        flip: !!p.edit.thumbFlip,
        edit: { overlays: p.edit.thumbItems, topBox: p.edit.topBox, bottomBox: p.edit.bottomBox },
        header: { show: false },
      });
    }, '썸네일 완성');
    return false;
  },
  openCal: (d) => {
    const raw = d.val === 'blast' ? state.blast.schedule : state.p.upload.schedule;
    const dt = raw ? new Date(raw) : new Date(Date.now() + 3600e3);
    state.cal = { target: d.val, y: dt.getFullYear(), m: dt.getMonth(), day: dt.getDate(), h: dt.getHours(), min: Math.floor(dt.getMinutes() / 5) * 5 };
    state.modal = { type: 'calendar' };
  },
  calNav: (d) => {
    const c = state.cal;
    const dt = new Date(c.y, c.m + +d.val, 1);
    c.y = dt.getFullYear();
    c.m = dt.getMonth();
  },
  calSet: (d) => { state.cal[d.key] = +d.val; },
  calApply: () => {
    const c = state.cal;
    const dt = new Date(c.y, c.m, c.day, c.h, c.min);
    const v = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    if (c.target === 'blast') { state.blast.schedule = v; state.blast.scheduleOn = true; }
    else state.p.upload.schedule = v;
    state.modal = null;
    toast(`${dt.toLocaleString('ko-KR')}으로 예약 시간을 넣었습니다.`);
  },
  openIntro: () => { state.modal = { type: 'intro' }; },
  introScene: (d) => { state.intro.scene = +d.i; },
  introLine: (d) => { state.intro.line = d.val; },
  introWrite: () => {
    const line = $('#intro-line')?.value || state.intro.line;
    task('문장 다듬는 중', async () => { state.intro.line = await api('introLine', state.p.product?.name || state.p.name, line); }, '문장을 다듬었습니다');
    return false;
  },
  introMake: () => {
    const p = state.p;
    const s = p.scenes[state.intro.scene] || p.scenes[0];
    const img = s ? sceneThumb(s) : '';
    const line = $('#intro-line')?.value?.trim() || state.intro.line;
    if (!img) return toast('장면 썸네일이 없습니다. 소스 영상 분석을 먼저 하세요.');
    state.modal = null;
    task('시작 장면 만드는 중', async () => {
      p.edit.intro = await api('makeIntro', p.name, img, line);
      toast('시작 장면이 만들어졌습니다. 내보내면 영상 맨 앞에 붙습니다.');
    }, '시작 장면 완성');
    return false;
  },
  openSfx: () => { state.modal = { type: 'sfxai' }; },
  sfxSuggest: () => {
    task('효과음 추천 중', async () => {
      const r = await api('sfxSuggest', `${state.p.product?.name || state.p.name}\n${(state.p.lines || []).slice(0, 4).join(' ')}`);
      state.sfxDraft.make = r.make || r.sounds || state.sfxDraft.make;
      state.sfxDraft.remove = r.remove || state.sfxDraft.remove;
      state.sfxDraft.log = r.fallback ? 'AI 키가 없어 기본 소리를 넣었습니다.' : 'AI 추천을 채웠습니다.';
    }, '추천을 채웠습니다');
    return false;
  },
  sfxMake: () => {
    const make = $('#sfx-make')?.value || state.sfxDraft.make || 'whoosh';
    const volume = (state.sfxDraft.volume || 40) / 100;
    state.modal = null;
    task('효과음 만드는 중', async () => {
      const file = await api('makeSfx', state.p.name, make, volume);
      state.p.edit.sfx.push({ file, time: state.time || 0 });
    }, '효과음을 현재 위치에 넣었습니다');
    return false;
  },
  pickTpl: (d) => {
    state.p.edit.template = +d.i;
    if (PRESETS.templates[+d.i]?.look === 'reel') {
      applyReelHook(state.p.edit);
      fillReelHook(state.p.edit, state.p.product?.name || state.p.name).then(() => render());
    }
  },
  tplFields: () => {
    const e = state.p.edit;
    const sc = state.p.scenes[0];
    return {
      name: e.headTitle || `저장 ${state.userTemplates.length + 1}`,
      template: e.template, headTop: e.headTop, headTitle: e.headTitle, header: e.header,
      font: e.font, size: e.size, italic: e.italic, bg: e.bg, border: e.border, shadow: e.shadow,
      filter: e.filter, effect: e.effect, showTemplateImage: e.showTemplateImage, templateImage: e.templateImage,
      thumb: sc ? sceneThumb(sc) : null,
    };
  },
  tplSave: async () => {
    const item = actions.tplFields();
    state.userTemplates.push(item);
    localStorage.setItem('sl-user-templates', JSON.stringify(state.userTemplates));
    try {
      const file = await api('saveText', state.p.name, `output/template_${Date.now().toString(36)}.json`, JSON.stringify(item, null, 2));
      toast('템플릿을 저장했습니다. 같은 설정을 파일로도 남겼습니다.');
      api('showItem', file);
    } catch {
      toast('템플릿을 저장했습니다.');
    }
    render();
    return false;
  },
  applyTemplate: (item) => {
    if (!item || item.template == null) return toast('템플릿 파일을 읽지 못했습니다.');
    const { name, thumb, ...rest } = item;
    Object.assign(state.p.edit, rest);
    toast(`${name || '템플릿'}을 적용했습니다.`);
  },
  tplLoad: (d) => { actions.applyTemplate(state.userTemplates[+d.i]); },
  tplImport: async () => {
    const file = await api('pickFile', 'json').catch(() => null);
    if (!file) return false;
    try {
      const item = JSON.parse(await api('readText', file));
      state.userTemplates.push(item);
      localStorage.setItem('sl-user-templates', JSON.stringify(state.userTemplates));
      actions.applyTemplate(item);
    } catch (e) {
      toast(`불러오기 실패: ${e.message}`);
    }
    render();
    return false;
  },
  tplPickImage: async () => {
    const file = await api('pickFile', 'image').catch(() => null);
    if (!file) return false;
    state.p.edit.templateImage = file;
    state.p.edit.showTemplateImage = true;
    toast('템플릿 이미지를 올렸습니다. 체크를 끄면 숨깁니다.');
    render();
    return false;
  },
  addSfx: async () => {
    const file = await api('pickFile', 'audio').catch(() => null);
    if (file) { state.p.edit.sfx.push({ file, time: state.time }); render(); }
    return false;
  },
  removeSfx: (d) => { state.p.edit.sfx.splice(+d.i, 1); },
  pickBgm: async () => {
    const file = await api('pickFile', 'audio').catch(() => null);
    if (file) { state.p.edit.bgm = { file, volume: 0.12 }; render(); }
    return false;
  },
  removeBgm: () => { state.p.edit.bgm = null; },
  makeThumb: async () => {
    try {
      state.p.thumbnail = await api('makeThumb', state.p.name, state.p.exported, state.time);
      toast('썸네일을 만들었습니다.');
      render();
    } catch (e) {
      toast(e.message);
    }
    return false;
  },
  seek: (d, e) => {
    if (e.target.tagName === 'INPUT') return false;
    state.time = +d.t + 0.01;
    if (audioEl && audioEl.dataset?.role === 'editor') audioEl.currentTime = state.time;
    updatePlayer();
  },
  play: () => { setPlaying(!state.playing); return false; },

  cpKeyword: (d) => { state.p.cpKeyword = d.val; },
  findCoupang: () => {
    const kw = state.p.cpKeyword || state.p.product?.name || state.p.name;
    if (!kw) return toast('검색할 제품명을 입력하세요.');
    state.p.cpKeyword = kw;
    const call = state.aiStatus.coupang ? 'coupangSearch' : 'coupangBrowse';
    task('쿠팡 상품 검색 중', async () => {
      const rows = await api(call, kw);
      state.p.coupang = await attachPartnerLinks(rows);
    }, () => `쿠팡 후보 ${state.p.coupang.length}개 수집`);
    return false;
  },
  copyAll: () => { copyText(state.p.coupang.map((c) => `${c.title}\n${c.url}`).join('\n\n'), '링크를 전체 복사했습니다.'); return false; },
  copySearchKo: () => {
    const text = koSearchKeyword(state.p);
    if (!text) return toast('복사할 검색 키워드가 없습니다.');
    copyText(text, '검색 키워드를 복사했습니다.');
    return false;
  },
  copyProductTitle: () => {
    const text = productTitleText(state.p);
    if (!text) return toast('복사할 제목이 없습니다.');
    copyText(text, '제목을 복사했습니다.');
    return false;
  },
  copyLink: (d) => { copyText(state.p.coupang[+d.i].url, '수익 링크를 복사했습니다.'); return false; },
  saveCoupangThumb: (d) => {
    const c = state.p.coupang[+d.i];
    if (!c?.img) return toast('저장할 썸네일이 없습니다.');
    const base = koSearchKeyword(state.p) || c.title || 'coupang';
    task('썸네일 저장 중', async () => {
      const file = await api('saveRemoteImage', c.img, base);
      return file ? '썸네일을 저장했습니다.' : '저장을 취소했습니다.';
    });
    return false;
  },
  removeCoupang: (d) => { state.p.coupang.splice(+d.i, 1); },
  clearCoupang: () => { state.p.coupang = []; },

  uploadModal: () => {
    state.modal = { type: 'upload' };
    if (!state.uploadTexts || state.uploadTexts.error) actions.regenUpload();
  },
  regenUpload: () => {
    const p = state.p;
    state.uploadTexts = 'loading';
    render();
    api('uploadTexts', { product: productContext(), productName: p.product?.name || p.name, lines: p.lines, link: p.coupang[0]?.url || '' })
      .then((r) => { state.uploadTexts = r; })
      .catch((e) => { state.uploadTexts = { error: e.message }; })
      .finally(render);
    return false;
  },
  pickUpload: (d) => { state.uploadPick = +d.i; },
  copyUpload: (d) => { copyText(state.uploadTexts.styles[+d.i].text, '문구를 복사했습니다.'); return false; },
  applyUpload: () => {
    const t = state.uploadTexts;
    state.p.upload.desc = t.styles[state.uploadPick].text;
    if (!state.p.upload.title && t.title) state.p.upload.title = t.title;
    state.modal = null;
  },
  togglePlat: (d) => { const p = state.p.upload.platforms; p[d.val] = !p[d.val]; },
  doUpload: () => {
    const p = state.p;
    const u = p.upload;
    const on = Object.entries(u.platforms).filter(([, v]) => v).map(([k]) => k);
    if (!on.length) return toast('업로드할 플랫폼을 선택하세요.');
    const when = u.schedule ? new Date(u.schedule).getTime() : 0;
    const meta = { title: u.title || p.name, desc: u.desc, thumbnail: p.thumbnail };
    task('업로드 중', async () => {
      for (const platform of on) {
        if (when > Date.now() && platform !== 'youtube') {
          u.results.push({ platform, pending: true, text: `${new Date(when).toLocaleString('ko-KR')} 예약 대기 (프로그램을 켜 두세요)` });
          const file = p.exported;
          setTimeout(() => {
            api('upload', platform, file, meta)
              .then((r) => { u.results.push({ platform, ok: true, ...r }); toast(`${platform} 예약 업로드 완료`); })
              .catch((e) => u.results.push({ platform, ok: false, text: e.message }))
              .finally(render);
          }, when - Date.now());
          continue;
        }
        state.status.text = `${platform} 업로드 중`;
        updateStatus();
        try {
          const r = await api('upload', platform, p.exported, { ...meta, publishAt: platform === 'youtube' && when > Date.now() ? u.schedule : null });
          u.results.push({ platform, ok: true, ...r });
        } catch (e) {
          u.results.push({ platform, ok: false, text: e.message });
        }
      }
    }, () => `업로드 처리 완료 (${on.join(', ')})`);
    return false;
  },

  /* tools & settings */
  toolCoupangLink: () => {
    const el = $('#tool-cp');
    const text = (el && el.value || '').trim();
    state.cpLink.text = text;
    if (!text) return toast('쿠팡 상품 링크를 붙여넣으세요.');
    task('쿠팡 파트너스 링크 만드는 중', () => api('coupangLinks', text), (rows) => {
      state.cpLink.rows = rows || [];
      const partner = (rows || []).some((r) => r.partner);
      state.cpLink.note = partner
        ? `${rows.length}개 수익 링크를 만들었습니다.`
        : `${rows.length}개 상품번호를 뽑았습니다. 설정에 파트너스 키를 넣으면 수익 링크로 바뀝니다.`;
      return state.cpLink.note;
    });
    return false;
  },
  toolCoupangClear: () => {
    state.cpLink = { text: ($('#tool-cp') && $('#tool-cp').value) || state.cpLink.text, rows: [], note: '' };
  },
  toolCoupangCopyAll: () => {
    const text = (state.cpLink.rows || []).map((r) => [r.productId, r.url].filter(Boolean).join('\n')).join('\n\n');
    if (!text) return toast('복사할 링크가 없습니다.');
    copyText(text, '링크를 전체 복사했습니다.');
    return false;
  },
  copyVal: (d) => {
    if (!d.val) return toast('복사할 값이 없습니다.');
    copyText(d.val, '복사했습니다.');
    return false;
  },
  toolDownload: () => {
    const url = $('#tool-dl').value.trim();
    if (!url) return toast('링크를 입력하세요.');
    task('다운로드 중', () => api('toolDownload', url), '다운로드 완료');
    return false;
  },
  toolSilence: async () => {
    const file = await api('pickFile', 'video').catch(() => null);
    if (file) task('무음 삭제 중', () => api('toolSilence', file), (r) => `무음 삭제 완료 — ${r.removed.toFixed(1)}초 제거`);
    return false;
  },
  toolTranscribe: async () => {
    const file = await api('pickFile', 'video').catch(() => null);
    if (file) task('자막 추출 중', () => api('toolTranscribe', file), '자막 추출 완료');
    return false;
  },
  hookReset: () => {
    task('훅 기록 지우는 중', () => api('hookReset'), (st) => {
      state.hookStatus = st || state.hookStatus;
      return '사용한 훅 기록을 지웠습니다.';
    });
    return false;
  },
  hookPreview: () => {
    const p = state.p;
    task('제목 훅 뽑는 중', () => fillReelHook(p.edit, p.product?.name || p.cpKeyword || p.name), () => {
      p.lines = withHookLine(p.lines, reelHookTitle(p.edit));
      return `훅: ${reelHookTitle(p.edit)}`;
    }).then(() => api('hookStatus').then((st) => { state.hookStatus = st; render(); }));
    return false;
  },
  installTools: () => { installTools(true); return false; },
  saveSettings: async () => {
    const patch = {};
    document.querySelectorAll('[data-setting]').forEach((el) => { patch[el.dataset.setting] = el.value.trim(); });
    await api('setSettings', patch);
    await refreshMeta();
    state.voices = {};
    toast('설정을 저장했습니다.');
    render();
    return false;
  },
  youtubeConnect: () => {
    actions.saveSettings().then(() =>
      task('유튜브: 기본 브라우저에서 로그인을 완료하세요', () => api('youtubeConnect'), (name) => `유튜브 연결 완료 — ${name}`).then(refreshMeta).then(render),
    );
    return false;
  },

  /* 원클릭배포 */
  snsToggle: (d) => { state.blast.targets[d.val] = !state.blast.targets[d.val]; saveBlastTargets(); },
  snsOpen: (d) => { state.modal = { type: 'sns', key: d.val }; },
  snsManage: () => { state.modal = { type: 'snsList' }; },
  snsSave: async (d) => {
    const key = d.val;
    const patch = {};
    document.querySelectorAll('#modal-root [data-setting]').forEach((el) => { patch[el.dataset.setting] = el.value.trim(); });
    await api('setSettings', patch);
    state.modal = null;
    const s = snsOf(key);
    await task(s.oauth ? `${s.name}: 기본 브라우저에서 로그인을 완료하세요` : `${s.name} 연결 확인 중`, () => api('snsConnect', key), (name) => `${s.name} 연결 완료 — ${name}`);
    await refreshMeta();
    if (snsConn(key)) { state.blast.targets[key] = true; saveBlastTargets(); }
    render();
    return false;
  },
  snsDisconnect: async (d) => {
    await api('snsDisconnect', d.val);
    state.blast.targets[d.val] = false;
    saveBlastTargets();
    state.modal = null;
    await refreshMeta();
    toast(`${snsOf(d.val).name} 연결을 해제했습니다.`);
    render();
    return false;
  },
  snsRefresh: () => {
    const keys = SNS.filter(snsHasCreds).map((s) => s.key);
    if (!keys.length) return toast('연결된 SNS가 없습니다. 카드의 "연결하기"를 누르세요.');
    task('SNS 연결 상태 확인 중', async () => {
      const r = await api('snsCheckAll', keys);
      await refreshMeta();
      return Object.values(r).filter((x) => x.ok).length;
    }, (n) => `연결 확인 완료 — ${n}/${keys.length}개 정상`);
    return false;
  },
  blastPick: async () => {
    const f = await api('pickFile', 'blast');
    if (f) setBlastFile(f);
    return false;
  },
  blastClearFile: () => { Object.assign(state.blast, { file: null, name: '', size: 0 }); },
  blastFromWork: () => {
    const p = state.p;
    setBlastFile(p.exported);
    applyBlastCopy(p, false);
    return false;
  },
  blastTextFromWork: () => {
    applyBlastCopy(state.p, true);
  },
  blastToggle: (d) => {
    state.blast[d.key] = !state.blast[d.key];
    if (d.key === 'scheduleOn' && state.blast.scheduleOn && !state.blast.schedule) {
      const t = new Date(Date.now() + 60 * 60 * 1000);
      t.setMinutes(0, 0, 0);
      state.blast.schedule = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
  },
  blastGo: () => {
    const b = state.blast;
    const targets = blastTargets().map((s) => s.key);
    if (!b.file) return toast('업로드할 영상을 먼저 선택하세요.');
    if (!targets.length) return toast('업로드할 SNS를 하나 이상 선택하세요.');
    if (!b.title.trim() && !b.desc.trim()) return toast('제목이나 설명을 입력하세요.');
    const when = b.scheduleOn && b.schedule ? new Date(b.schedule).getTime() : 0;
    if (b.scheduleOn && when < Date.now() + 2 * 60 * 1000) return toast('예약 시간은 지금부터 2분 이후로 정하세요.');
    if (when && targets.includes('facebook') && when < Date.now() + 10 * 60 * 1000) return toast('페이스북 예약은 10분 이후부터 가능합니다.');
    task(when ? '예약 배포 준비 중' : `원클릭배포 중 (${targets.length}개 채널)`, async () => {
      const r = await api('blast', { file: b.file, title: b.title.trim(), desc: b.desc.trim(), targets, excludeFeed: b.excludeFeed, when });
      await loadBlast();
      return r;
    }, (r) => {
      const ok = r.results.filter((x) => x.ok).length;
      if (r.scheduled) return `예약 완료 — ${r.queued.length ? `${r.queued.length}개 예약 대기` : ''}${r.native.length ? ` · ${ok}/${r.native.length}개 플랫폼 예약 공개 등록` : ''}`;
      return `원클릭배포 완료 — 성공 ${ok} / 실패 ${r.results.length - ok}`;
    });
    return false;
  },
  blastCancel: async (d) => {
    Object.assign(state.blast, await api('blastCancel', d.val));
    toast('예약을 취소했습니다.');
    render();
    return false;
  },
  blastClear: async () => {
    Object.assign(state.blast, await api('blastClear'));
    render();
    return false;
  },
  blastRefresh: () => { loadBlast(); return false; },
  blastTab: (d) => { state.blast.tab = d.val; },
  toBlast: () => {
    const p = state.p;
    state.view = 'blast';
    if (p.exported) setBlastFile(p.exported);
    applyBlastCopy(p, true);
    loadBlast();
  },
};

const enterActions = {
  trendSearch: (v) => {
    state.trendQuery = v.trim();
    if (state.trendMode === 'keyword') { loadTrends(state.trendQuery); return false; }
  },
  addLink: (v) => {
    const url = v.trim();
    if (!/^https?:\/\//.test(url)) return toast('올바른 링크를 붙여넣으세요.');
    const plat = platformOf(url);
    const allowed = [...COUPANG_FILTER_PLATFORMS, 'tiktok'];
    if (!allowed.includes(plat)) return toast('작업 영상은 해외 플랫폼(샤오홍슈·도우인·틱톡·타오바오·1688) 링크만 추가됩니다.');
    if (state.added.length >= 8) return toast('최대 8개까지 추가할 수 있습니다.');
    const look = { xhs: { emoji: '红', hue: 0 }, douyin: { emoji: '抖', hue: 200 }, tiktok: { emoji: '♪', hue: 340 }, taobao: { emoji: '淘', hue: 25 }, ali1688: { emoji: '阿', hue: 35 } }[plat] || { emoji: '▶', hue: 20 };
    state.added.push({ url, title: url, platform: plat, emoji: look.emoji, hue: look.hue });
    toast('해외 영상을 추가했습니다.');
  },
  matchXhs: (v) => startFindOneClick(v),
  coupangOneClick: (v) => {
    if (v) state.findCoupangUrl = String(v).trim();
    return startFindOneClick();
  },
  searchSources: () => { runSearch(); return false; },
  lensSearch: (v) => { state.lens.query = v.trim(); actions.lensSearch(); return false; },
  lensUrl: () => { actions.lensAddUrl(); return false; },
  lensChannel: (v) => { state.lens.findCh = v.trim(); actions.lensChannel(); return false; },
  prepLink: (v) => {
    const url = v.trim();
    if (!/^https?:\/\//.test(url)) return toast('올바른 링크를 붙여넣으세요.');
    const plat = platformOf(url);
    const allowed = [...COUPANG_FILTER_PLATFORMS, 'tiktok'];
    if (!allowed.includes(plat)) return toast('작업 영상은 해외 플랫폼(샤오홍슈·도우인·틱톡·타오바오·1688) 링크만 받습니다.');
    if (state.p.videos.length >= 8) return toast('최대 8개까지 추가할 수 있습니다.');
    const look = { xhs: { emoji: '红', hue: 0 }, douyin: { emoji: '抖', hue: 200 }, tiktok: { emoji: '♪', hue: 340 }, taobao: { emoji: '淘', hue: 25 }, ali1688: { emoji: '阿', hue: 35 } }[plat] || { emoji: '▶', hue: 20 };
    state.p.videos.push({ url, title: url, platform: plat, done: false, emoji: look.emoji, hue: look.hue });
    runDownload();
    return false;
  },
  analyzeStyleEnter: () => actions.analyzeStyle(),
  findCoupang: () => actions.findCoupang(),
  addCoupang: (v) => {
    const url = v.trim();
    if (!/coupang\.com|coupa\.ng/.test(url)) return toast('쿠팡 상품 링크를 붙여넣으세요.');
    const add = (link, extra = {}) => { state.p.coupang.push({ title: state.p.product?.name || '쿠팡 상품', url: link, original: url, ...extra }); render(); };
    if (state.aiStatus.coupang && !/link\.coupang\.com/.test(url)) {
      api('coupangDeeplink', url).then((r) => add(r.url, { partner: true, productId: r.productId || '' })).catch((e) => { toast(e.message); add(url); });
    } else add(url, { partner: /link\.coupang\.com/.test(url) });
    return false;
  },
};

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.tagName === 'INPUT' && el.type !== 'checkbox') return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  const res = fn(el.dataset, e);
  if (res instanceof Promise) return;
  if (res !== false) render();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.dataset?.enter) return;
  const res = enterActions[e.target.dataset.enter](e.target.value, e.target);
  if (e.target.dataset.enter === 'addLink' || e.target.dataset.enter === 'addCoupang' || e.target.dataset.enter === 'prepLink') e.target.value = '';
  if (res !== false) render();
});

document.addEventListener('dragover', (e) => {
  const prep = state.view === 'work' && state.workTab === 1;
  const blast = state.view === 'blast';
  if (!prep && !blast) return;
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  if (blast) $('#blast-drop')?.classList.toggle('over', !!e.target.closest?.('#blast-drop'));
  if (prep) $('#prep-drop')?.classList.toggle('over', !!e.target.closest?.('#prep-panel'));
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) {
    $('#blast-drop')?.classList.remove('over');
    $('#prep-drop')?.classList.remove('over');
  }
});
document.addEventListener('drop', (e) => {
  const prep = state.view === 'work' && state.workTab === 1;
  const blast = state.view === 'blast';
  if (!prep && !blast) return;
  e.preventDefault();
  $('#blast-drop')?.classList.remove('over');
  $('#prep-drop')?.classList.remove('over');
  const files = [...(e.dataTransfer?.files || [])];
  if (prep && e.target.closest?.('#prep-panel')) {
    const paths = files.map((f) => window.native?.pathFor?.(f)).filter(Boolean);
    addDroppedVideos(paths);
    return;
  }
  if (blast && e.target.closest?.('#blast-drop')) {
    const f = files[0];
    if (f && window.native?.pathFor) setBlastFile(window.native.pathFor(f));
  }
});

document.addEventListener('dblclick', (e) => {
  const stage = e.target.closest('.preview, .thumb-stage');
  if (!stage || state.view !== 'work' || state.workTab !== 5 || e.target.closest('input, button, [data-overlay]')) return;
  state.rightPanel = stage.classList.contains('thumb-stage') ? 'thumb' : 'template';
  const r = stage.getBoundingClientRect();
  const item = {
    id: Date.now().toString(36), kind: 'text', text: '문구 입력',
    x: Math.min(92, Math.max(8, ((e.clientX - r.left) / r.width) * 100)),
    y: Math.min(92, Math.max(8, ((e.clientY - r.top) / r.height) * 100)),
    size: 72, bold: true, italic: false, color: '#ffffff', outline: true, shadow: true, opacity: 100,
  };
  activeLayers().push(item);
  state.selectedOverlay = item.id;
  render();
  setTimeout(() => document.querySelector('[data-overlay-text]')?.select(), 30);
});

document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('[data-overlay]');
  if (!h) return;
  const list = h.closest('.thumb-stage') ? state.p.edit.thumbItems : state.p.edit.overlays;
  const item = list.find((o) => o.id === h.dataset.overlay);
  if (!item) return;
  state.selectedOverlay = item.id;
  e.preventDefault();
  const stage = h.closest('.preview, .thumb-stage').getBoundingClientRect();
  let moved = false;
  const move = (ev) => {
    moved = true;
    item.x = Math.min(96, Math.max(4, ((ev.clientX - stage.left) / stage.width) * 100));
    item.y = Math.min(96, Math.max(4, ((ev.clientY - stage.top) / stage.height) * 100));
    h.style.left = `${item.x}%`;
    h.style.top = `${item.y}%`;
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!moved) render();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.lens) {
    state.lens[t.dataset.lens] = t.dataset.num !== undefined ? Number(t.value) : t.value;
    if (t.dataset.lenslive !== undefined) {
      const key = t.dataset.lens;
      const pos = t.selectionStart;
      render();
      const again = document.querySelector(`[data-lens="${key}"]`);
      if (again) {
        again.focus();
        if (typeof pos === 'number' && again.setSelectionRange) again.setSelectionRange(pos, pos);
      }
    }
    return;
  }
  if (t.dataset.modelState === 'sfxVolume') { state.sfxDraft.volume = Number(t.value); return; }
  if (t.dataset.ov) {
    const o = selectedLayer();
    if (!o) return;
    o[t.dataset.ov] = t.dataset.num !== undefined ? Number(t.value) : t.value;
    paintLive(t);
    return;
  }
  if (t.dataset.box) {
    const box = state.p.edit[t.dataset.box];
    box[t.dataset.bf] = t.type === 'range' || t.dataset.num !== undefined ? Number(t.value) : t.value;
    paintLive(t);
    return;
  }
  if (t.dataset.blast) {
    state.blast[t.dataset.blast] = t.value;
    const c = $('#blast-count');
    if (c) c.textContent = `총 ${state.blast.title.length + state.blast.desc.length}자`;
    const m = $('#ocd-meters');
    if (m) m.innerHTML = blastMeters();
    const cap = $('#phone-cap');
    if (cap) cap.innerHTML = phoneCaption();
    return;
  }
  if (t.dataset.modelState === 'findQ1') {
    state.findQ1 = t.value;
    const next = String(t.value || '').trim();
    if (!state.zhManual && state.zhSource && state.zhSource !== next) {
      state.findQ2 = '';
      state.zhSource = '';
      const zhInput = document.querySelector('[data-model-state="findQ2"]');
      if (zhInput) zhInput.value = '';
    }
    return;
  }
  if (t.dataset.modelState === 'findQ2') {
    state.findQ2 = t.value;
    const typed = String(t.value || '').trim();
    state.zhManual = hasHan(typed);
    if (!typed) state.zhSource = '';
    return;
  }
  if (t.dataset.modelState) {
    state[t.dataset.modelState] = t.value;
  } else if (t.dataset.model) {
    let val = t.value;
    if (t.dataset.num !== undefined) val = Number(val);
    setPath(state.p, t.dataset.model, val);
    if (t.dataset.live !== undefined || t.dataset.box || t.dataset.ov || t.dataset.model === 'edit.thumbTime' || t.dataset.model === 'edit.size') paintLive(t);
    if (t.dataset.live !== undefined) {
      const preview = $('.preview');
      if (preview && t.dataset.model === 'edit.headTop') {
        const k = preview.querySelector('.tpl-head .k');
        const b = preview.querySelector('.phone-bar b, .reel-bar b');
        if (k) k.textContent = val;
        if (b) b.textContent = val.replace(/\s+/g, '');
      }
      if (preview && t.dataset.model === 'edit.headTitle') {
        const el = preview.querySelector('.tpl-head .t, .phone-title, .reel-title');
        if (el) el.textContent = val;
      }
      if (preview && t.dataset.model === 'edit.headStat') {
        const el = preview.querySelector('.reel-stat');
        if (el) el.textContent = val;
      }
    }
  } else if (t.dataset.line !== undefined) {
    state.p.lines[+t.dataset.line] = t.value;
    state.p.ttsReady = false;
  } else if (t.dataset.sub !== undefined) {
    const s = state.p.subtitles[+t.dataset.sub];
    if (s) {
      s.text = t.value;
      const shown = $('#pv-sub');
      if (shown && currentSub() === s) shown.textContent = s.text;
    }
  } else if (t.id === 'pv-bar') {
    state.time = Number(t.value);
    if (audioEl && audioEl.dataset?.role === 'editor') audioEl.currentTime = state.time;
    updatePlayer();
  }
});

document.addEventListener('change', (e) => {
  const m = e.target.dataset.model;
  if (!m) return;
  if (m === 'subMaxChars' && state.p.lines.length) buildSubtitles();
  if (e.target.tagName === 'SELECT' || m === 'edit.size' || m.startsWith('product')) render();
});

/* ---------- init ---------- */
async function init() {
  render();
  if (!window.native) return;
  try {
    await refreshMeta();
  } catch {}
  render();
  loadBlast();
  if (!state.tools.ytdlp || !state.tools.ffmpeg) await installTools(false);
  loadTrends();
}

init();
