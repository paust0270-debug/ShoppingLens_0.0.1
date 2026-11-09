const fs = require('fs');
const os = require('os');
const path = require('path');
const { shell, dialog, BrowserWindow, app } = require('electron');
const settings = require('./settings');
const tools = require('./tools');
const project = require('./project');
const yt = require('./ytdlp');
const media = require('./media');
const ai = require('./ai');
const tts = require('./tts');
const coupang = require('./coupang');
const hooks = require('./hooks');
const uploader = require('./upload');
const blast = require('./blast');
const share = require('./share');
const { cancelAll, checkCancel } = require('./run');
const social = require('./socialSearch');

const TREND_QUERIES = ['꿀템', '살림템 추천', '신박한 아이템', '다이소 꿀템', '쿠팡 추천템', '주방 꿀템'];
const TREND_TAGS = ['#꿀템', '#살림템', '#꿀템추천'];

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function fallbackAnalysis(info, transcriptText) {
  const words = info.title.replace(/[^\w가-힣\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 3);
  return {
    product: info.title,
    features: [],
    kw: { ko: words, en: [], zh: [] },
    flow: transcriptText ? transcriptText.slice(0, 160) + (transcriptText.length > 160 ? '…' : '') : '자막이 없어 흐름을 추출하지 못했습니다.',
    why: 'AI 키를 설정하면 떡상 요인을 분석합니다.',
    hook: { visual: '-', ment: transcriptText ? transcriptText.split(/[.?!]/)[0] : '-', point: '-' },
    cta: '-',
    fallback: true,
  };
}

function cleanName(raw) {
  const s = String(raw || '')
    .replace(/#\S+/g, '')
    .replace(/[\[\(【].*?[\]\)】]/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[!?~.|,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s && s.length <= 20 ? s : '이 제품';
}

function fallbackScript(ctx) {
  const name = cleanName(ctx.productName);
  const lines = [
    `일본에서 먼저 난리 난 ${name}, 아직 모르는 사람이 많아요.`,
    `처음 보면 그냥 평범해 보이죠?`,
    `근데 한 번 써보면 왜 찾는지 바로 알아요.`,
    `원래 하던 방식은 매번 번거로웠는데,`,
    `이건 올려두거나 한 번만 누르면 끝나요.`,
    `손도 거의 안 묻고, 자리도 조금만 차지해요.`,
    `매일 반복되던 귀찮은 일이 여기서 줄어요.`,
    `써본 사람들은 원래 쓰던 걸로 못 돌아간대요.`,
    `가격 생각하면 고민할 이유가 없는 템이에요.`,
    `자세한 정보는 프로필 링크에서 확인하세요.`,
  ];
  const sec = Math.max(25, Math.min(40, Math.round(Number(ctx.length) || 30)));
  const count = Math.max(8, Math.min(lines.length, Math.round(sec / 3.2)));
  return lines.slice(0, count - 1).concat(lines[lines.length - 1]);
}

function fallbackUpload(ctx) {
  const p = cleanName(ctx.productName);
  const link = ctx.link || '프로필 링크';
  return {
    title: `${p}, 이건 진짜 써봐야 알아요`,
    styles: [
      { name: '공감 후기형', text: `🔗 정보는 ${link}에서 확인하세요!\n\n${ctx.lines.slice(0, 3).join(' ')}\n\n직접 써보니 왜 다들 찾는지 알겠더라고요. 고민하셨던 분들께 강력 추천해요 ✨\n\n#꿀템 #살림템 #추천템` },
      { name: '쿠팡 체크형', text: `이 포스팅은 쿠팡파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.\n\n${ctx.lines.slice(1, 5).map((l) => `✔ ${l}`).join('\n')}\n\n👉 ${link}\n\n#쿠팡 #쿠팡추천 #꿀템` },
      { name: '호기심형', text: `${ctx.lines[0] || p}\n\n📌 ${link}에서 확인할 수 있어요\n\n${ctx.lines.slice(1, 4).join('\n')}\n\n#신박템 #아이디어상품 #쇼핑` },
    ],
    fallback: true,
  };
}

function readImages(files, max = 12) {
  return files.slice(0, max).filter((f) => f && fs.existsSync(f)).map((f) => fs.readFileSync(f).toString('base64'));
}

async function fetchImageFile(url) {
  const href = String(url || '').trim();
  if (!href || !/^https?:\/\//i.test(href)) return '';
  const res = await fetch(href, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return '';
  const dest = path.join(os.tmpdir(), `sl-thumb-${Date.now().toString(36)}.jpg`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function judgeSource(progress, input) {
  const files = [];
  for (const f of input?.files || []) {
    if (f && fs.existsSync(f)) files.push(f);
  }
  if (input?.file && fs.existsSync(input.file)) files.push(input.file);
  if (!files.length && input?.img) {
    try {
      const saved = await fetchImageFile(input.img);
      if (saved) files.push(saved);
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
    }
  }
  let chinese = false;
  for (const file of files) {
    chinese = /\.(mp4|mov|webm)$/i.test(file)
      ? await media.hasBurnedCaption(file)
      : await media.hasStillCaption(file);
    if (chinese) break;
  }
  let person = false;
  let why = chinese ? '썸네일이나 화면에 중국어 자막이 있습니다' : '';
  if (ai.hasAI() && files.length) {
    try {
      if (progress) progress({ text: '사람·중국어 자막 확인 중' });
      const r = await ai.judgeSource(readImages(files, 3));
      person = !!r.person;
      chinese = chinese || !!r.chinese;
      why = String(r.why || '') || (person ? '사람이 보입니다' : chinese ? '중국어 자막이 있습니다' : '');
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
    }
  }
  return { ok: !person && !chinese, person, chinese, why };
}

function fallbackLensReport(info, transcript) {
  const sentences = String(transcript || '')
    .split(/(?<=[.?!다요])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6);
  const points = (sentences.length ? sentences : [`${info.title || '이 영상'} 내용을 제목 기준으로 추정합니다.`]).slice(0, 5);
  const words = String(info.title || '').replace(/#\S+/g, '').split(/\s+/).filter((w) => w.length > 1).slice(0, 5);
  const n = Math.max(1, Math.min(6, points.length));
  const step = (info.dur || 30) / n;
  return {
    points,
    hooks: points.slice(0, 3),
    keywords: (words.length ? words : ['제품']).map((w) => `${w}: 제목에서 뽑은 소재`),
    timeline: points.slice(0, n).map((text, i) => ({ t: fmtDur(Math.round(i * step)), text })),
    titles: [`${words[0] || '이 제품'}, 직접 써본 결과`, '이거 아직 모르면 손해', info.title].filter(Boolean).slice(0, 5),
    ideas: ['첫 1초에 결과를 보여주고 제품을 공개하기', '쓰던 방식의 불편함을 먼저 말한 뒤 제품으로 해결하기', `${info.channel || '이 채널'} 말투로 15초 쇼츠 다시 만들기`],
    fallback: true,
  };
}

async function mapPool(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    checkCancel();
    out.push(...await Promise.all(list.slice(i, i + size).map((item, k) => fn(item, i + k))));
  }
  return out;
}

function mergeInfo(base, extra) {
  if (!extra) return base;
  return {
    ...base,
    title: extra.title || base.title,
    channel: extra.channel || base.channel,
    views: extra.views || base.views,
    subs: extra.subs || base.subs,
    likes: extra.likes || base.likes || 0,
    comments: extra.comments || base.comments || 0,
    dur: extra.dur || base.dur,
    date: extra.date || base.date || '',
    description: extra.description || base.description || '',
    img: base.img || extra.img,
  };
}

const GENERIC_PRODUCT = /^(생활용품|꿀템|꿀팁|추천|리뷰|살림|인기|신상|필수템|템|용품|생활|好物|分享|生活)$/;

function productWords(text) {
  return String(text || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !GENERIC_PRODUCT.test(w));
}

async function coupangItems(query) {
  if (coupang.hasKeys()) {
    try {
      return await coupang.search(query);
    } catch (e) {
      if (!/NO_COUPANG_KEY|쿠팡 API/.test(String(e.message))) throw e;
    }
  }
  return coupang.searchPage(query);
}

async function verifyCoupang(progress, input) {
  const title = String(input?.title || '').trim();
  const keyword = String(input?.keyword || '').trim();
  progress({ text: '쿠팡에서 같은 제품을 확인하는 중' });
  let query = '';
  let name = '';
  let specific = false;
  if (ai.hasAI()) {
    try {
      const found = await ai.coupangQuery(title, keyword);
      specific = !!found.specific;
      query = String(found.query || '').trim();
      name = String(found.name || query).trim();
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
    }
  }
  if (!specific || query.length < 2) {
    const words = productWords(keyword);
    if (words.length) {
      query = words.slice(0, 3).join(' ');
      name = name || query;
      specific = true;
    }
  }
  if (!specific || query.length < 2) {
    return { ok: false, query: keyword, name: '', items: [], why: '영상에서 제품이 하나로 특정되지 않습니다.' };
  }
  let items = [];
  try {
    items = await coupangItems(query);
  } catch (e) {
    if (/CANCELLED/.test(String(e.message))) throw e;
    return { ok: false, query, name, items: [], why: e.message };
  }
  if (!items.length) return { ok: false, query, name, items, why: '쿠팡 검색 결과가 없습니다.' };
  if (ai.hasAI()) {
    try {
      const match = await ai.coupangSame(title, name || query, items);
      const index = Number(match.index);
      if (match.ok && items[index]) {
        const ordered = [items[index], ...items.filter((_, i) => i !== index)];
        return { ok: true, query, name: name || query, items: ordered, why: String(match.why || '') };
      }
      return { ok: false, query, name, items, why: String(match.why || '쿠팡에 같은 제품이 없습니다.') };
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
    }
  }
  const keys = productWords(name || query);
  const hit = items.findIndex((item) => keys.some((word) => String(item.title || '').includes(word)));
  if (hit < 0) return { ok: false, query, name, items, why: '검색 결과 중에 같은 제품이 없습니다.' };
  return { ok: true, query, name: name || query, items: [items[hit], ...items.filter((_, i) => i !== hit)], why: '' };
}

const api = {
  /* settings & tools */
  getSettings: () => settings.get(),
  setSettings: (_p, patch) => settings.set(patch),
  nextHook: (_p, input) => hooks.next(input || {}),
  hookStatus: () => hooks.status(),
  hookReset: () => hooks.resetUsed(),
  toolsStatus: () => tools.status(),
  installTools: (progress, force) => tools.install(progress, force),
  aiStatus: () => ({ ai: ai.provider(), coupang: coupang.hasKeys() }),
  cancel: () => cancelAll(),

  /* shell */
  openFolder: (_p, name, sub = '') => shell.openPath(name ? project.dir(name, sub) : project.root()),
  openPath: (_p, file) => shell.openPath(file),
  showItem: (_p, file) => shell.showItemInFolder(file),
  openExternal: (_p, url) => (/^https?:\/\//.test(url) ? shell.openExternal(url) : null),
  pickFile: async (_p, kind) => {
    const filters = {
      audio: [{ name: '오디오', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg'] }],
      video: [{ name: '영상/오디오', extensions: ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a'] }],
      blast: [{ name: '영상', extensions: ['mp4', 'mov', 'webm', 'm4v'] }],
      image: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      json: [{ name: '템플릿', extensions: ['json'] }],
    }[kind];
    const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { properties: ['openFile'], filters });
    return r.canceled ? null : r.filePaths[0];
  },

  /* projects */
  listProjects: () => project.list(),
  saveProject: (_p, p) => project.save(p),
  loadProject: (_p, name) => project.load(name),

  /* trends & search */
  trends: async (progress, { query, period }) => {
    const key = settings.get().youtubeApi;
    const queries = query ? [query] : TREND_QUERIES;
    const dedupe = (list) => {
      const seen = new Set();
      return list.filter((v) => v && v.id && !seen.has(v.id) && seen.add(v.id));
    };
    const trim = (list) => dedupe(list).filter((v) => !v.dur || v.dur <= 90).sort((a, b) => b.views - a.views);
    let apiError = '';
    let main = [];
    if (key) {
      progress({ text: '유튜브 API로 쇼츠 모으는 중' });
      const parts = await Promise.all(queries.map((q) => yt.searchYoutubeApi(key, q, query ? null : period, 50).catch((e) => {
        apiError = e.message;
        return [];
      })));
      main = trim(parts.flat());
      if (main.length) return { items: main.slice(0, 100), source: 'api' };
    }
    progress({ text: '유튜브에서 쇼핑 쇼츠 모으는 중' });
    const scraped = await Promise.all(queries.map((q) => yt.searchYoutube(q, { limit: 40, filter: query ? 'popular' : period }).catch((e) => {
      apiError = apiError || e.message;
      return [];
    })));
    main = trim(scraped.flat());
    const tags = query ? [`#${query.replace(/\s+/g, '')}`] : TREND_TAGS;
    const popular = (await Promise.all(tags.map((t) => yt.searchYoutube(t, { limit: 40 }).catch(() => [])))).flat();
    const strong = main.filter((v) => v.views >= 1000);
    const weak = main.filter((v) => v.views < 1000);
    const items = dedupe([...strong, ...popular, ...weak]).filter((v) => !v.dur || v.dur <= 90).slice(0, 100);
    if (!items.length) throw new Error(apiError || '유튜브에서 쇼츠를 찾지 못했습니다.');
    const quota = /quota/i.test(apiError);
    return {
      items,
      source: 'ytdlp',
      notice: quota ? '오늘 YouTube 검색 한도를 다 써서, 한도 없이 모은 쇼츠 목록을 보여 줍니다.' : '',
    };
  },
  searchVideos: async (_p, query) => {
    const key = settings.get().youtubeApi;
    let list = [];
    if (key) {
      try { list = await yt.searchYoutubeApi(key, query, null, 30); } catch { list = []; }
    }
    if (!list.length) list = await yt.searchYoutube(query, { limit: 30, filter: 'short' });
    return list.filter((v) => !v.dur || v.dur <= 180);
  },
  searchSocial: async (progress, platform, query) => {
    const presets = require('../src/presets');
    const p = (presets.platforms || []).find((x) => x.id === platform);
    if (!p?.search) throw new Error('이 플랫폼은 목록 검색을 지원하지 않습니다.');
    let q = String(query || '').trim();
    if (!q) throw new Error('검색어를 입력하세요.');
    if (['xhs', 'douyin', 'taobao', 'ali1688'].includes(platform) && !/[\u4e00-\u9fff]/.test(q)) {
      progress({ text: `${p.label} 검색어 중국어로 번역 중` });
      try {
        const zh = String(await api.translateZh(progress, q) || '').trim();
        if (/[\u4e00-\u9fff]/.test(zh)) q = zh;
      } catch (e) {
        if (/CANCELLED/.test(String(e.message))) throw e;
      }
      if (platform === 'xhs' && !/[\u4e00-\u9fff]/.test(q)) {
        throw new Error('샤오홍슈는 중국어 검색어가 필요합니다. 번역을 확인한 뒤 다시 누르세요.');
      }
    }
    progress({ text: `${p.label} 검색 목록 가져오는 중` });
    let url = p.search(q);
    if (platform === 'douyin') url += (url.includes('?') ? '&' : '?') + 'type=video';
    return social.searchSocial(platform, url, p.label);
  },
  searchByImage: async (progress, platform, imageUrl) => {
    const label = { taobao: '타오바오', ali1688: '1688' }[platform] || platform;
    progress({ text: `${label} 이미지 검색 중 · 접속 이상이 뜨면 크롬에서 안내가 사라질 때까지 기다립니다` });
    return social.searchByImage(platform, imageUrl, label);
  },
  grabSocialVideo: async (progress, url, platform) => {
    progress({ text: '상품 페이지에서 영상 찾는 중 · 접속 이상이 뜨면 영상 상세가 숨겨집니다. 크롬에서 안내가 사라지면 이어갑니다' });
    return social.grabSocialVideo(url, platform);
  },
  matchSocial: async (progress, query, zh, platforms) => {
    const q = String(query || zh || '').trim();
    const z = String(zh || q).trim();
    if (!q) throw new Error('검색어를 입력하세요.');
    if (!ai.hasAI()) throw new Error('영상 비교에는 Gemini 또는 OpenAI 키가 필요합니다.');
    const searchPlatforms = platforms || ['ali1688', 'xhs', 'douyin'];
    progress({ text: '유튜브 쇼츠 검색 중' });
    const youtube = (await api.searchVideos(progress, q)).slice(0, 6).map((v) => ({ ...v, platform: 'youtube' }));
    if (!youtube.length) throw new Error('비교할 유튜브 쇼츠를 찾지 못했습니다.');
    let allSocial = [];
    let anyNeedLogin = false;
    for (const plat of searchPlatforms) {
      const label = { xhs: '샤오홍슈', douyin: '도우인', taobao: '타오바오', ali1688: '1688' }[plat] || plat;
      progress({ text: `${label} 영상 검색 중` });
      try {
        const found = await api.searchSocial(progress, plat, z);
        const items = (found.items || []).slice(0, 8).map((v) => ({ ...v, platform: plat }));
        if (found.needLogin && !items.length) anyNeedLogin = true;
        allSocial.push(...items);
      } catch (e) {
        if (/CANCELLED/.test(String(e.message))) throw e;
      }
      if (allSocial.length >= 16) break;
    }
    if (!allSocial.length) return { youtube, xhs: allSocial, social: allSocial, pairs: [], needLogin: anyNeedLogin };
    progress({ text: '썸네일로 같은 영상 찾는 중' });
    const ytImgs = await social.grabThumbs(youtube.map((v) => v.img));
    const scImgs = await social.grabThumbs(allSocial.map((v) => v.img));
    const ytOk = [];
    const scOk = [];
    const images = [];
    youtube.forEach((v, i) => { if (ytImgs[i]) { ytOk.push(v); images.push(ytImgs[i]); } });
    allSocial.forEach((v, i) => { if (scImgs[i]) { scOk.push(v); images.push(scImgs[i]); } });
    if (!ytOk.length || !scOk.length) {
      return { youtube, xhs: allSocial, social: allSocial, pairs: [], needLogin: false, note: '썸네일을 읽지 못해 화면 비교를 못 했습니다. 소셜 목록에서 직접 고르세요.' };
    }
    const judged = await ai.matchClips(ytOk, scOk, images);
    const ranked = [];
    const usedY = new Set();
    const usedX = new Set();
    (judged.pairs || [])
      .map((p) => ({
        youtube: ytOk[Number(p.y)],
        xhs: scOk[Number(p.x)],
        score: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))),
        why: String(p.why || '').slice(0, 80),
      }))
      .filter((p) => p.youtube && p.xhs)
      .sort((a, b) => b.score - a.score)
      .forEach((p) => {
        if (usedY.has(p.youtube.url) || usedX.has(p.xhs.url)) return;
        usedY.add(p.youtube.url);
        usedX.add(p.xhs.url);
        ranked.push(p);
      });
    const strong = ranked.filter((p) => p.score >= 70).slice(0, 6);
    const pairs = strong.length ? strong : ranked.filter((p) => p.score >= 58).slice(0, 3);
    const note = pairs.length
      ? (strong.length ? '' : '70% 이상으로 같은 영상은 없고, 가장 가까운 후보만 보여 줍니다.')
      : '화면이 거의 같은 쌍은 없습니다. 소셜 탭에서 영상을 직접 고르세요.';
    return { youtube, xhs: allSocial, social: allSocial, pairs, needLogin: false, note };
  },
  matchXhs: async (progress, query, zh) => {
    return api.matchSocial(progress, query, zh, ['xhs']);
  },
  translateZh: async (_p, text) => {
    const q = String(text || '').trim();
    if (!q) return '';
    if (/[\u4e00-\u9fff]/.test(q) && !/[가-힣A-Za-z]/.test(q)) return q;
    if (!ai.hasAI()) throw new Error('중국어 번역에는 Gemini 키가 필요합니다.');
    for (let i = 0; i < 2; i++) {
      try {
        const zh = await ai.translateZh(q);
        if (zh && /[一-鿿]/.test(zh)) return zh;
      } catch (e) {
        if (/CANCELLED/.test(String(e.message))) throw e;
      }
    }
    return '';
  },
  lensSearch: async (progress, { query, sort = 'views', limit = 30, shorts = false, region = 'KR', period = 'all' }) => {
    const q = String(query || '').trim();
    if (!q) throw new Error('검색어를 입력하세요.');
    const key = settings.get().youtubeApi;
    const cap = Math.max(5, Math.min(50, +limit || 30));
    progress({ text: '유튜브 검색 중' });
    let items;
    const apiPeriod = period && period !== 'all' ? period : null;
    if (key) {
      items = await yt.searchYoutubeApi(key, q, apiPeriod, cap, { shorts, order: sort === 'date' ? 'date' : 'viewCount', region: region || 'KR' });
      return { items, source: 'api' };
    }
    items = await yt.searchLens(q, { limit: cap, sort, shorts });
    const enrichN = Math.min(12, items.length);
    progress({ text: `조회수·채널 정보 채우는 중 (0/${enrichN})` });
    const head = await mapPool(items.slice(0, enrichN), 3, async (v, i) => {
      progress({ text: `조회수·채널 정보 채우는 중 (${i + 1}/${enrichN})`, progress: (i + 1) / enrichN });
      const extra = await yt.info(v.url).catch(() => null);
      return mergeInfo(v, extra);
    });
    items = [...head, ...items.slice(enrichN)];
    if (apiPeriod) {
      const days = { today: 1, week: 7, month: 30, year: 365 }[apiPeriod];
      const cut = Date.now() - days * 864e5;
      const dated = items.filter((v) => v.date && new Date(v.date.replace(' ', 'T')).getTime() >= cut);
      if (dated.length) items = dated;
    }
    return { items, source: 'ytdlp' };
  },
  lensChannels: async (progress, query) => {
    progress({ text: '채널 찾는 중' });
    const key = settings.get().youtubeApi;
    if (/^https?:\/\//.test(String(query))) {
      const info = await yt.info(query).catch(() => null);
      if (info?.channel) return [{ id: info.id, url: query, name: info.channel, subs: info.subs || 0, videos: 0, img: '' }];
    }
    const list = await yt.searchChannels(query, 12);
    if (key && !list.length) return [];
    return list;
  },
  lensChannelVideos: async (progress, channels, perChannel = 20) => {
    const all = [];
    for (let i = 0; i < channels.length; i++) {
      checkCancel();
      const c = channels[i];
      progress({ text: `${c.name || '채널'} 영상 모으는 중 (${i + 1}/${channels.length})`, progress: i / channels.length });
      const vids = await yt.channelVideos(c.url, Math.max(5, Math.min(40, +perChannel || 20))).catch(() => []);
      vids.forEach((v) => { if (!v.subs && c.subs) v.subs = c.subs; if (!v.channel) v.channel = c.name; });
      all.push(...vids);
    }
    const seen = new Set();
    const uniq = all.filter((v) => !seen.has(v.id) && seen.add(v.id));
    const enrichN = Math.min(12, uniq.length);
    const head = await mapPool(uniq.slice(0, enrichN), 3, async (v) => mergeInfo(v, await yt.info(v.url).catch(() => null)));
    return { items: [...head, ...uniq.slice(enrichN)], source: 'ytdlp' };
  },
  lensReport: async (progress, url) => {
    const base = await api.analyzeVideo(progress, url);
    const cues = yt.readCues(path.join(app.getPath('temp'), 'shoppinglens', base.info.id || 'video'));
    let report = null;
    if (ai.hasAI()) {
      progress({ text: '분석 리포트 정리 중' });
      try { report = await ai.lensReport(base.info, base.transcript, cues); } catch {}
    }
    const made = report || fallbackLensReport(base.info, base.transcript);
    if (!report) made.fallback = true;
    if (!made.timeline?.length && cues.length) {
      const step = Math.max(1, Math.ceil(cues.length / 6));
      made.timeline = cues.filter((_, i) => i % step === 0).slice(0, 6).map((c) => ({ t: fmtDur(c.t), text: c.text }));
    }
    return { ...base, report: made };
  },
  lensScript: async (progress, ctx) => {
    if (!ai.hasAI()) {
      const bits = String(ctx.transcript || ctx.title || '').split(/(?<=[.?!다요])\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
      const text = ctx.mode === 'structure'
        ? `1. 문제\n${bits[0] || ctx.title}\n\n2. 시연\n${bits.slice(1, 4).join('\n') || '제품이 쓰이는 장면을 보여 줍니다.'}\n\n3. 마무리\n${bits.at(-1) || '링크에서 확인해 보세요.'}`
        : (bits.length ? bits : [ctx.title]).join('\n');
      return { text, fallback: true };
    }
    progress({ text: '대본 쓰는 중' });
    const r = await ai.lensScript(ctx);
    return { text: r.text || (r.lines || []).join('\n'), fallback: false };
  },
  lensIdeas: async (progress, topic) => {
    const seed = String(topic || '').trim();
    if (!seed) throw new Error('검색어나 영상을 먼저 고르세요.');
    if (!ai.hasAI()) {
      return {
        ideas: [`${seed} 결과를 첫 장면에 두기`, `${seed} 쓰기 전후를 5초 안에 보여 주기`, `${seed} 댓글 질문을 첫 문장으로 쓰기`],
        titles: [`${seed}, 직접 써봄`, `${seed} 이거 실화냐`, `모르면 손해인 ${seed}`],
        fallback: true,
      };
    }
    progress({ text: '아이디어 만드는 중' });
    return ai.lensIdeas(seed);
  },
  lensInfo: (_p, url) => yt.info(url),
  lensCaption: async (progress, url) => {
    progress({ text: '자막 확인 중' });
    const meta = await yt.info(url);
    const text = await yt.transcript(url, path.join(app.getPath('temp'), 'shoppinglens', meta.id || 'cap'));
    return { has: !!text, id: meta.id };
  },
  lensDownload: async (progress, url, kind) => {
    const dir = project.dir('_분석기', kind === 'mp3' ? 'audio' : 'videos');
    const base = `lens_${Date.now().toString(36)}`;
    progress({ text: kind === 'mp3' ? 'MP3 추출 중' : 'MP4 받는 중' });
    const file = kind === 'mp3' ? await yt.downloadAudio(url, dir, base) : await yt.download(url, dir, base, (r) => progress({ progress: r }));
    shell.showItemInFolder(file);
    return file;
  },
  analyzeVideo: async (progress, url) => {
    progress({ text: '영상 정보 가져오는 중' });
    const info = await yt.info(url);
    progress({ text: '자막 가져오는 중' });
    const tmp = path.join(app.getPath('temp'), 'shoppinglens', info.id || 'video');
    let transcriptText = await yt.transcript(url, tmp);
    if (!transcriptText && ai.hasAI() && info.dur && info.dur < 240) {
      progress({ text: '음성 받아쓰는 중 (STT)' });
      const audio = await yt.downloadAudio(url, tmp, 'audio');
      transcriptText = await ai.transcribe(audio).catch(() => '');
    }
    let analysis;
    let aiError = null;
    if (ai.hasAI()) {
      progress({ text: 'AI 영상 분석 중' });
      try {
        analysis = await ai.analyzeVideo(info, transcriptText);
      } catch (e) {
        aiError = e.message;
      }
    }
    return { info, transcript: transcriptText, analysis: analysis || fallbackAnalysis(info, transcriptText), aiError };
  },

  /* workroom */
  download: async (progress, name, video, index) => {
    const dir = project.dir(name, 'videos');
    const base = `src${index + 1}_${Date.now().toString(36)}`;
    let file;
    if (video.media && /^https?:/i.test(video.media) && !/\.m3u8(\?|$)/i.test(video.media)) {
      progress({ text: '상품 영상 받는 중' });
      file = await social.fetchSocialFile(video.media, path.join(dir, `${base}.mp4`), video.platform);
    } else {
      file = await yt.download(video.url, dir, base, (r) => progress({ progress: r }));
    }
    const meta = await media.probe(file);
    const thumb = await media.frame(file, Math.min(1, meta.dur / 3), path.join(dir, `${base}.jpg`), 360);
    return { file, thumb, dur: meta.dur, hasAudio: meta.hasAudio, size: fs.statSync(file).size };
  },
  probeCaption: async (_progress, file) => ({ has: await media.hasBurnedCaption(file) }),
  judgeSource: (progress, input) => judgeSource(progress, input),
  analyzeSources: async (progress, name, videos) => {
    const out = [];
    for (let i = 0; i < videos.length; i++) {
      checkCancel();
      const v = videos[i];
      const scenes = await media.detectScenes(v.file, project.dir(name, 'scenes'), `src${i + 1}`, (r) =>
        progress({ text: `소스 ${i + 1}/${videos.length} 장면 분석 중`, progress: (i + r) / videos.length }),
      );
      let labels = scenes.map((s, k) => `장면 ${k + 1} (${s.start.toFixed(1)}~${s.end.toFixed(1)}초)`);
      let summary = `${scenes.length}개 장면`;
      if (ai.hasAI()) {
        progress({ text: `소스 ${i + 1} 장면 AI 설명 중` });
        try {
          const r = await ai.labelScenes(readImages(scenes.map((s) => s.thumb), 8));
          if (Array.isArray(r.labels)) labels = labels.map((l, k) => r.labels[k] || l);
          summary = labels.slice(0, 4).join(', ');
        } catch (e) {
          if (/CANCELLED/.test(e.message)) throw e;
        }
      }
      scenes.forEach((s, k) => (s.label = labels[k]));
      const source = v.file;
      const burned = await media.hasBurnedCaption(source);
      let band = null;
      if (burned && ai.hasAI() && scenes.length) {
        const picks = [scenes[0], scenes[Math.floor(scenes.length / 2)], scenes[scenes.length - 1]];
        try {
          const found = await ai.captionBand(readImages(picks.map((s) => s.thumb), 3));
          const y = Number(found?.y);
          const h = Number(found?.h);
          if (Number.isFinite(y) && Number.isFinite(h) && h >= 0.04) band = { y: Math.max(0, y - 0.02), h: Math.min(0.28, h + 0.04) };
        } catch (e) {
          if (/CANCELLED/.test(e.message)) throw e;
        }
      }
      progress({ text: burned ? `소스 ${i + 1} 원본 음성·자막 지우는 중` : `소스 ${i + 1} 원본 음성만 끄는 중`, progress: (i + 0.85) / videos.length });
      const cleaned = path.join(project.dir(name, 'videos'), `src${i + 1}_clean.mp4`);
      await media.cleanSource(source, cleaned, burned ? (band || {}) : null, (r) => progress({ text: `소스 ${i + 1} 원본 음성·자막 지우는 중`, progress: (i + 0.85 + r * 0.15) / videos.length }));
      const sceneDir = project.dir(name, 'scenes');
      for (let k = 0; k < scenes.length; k++) {
        checkCancel();
        const s = scenes[k];
        s.thumb = await media.frame(cleaned, (s.start + s.end) / 2, path.join(sceneDir, `src${i + 1}_c${k}.jpg`), 200);
      }
      const meta = await media.probe(cleaned);
      const thumb = await media.frame(cleaned, Math.min(1, meta.dur / 3), path.join(project.dir(name, 'videos'), `src${i + 1}_clean.jpg`), 360);
      out.push({ scenes, summary, file: cleaned, originalFile: source, thumb, hasAudio: false, cleaned: true, dur: meta.dur, size: fs.statSync(cleaned).size, captionBand: band });
    }
    return out;
  },
  analyzeStyle: async (progress, url) => {
    const r = await api.analyzeVideo(progress, url);
    let style;
    if (ai.hasAI()) {
      progress({ text: 'AI 스타일 분석 중' });
      style = await ai.analyzeStyle(r.info, r.transcript);
    } else {
      const sentences = r.transcript ? r.transcript.split(/[.?!]\s*/).filter(Boolean).length : 0;
      style = {
        title: r.info.title,
        summary: {
          length: `${Math.round(r.info.dur)}초`, hook: r.analysis.hook.ment || '-', speed: sentences ? `${sentences}문장` : '-',
          flow: '-', tone: '-', expose: '-', cta: '-', guide: 'AI 키를 설정하면 상세 분석됩니다.',
        },
      };
    }
    return { ...style, img: r.info.img, url: r.info.url, transcript: r.transcript, analysis: r.analysis, info: r.info };
  },
  genScript: async (progress, ctx) => {
    if (!ai.hasAI()) return { lines: fallbackScript(ctx), fallback: true };
    progress({ text: 'AI 대본 작성 중' });
    const r = await ai.script(ctx);
    return { lines: (r.lines || []).map((l) => String(l).trim()).filter(Boolean) };
  },
  voices: (_p, provider) => tts.voices(provider),
  credits: (_p, provider) => tts.credits(provider),
  genVoice: async (progress, name, lines, opt) => {
    const dir = project.dir(name, 'audio');
    const stamp = Date.now().toString(36);
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      checkCancel();
      progress({ text: `음성 생성 중 (${i + 1}/${lines.length})`, progress: i / lines.length });
      const raw = await tts.synth(lines[i], {
        ...opt,
        onWait: (sec) => progress({ text: `음성 한도라 ${sec}초 후 다시 시도 (${i + 1}/${lines.length})`, progress: i / lines.length }),
      }, path.join(dir, `line${i + 1}_${stamp}`));
      const { dur } = await media.probe(raw);
      result.push({ file: raw, dur });
    }
    return result;
  },
  fitVoice: async (progress, name, audios) => {
    const total = (audios || []).reduce((a, x) => a + (Number(x.dur) || 0), 0);
    if (!(total > 40)) return audios;
    const factor = total / 38;
    const dir = project.dir(name, 'audio');
    const stamp = Date.now().toString(36);
    const out = [];
    for (let i = 0; i < audios.length; i++) {
      checkCancel();
      progress({ text: `낭독을 40초 안으로 맞추는 중 (${i + 1}/${audios.length})`, progress: i / audios.length });
      const dest = path.join(dir, `fit${i + 1}_${stamp}.wav`);
      await media.scaleAudio(audios[i].file, dest, factor);
      out.push({ file: dest, dur: (await media.probe(dest)).dur });
    }
    return out;
  },
  aiMatch: async (progress, lines, sources) => {
    if (!ai.hasAI()) return null;
    progress({ text: 'AI 장면 매칭 중' });
    const r = await ai.matchScenes(lines, sources);
    return r.matches || null;
  },
  fixSubs: async (_p, texts) => {
    if (!ai.hasAI()) return texts.map((t) => t.replace(/\s+/g, ' ').trim());
    const r = await ai.fixSubtitles(texts);
    return Array.isArray(r.texts) && r.texts.length === texts.length ? r.texts : texts;
  },
  prepareEdit: async (progress, name, audios, silence) => {
    const dir = project.dir(name, 'audio');
    const out = [];
    for (let i = 0; i < audios.length; i++) {
      checkCancel();
      progress({ text: `음성 다듬는 중 (${i + 1}/${audios.length})`, progress: (i / audios.length) * 0.9 });
      const wav = await media.toWav(audios[i].file, path.join(dir, `prep${i + 1}.wav`), silence);
      out.push({ file: wav, dur: (await media.probe(wav)).dur });
    }
    progress({ text: '음성 합치는 중', progress: 0.95 });
    const voiceFile = await media.concatAudio(out.map((a) => a.file), path.join(dir, `voice_${Date.now().toString(36)}.wav`));
    return { audios: out, voiceFile };
  },
  render: (progress, name, payload) => media.render(project.dir(name), payload, progress),
  makeThumb: (_p, name, file, t) => media.frame(file, t, path.join(project.dir(name, 'output'), `thumbnail_${Date.now().toString(36)}.jpg`), 1080),
  composeThumb: async (_p, name, file, t, opts) => {
    const dir = project.dir(name, 'output');
    const raw = path.join(dir, `thumbraw_${Date.now().toString(36)}.jpg`);
    const out = path.join(dir, `thumbnail_${Date.now().toString(36)}.jpg`);
    await media.frame(file, t || 0, raw, 1080);
    await media.composeStill(raw, out, opts || {});
    fs.rmSync(raw, { force: true });
    return out;
  },
  prependThumb: (_p, name, video, image) => media.prependStill(video, image, 5, path.join(project.dir(name, 'output'), `final_lead_${Date.now().toString(36)}.mp4`)),
  makeIntro: (_p, name, image, text) => {
    const out = path.join(project.dir(name, 'videos'), `intro_${Date.now().toString(36)}.mp4`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    return media.introClip(image, text, out);
  },
  makeSfx: (_p, name, text, volume) => {
    const out = path.join(project.dir(name, 'audio'), `sfx_${Date.now().toString(36)}.wav`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    return media.synthSfx(text, out, volume);
  },
  sfxSuggest: async (_p, ctx) => {
    if (!ai.hasAI()) return { make: 'whoosh, click, pop', remove: 'background music, noise', fallback: true };
    try {
      const r = await ai.json('쇼핑 쇼츠에 넣을 짧은 효과음 키워드를 추천한다. JSON {make, remove}. 값은 쉼표로 구분한 한국어 또는 영어 단어.', String(ctx || ''));
      return { make: r.make || 'whoosh, click', remove: r.remove || 'music, noise', fallback: false };
    } catch {
      return { make: 'whoosh, click, pop', remove: 'background music, noise', fallback: true };
    }
  },
  introLine: async (_p, product, line) => {
    if (!ai.hasAI()) return line;
    try {
      const r = await ai.json('쇼핑 쇼츠 첫 문장을 28자 안으로 다듬는다. JSON {line}.', `제품: ${product}\n문장: ${line}`);
      return r.line || line;
    } catch {
      return line;
    }
  },
  exportCapcut: (_p, name, file) => {
    const dir = path.join(project.dir(name, 'output'), `capcut_${Date.now().toString(36)}`);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(file));
    fs.copyFileSync(file, dest);
    fs.writeFileSync(path.join(dir, 'draft_content.json'), JSON.stringify({
      canvas_config: { width: 1080, height: 1920, ratio: '9:16' },
      materials: { videos: [{ id: 'v1', path: dest, type: 'video' }] },
      tracks: [{ type: 'video', segments: [{ material_id: 'v1', target_timerange: { start: 0, duration: 0 } }] }],
    }, null, 2));
    shell.showItemInFolder(dir);
    return dir;
  },
  shareStart: (_p, file) => share.start(file),
  shareStop: () => { share.stop(); return true; },
  saveText: (_p, name, rel, text) => {
    const file = path.join(project.dir(name), rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    return file;
  },
  readText: (_p, file) => fs.readFileSync(file, 'utf8'),

  /* coupang */
  verifyCoupang: (progress, input) => verifyCoupang(progress, input),
  coupangSearch: (_p, keyword) => coupang.search(keyword),
  coupangBrowse: (progress, keyword) => {
    progress({ text: '쿠팡 시크릿 창에서 상품을 찾는 중' });
    return coupang.searchPage(keyword);
  },
  coupangDeeplink: async (_p, url) => (await coupang.deeplink([url]))[0],
  coupangLinks: async (_p, text) => coupang.makeLinks(text),
  coupangProductInfo: async (progress, url) => {
    progress({ text: '쿠팡 시크릿 창에서 상품 정보 추출 중' });
    return coupang.scrapePage(url);
  },

  /* upload */
  uploadTexts: async (progress, ctx) => {
    if (!ai.hasAI()) return fallbackUpload(ctx);
    progress({ text: 'AI 업로드 문구 작성 중' });
    return ai.uploadTexts({ ...ctx, product: ctx.product || ctx.productName });
  },
  youtubeConnect: () => uploader.youtubeConnect(),
  upload: (progress, platform, file, meta) => uploader.upload(platform, file, meta, progress),

  /* multi publisher */
  snsConnect: (_p, key) => uploader.connect(key),
  snsCheckAll: async (_p, keys) => Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await uploader.check(k)]))),
  snsDisconnect: (_p, key) => uploader.disconnect(key),
  blast: (progress, payload) => blast.blast(progress, payload),
  blastState: () => blast.state(),
  blastCancel: (_p, id) => blast.cancelJob(id),
  blastClear: () => blast.clearHistory(),
  fileInfo: (_p, file) => (fs.existsSync(file) ? { file, name: path.basename(file), size: fs.statSync(file).size } : null),

  /* tools page */
  toolDownload: async (progress, url) => {
    const dir = path.join(project.root(), '_downloads');
    const file = await yt.download(url, dir, `dl_${Date.now().toString(36)}`, (r) => progress({ text: `다운로드 중 ${Math.round(r * 100)}%`, progress: r }));
    shell.showItemInFolder(file);
    return file;
  },
  toolSilence: async (progress, file) => {
    progress({ text: '무음 구간 찾는 중' });
    const ext = path.extname(file);
    const r = await media.removeSilence(file, file.slice(0, -ext.length) + '_무음삭제' + ext);
    shell.showItemInFolder(r.out);
    return r;
  },
  toolTranscribe: async (progress, file) => {
    if (!ai.hasAI()) throw new Error('자막 추출은 OpenAI 또는 Gemini 키가 필요합니다.');
    progress({ text: '오디오 추출 중' });
    const audio = await media.extractAudio(file, path.join(app.getPath('temp'), `sl_stt_${Date.now()}.mp3`));
    progress({ text: '받아쓰는 중' });
    const text = await ai.transcribe(audio);
    const out = file.replace(/\.[^.]+$/, '') + '_자막.txt';
    fs.writeFileSync(out, text, 'utf8');
    shell.showItemInFolder(out);
    return out;
  },
};

module.exports = { api, fmtDur };
