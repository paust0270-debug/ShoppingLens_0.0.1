const fs = require('fs');
const path = require('path');
const { app, net, session } = require('electron');
const { checkCancel } = require('./run');
const chromeCookies = require('./chromeCookies');
const chromeDriver = require('./chromeDriver');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const PART = 'persist:shoppinglens-social';

const LOOK = {
  tiktok: { hue: 340, emoji: '♪' },
  instagram: { hue: 280, emoji: '◎' },
  xhs: { hue: 0, emoji: '红' },
  douyin: { hue: 200, emoji: '抖' },
  taobao: { hue: 25, emoji: '淘' },
  ali1688: { hue: 35, emoji: '阿' },
};

function sleep(ms) {
  return new Promise((resolve, reject) => {
    const step = setInterval(() => {
      try { checkCancel(); } catch (e) { clearInterval(step); clearTimeout(done); reject(e); }
    }, 250);
    const done = setTimeout(() => { clearInterval(step); resolve(); }, ms);
  });
}

const ACCESS_BLOCK = /访问异常|当前访问存在异常|访问存在异常|商品详情页将在一段时间后|恢复正常访问/i;
const BLOCK_HINT = /滑动验证|拖动滑块|请完成安全|安全验证|punish|_____tmd_____|x5sec|nc_1_n1z|captcha|机器人检测|unusual traffic|비정상 접근|보안 확인|슬라이더를|퍼즐을 맞추|访问异常|当前访问存在异常|访问存在异常|商品详情页将在一段时间后|恢复正常访问/i;
const ACCESS_ERR = '접속 이상이 떠 있어 영상 상세가 숨겨져 있습니다. 크롬에서 안내가 사라진 뒤 다시 누르세요.';

function canonicalShopUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (/1688|alibaba/i.test(s) || /\/offer\/\d{8,}/.test(s)) {
    const offer = s.match(/offer(?:id)?[=/_-](\d{8,})/i) || s.match(/\/offer\/(\d{8,})/i);
    if (offer) return `https://detail.1688.com/offer/${offer[1]}.html`;
  }
  const id = s.match(/[?&]id=(\d{8,})/);
  if (id && /taobao|tmall/i.test(s)) {
    return /tmall/i.test(s)
      ? `https://detail.tmall.com/item.htm?id=${id[1]}`
      : `https://item.taobao.com/item.htm?id=${id[1]}`;
  }
  return s.split('#')[0];
}

async function pageHint(tab) {
  return tab.eval(`({ href: location.href || '', text: (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 900) })`).catch(() => ({ href: '', text: '' }));
}

async function waitIfBlocked(tab, label) {
  const start = Date.now();
  let warned = false;
  while (Date.now() - start < 300000) {
    checkCancel();
    const h = await pageHint(tab);
    const blob = `${h.href} ${h.text}`;
    if (!BLOCK_HINT.test(blob)) return false;
    if (!warned) {
      const msg = ACCESS_BLOCK.test(blob)
        ? `${label || '1688'} 접속 이상 — 이 안내가 있으면 영상 상세가 숨겨집니다. 크롬에서 없어질 때까지 기다립니다`
        : `${label || 'search'} 보안 확인 대기 — 크롬 창에서 슬라이더를 맞추면 이어갑니다`;
      console.log(`[${label || 'search'}] ${msg}`);
      warned = true;
      try { await tab.send('Page.bringToFront'); } catch {}
    }
    await sleep(2500);
  }
  return true;
}

const CLICK_VIDEO = `(() => {
  const nodes = [...document.querySelectorAll('div, span, button, a, li')];
  const tab = nodes.find((el) => {
    const t = (el.innerText || '').trim();
    return t === '视频' || t === '동영상' || t === 'Video';
  });
  if (!tab) return false;
  tab.click();
  return true;
})()`;

const SCRAPE = `(() => {
  const bad = /login|signin|accounts\\/login|captcha|verify|passport/i;
  const ok = /tiktok\\.com\\/@[^/]+\\/video\\/\\d+|tiktok\\.com\\/video\\/\\d+|instagram\\.com\\/(reel|p)\\/[A-Za-z0-9_-]+|(?:xiaohongshu|rednote)\\.com\\/(explore|discovery\\/item|search_result)\\/[A-Za-z0-9]{16,}|douyin\\.com\\/video\\/\\d+|v\\.douyin\\.com\\/[A-Za-z0-9]+|item\\.taobao\\.com\\/item\\.htm\\?.*id=\\d+|detail\\.tmall\\.com\\/item\\.htm\\?.*id=\\d+|detail\\.1688\\.com\\/offer\\/\\d+\\.html|dj\\.1688\\.com\\/ci_bb\\?/;
  const byId = new Map();
  const put = (url, title, img, video) => {
    if (!url || bad.test(url)) return;
    let id = url;
    const note = String(url).match(/(?:xiaohongshu|rednote)\\.com\\/(?:explore|discovery\\/item|search_result)\\/([A-Za-z0-9]{16,})/);
    if (note) {
      id = note[1];
      let token = '';
      try { token = decodeURIComponent((String(url).match(/[?&]xsec_token=([^&]+)/) || [])[1] || ''); } catch (e) { token = ''; }
      url = 'https://www.xiaohongshu.com/explore/' + id + (token ? ('?xsec_token=' + encodeURIComponent(token) + '&xsec_source=pc_search') : '');
    }
    const prev = byId.get(id);
    const row = {
      url: note ? url : String(url).split('#')[0],
      title: String(title || '').replace(/\\s+/g, ' ').trim().slice(0, 90),
      img: img || '',
      video: !!video,
    };
    if (!prev) byId.set(id, row);
    else {
      if (!prev.title && row.title) prev.title = row.title;
      if (!prev.img && row.img) prev.img = row.img;
      if (row.video) prev.video = true;
      if (note && /xsec_token=/.test(row.url) && !/xsec_token=/.test(prev.url)) prev.url = row.url;
    }
  };
  for (const a of document.querySelectorAll('a[href]')) {
    let href = a.href || '';
    if (!ok.test(href)) continue;
    const card = a.closest('section, div');
    const img = a.querySelector('img') || card?.querySelector('img');
    const title = (a.getAttribute('title') || img?.alt || a.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
    const video = !!(card && (card.querySelector('video, [class*="play" i]') || /\\d{1,2}:\\d{2}/.test(card.innerText || '')));
    put(href, title, img?.src || '', video);
  }
  const walk = (o, d, seen) => {
    if (!o || d > 6 || seen.size > 5000 || byId.size > 40) return;
    if (typeof o !== 'object') return;
    if (seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length && i < 40; i++) walk(o[i], d + 1, seen);
      return;
    }
    const card = o.noteCard || o.note_card;
    const id = String(o.id || o.noteId || o.note_id || '');
    if (card && /^[0-9a-f]{16,32}$/i.test(id)) {
      const cover = card.cover || {};
      const list = cover.infoList || cover.info_list || [];
      const img = cover.urlDefault || cover.url_default || cover.urlPre || cover.url || (list[0] && (list[0].url || list[0].urlDefault)) || '';
      const token = o.xsecToken || o.xsec_token || card.xsecToken || '';
      const url = 'https://www.xiaohongshu.com/explore/' + id + (token ? ('?xsec_token=' + encodeURIComponent(token) + '&xsec_source=pc_search') : '');
      put(url, card.displayTitle || card.display_title || card.title || '', img, String(card.type || '') === 'video');
    }
    const keys = Object.keys(o);
    if (keys.length > 60 && !card) {
      for (const k of ['_rawValue', '_value', 'search', 'feeds', 'notes', 'items', 'note', 'user', 'data']) {
        if (o[k] && typeof o[k] === 'object') walk(o[k], d + 1, seen);
      }
      return;
    }
    for (const k of keys) {
      const v = o[k];
      if (v && typeof v === 'object') walk(v, d + 1, seen);
    }
  };
  try {
    if (window.__INITIAL_STATE__) walk(window.__INITIAL_STATE__, 0, new Set());
  } catch (e) {}
  let items = [...byId.values()];
  if (items.some((v) => v.video)) items = items.filter((v) => v.video);
  items = items.slice(0, 24);
  const text = (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 400);
  const gate = /登录后查看|请登录|슬라이더를 드래그|퍼즐을 맞추|Instagram으로 로그인|Log in|로그인하여|扫码登录|访问异常|当前访问存在异常/.test(text) && !items.length;
  return { items, gate, text };
})()`;

async function searchSocial(platform, pageUrl, label) {
  checkCancel();
  const tab = await chromeDriver.openTab(pageUrl);
  try {
    let last = { items: [], gate: false, text: '' };
    const needsScroll = ['xhs', 'douyin', 'taobao', 'ali1688'].includes(platform);
    const rounds = needsScroll ? 16 : 12;
    for (let i = 0; i < rounds; i++) {
      checkCancel();
      await sleep(1000);
      if ((platform === 'xhs' || platform === 'douyin') && (i === 1 || i === 2)) await tab.eval(CLICK_VIDEO).catch(() => false);
      if (needsScroll && (i === 3 || i === 7 || i === 11)) {
        await tab.eval('window.scrollBy(0, Math.max(800, window.innerHeight))').catch(() => {});
        await sleep(600);
      }
      if (i === 0) await waitIfBlocked(tab, platform);
      try {
        last = await tab.eval(SCRAPE);
      } catch (e) {
        if (/CANCELLED/.test(String(e.message))) throw e;
        console.error(`[socialSearch] SCRAPE 실패 (${i}/${rounds}):`, e.message?.slice(0, 120));
        if (i >= rounds - 2) break;
        continue;
      }
      const got = (last.items || []).length;
      if ((platform === 'ali1688' || platform === 'taobao') && got < 6) {
        try {
          const extra = await tab.eval(IMG_SCRAPE);
          if ((extra.items || []).length > got) last = extra;
        } catch (e) {
          if (/CANCELLED/.test(String(e.message))) throw e;
        }
      }
      if ((last.items || []).length >= 6 && (platform !== 'xhs' || i >= 4)) break;
      if (last.gate && i >= 5) break;
    }
    const look = LOOK[platform] || { hue: 20, emoji: '▶' };
    const items = (last.items || []).map((v) => {
      const url = canonicalShopUrl(v.url) || v.url;
      return {
        id: url,
        url,
        title: v.title || label,
        img: v.img || '',
        views: 0,
        dur: 0,
        channel: label,
        platform,
        emoji: look.emoji,
        hue: look.hue,
        video: !!v.video,
      };
    });
    return { items, needLogin: !items.length && last.gate };
  } finally {
    await tab.close();
  }
}

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

async function grabThumbs(urls) {
  const ses = session.fromPartition(PART);
  const out = [];
  for (const raw of urls) {
    checkCancel();
    let url = String(raw || '').trim();
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:\/\//.test(url)) { out.push(null); continue; }
    try {
      const referer = /ytimg|youtube/.test(url) ? 'https://www.youtube.com/' : refererFor(url);
      const res = await net.fetch(url, { session: ses, headers: { 'User-Agent': UA, Referer: referer } });
      if (!res.ok) { out.push(null); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = sniff(buf);
      if (!mime || buf.length < 400 || buf.length > 1500000) { out.push(null); continue; }
      out.push({ mime, data: buf.toString('base64') });
    } catch {
      out.push(null);
    }
  }
  return out;
}

async function cookieFile() {
  try {
    const file = await chromeCookies.writeCookieFile();
    if (file) return file;
  } catch (e) {
    console.error('[cookieFile] Chrome 쿠키 파일 생성 실패:', e.message);
  }
  return '';
}

const XHS_VIDEO_EXTRACT = `(() => {
  const seen = new Set();
  const take = (o, d) => {
    if (!o || d > 10 || seen.has(o) || typeof o !== 'object') return '';
    seen.add(o);
    if (typeof o.masterUrl === 'string' && /^https?:/.test(o.masterUrl)) return o.masterUrl;
    if (typeof o.master_url === 'string' && /^https?:/.test(o.master_url)) return o.master_url;
    if (typeof o.url === 'string' && /\\.(mp4|m3u8)(\\?|$)/i.test(o.url) && /^https?:/.test(o.url)) return o.url;
    if (Array.isArray(o.h264) && o.h264[0]) { const r = take(o.h264[0], d+1); if (r) return r; }
    if (Array.isArray(o.h265) && o.h265[0]) { const r = take(o.h265[0], d+1); if (r) return r; }
    for (const k of Object.keys(o)) { const r = take(o[k], d+1); if (r) return r; }
    return '';
  };
  const fromState = take(window.__INITIAL_STATE__ || {}, 0);
  const v = document.querySelector('video');
  return fromState || (v && (v.currentSrc || v.src)) || '';
})()`;

async function grabXhsVideo(noteUrl) {
  const tab = await chromeDriver.openTab(noteUrl);
  try {
    let href = '';
    const videoHits = [];
    tab._ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
        if (msg.method === 'Network.requestWillBeSent') {
          const u = msg.params?.request?.url || '';
          if (/sns-video|xhscdn[^\s]*\.(mp4|m3u8)/i.test(u)) videoHits.push(u);
        }
      } catch {}
    });
    for (let i = 0; i < 8 && !href; i++) {
      await sleep(700);
      href = videoHits.find((u) => /\.mp4(\?|$)/i.test(u)) || videoHits[0] || '';
      if (href) break;
      try { href = await tab.eval(XHS_VIDEO_EXTRACT); } catch { href = ''; }
    }
    if (!href) {
      const hint = await tab.eval(`({ href: location.href, text: (document.body?.innerText || '').slice(0,160) })`).catch(() => ({}));
      if (/\/login/i.test(String(hint.href || ''))) {
        const err = new Error('XHS_LOGIN — 크롬에서 로그인해 주세요');
        err.code = 'XHS_LOGIN';
        throw err;
      }
    }
    return href;
  } finally {
    await tab.close();
  }
}

async function grabDouyinVideo(pageUrl) {
  const tab = await chromeDriver.openTab(pageUrl);
  try {
    let href = '';
    const videoHits = [];
    tab._ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
        if (msg.method === 'Network.requestWillBeSent') {
          const u = msg.params?.request?.url || '';
          if (/douyinvod[^\s]*\.(mp4|m3u8)|v\d+-[a-z]+\.douyinvod/i.test(u)) videoHits.push(u);
        }
      } catch {}
    });
    for (let i = 0; i < 10 && !href; i++) {
      await sleep(800);
      href = videoHits.find((u) => /\.mp4(\?|$)/i.test(u)) || videoHits.find((u) => /douyinvod|\.m3u8/i.test(u)) || '';
      if (href) break;
      try {
        href = await tab.eval(`(() => {
          const v = document.querySelector('video');
          if (v && (v.currentSrc || v.src)) return v.currentSrc || v.src;
          const sources = document.querySelectorAll('video source');
          for (const s of sources) { if (s.src) return s.src; }
          try {
            const data = JSON.parse(decodeURIComponent(document.getElementById('RENDER_DATA')?.textContent || '{}'));
            const walk = (o, d) => {
              if (!o || d > 8 || typeof o !== 'object') return '';
              if (o.playApi || o.play_api) return o.playApi || o.play_api;
              if (typeof o.playAddr === 'string' && /^https?:/.test(o.playAddr)) return o.playAddr;
              if (o.play_addr?.url_list?.[0]) return o.play_addr.url_list[0];
              for (const k of Object.keys(o)) { const r = walk(o[k], d+1); if (r) return r; }
              return '';
            };
            return walk(data, 0);
          } catch(e) { return ''; }
        })()`);
      } catch { href = ''; }
    }
    return href;
  } finally {
    await tab.close();
  }
}

const PRODUCT_VIDEO_RE = /cloudvideocdn\.taobao|cloud\.video\.taobao|video\.alicdn|svideo\.alicdn|alivod|tbvideo|tmallvideo|cbu01\.alicdn[^\s]*\.(mp4|m3u8)|video\.cbu|\.mp4(\?|$)/i;

const PRODUCT_VIDEO_EXTRACT = `(() => {
  const ok = (u) => typeof u === 'string' && /^https?:/i.test(u) && /cloudvideocdn\\.taobao|cloud\\.video\\.taobao|video\\.alicdn|svideo\\.alicdn|alivod|tbvideo|tmallvideo|cbu01\\.alicdn[^\\s]*\\.(mp4|m3u8)|video\\.cbu|\\.mp4(\\?|$)|\\.m3u8(\\?|$)/i.test(u);
  const v = document.querySelector('video');
  if (v && ok(v.currentSrc || v.src)) return v.currentSrc || v.src;
  for (const s of document.querySelectorAll('video source')) { if (ok(s.src)) return s.src; }
  for (const el of document.querySelectorAll('[data-video-url],[data-src],[data-src-mp4]')) {
    const u = el.getAttribute('data-video-url') || el.getAttribute('data-src') || el.getAttribute('data-src-mp4') || '';
    if (ok(u)) return u;
  }
  const seen = new Set();
  const walk = (o, d) => {
    if (!o || d > 10 || seen.has(o) || typeof o !== 'object') return '';
    seen.add(o);
    for (const k of ['videoUrl', 'video_url', 'playUrl', 'play_url', 'url', 'src', 'location', 'videoUrlList']) {
      const val = o[k];
      if (ok(val)) return val;
      if (Array.isArray(val) && ok(val[0])) return val[0];
      if (val && typeof val === 'object' && ok(val.url || val.src)) return val.url || val.src;
    }
    const keys = Object.keys(o);
    for (let i = 0; i < keys.length && i < 80; i++) {
      const r = walk(o[keys[i]], d + 1);
      if (r) return r;
    }
    return '';
  };
  for (const key of ['__INITIAL_DATA__', 'g_config', 'Hub']) {
    try { const r = walk(window[key], 0); if (r) return r; } catch (e) {}
  }
  try {
    for (const s of document.querySelectorAll('script')) {
      const t = s.textContent || '';
      const m = t.match(/https?:\\\\/\\\\/[^"'\\\\s]+(?:cloudvideocdn\\.taobao|cloud\\.video\\.taobao|video\\.alicdn)[^"'\\\\s]*\\.mp4[^"'\\\\s]*/i)
        || t.match(/https?:\\\\/\\\\/[^"'\\\\s]+\\.mp4(?:\\?[^"'\\\\s]*)?/i);
      if (m) return m[0].replace(/\\\\u002F/g, '/').replace(/\\\\\//g, '/');
    }
  } catch (e) {}
  return '';
})()`;

function pickProductVideo(hits) {
  return hits.find((u) => /\.(mp4|m3u8)(\?|$)/i.test(u) && PRODUCT_VIDEO_RE.test(u))
    || hits.find((u) => PRODUCT_VIDEO_RE.test(u))
    || '';
}

async function grabProductVideo(pageUrl, platform) {
  const dest = canonicalShopUrl(pageUrl) || pageUrl;
  const tab = await chromeDriver.openTab('about:blank');
  try {
    const videoHits = [];
    tab.on((msg) => {
      if (msg.method !== 'Network.requestWillBeSent' && msg.method !== 'Network.responseReceived') return;
      const u = msg.params?.request?.url || msg.params?.response?.url || '';
      if (PRODUCT_VIDEO_RE.test(u)) videoHits.push(u);
    });
    if (platform === 'ali1688' && !/detail\.1688\.com\/offer\/\d+/.test(dest)) {
      console.log(`[grabProductVideo] 1688 상세 아님 skip ${dest.slice(0, 80)}`);
      return '';
    }
    console.log(`[grabProductVideo] ${platform || ''} ${dest}`);
    await tab.navigate(dest);
    if (await waitIfBlocked(tab, platform || 'shop')) throw new Error(ACCESS_ERR);
    await sleep(1200);
    await tab.eval(`(() => {
      const labels = [...document.querySelectorAll('li, span, div, a, button, img')];
      const tabHit = labels.find((el) => /^(视频|영상|Video)$/.test((el.innerText || '').trim()));
      if (tabHit) tabHit.click();
      const play = document.querySelector('[class*="play" i], [class*="video" i], .video-icon, .tb-booth, .tm-video, video');
      if (play && play !== tabHit) try { play.click(); } catch (e) {}
    })()`).catch(() => {});
    let href = '';
    for (let i = 0; i < 10 && !href; i++) {
      await sleep(700);
      href = pickProductVideo(videoHits);
      if (href) break;
      try { href = await tab.eval(PRODUCT_VIDEO_EXTRACT); } catch { href = ''; }
    }
    if (!href) {
      await tab.eval(`(() => {
        const thumbs = [...document.querySelectorAll('img, li, div')].filter((el) => /video|play/i.test(el.className || '') || el.getAttribute('aria-label') === '视频');
        for (const el of thumbs.slice(0, 4)) try { el.click(); } catch (e) {}
      })()`).catch(() => {});
      await sleep(1500);
      href = pickProductVideo(videoHits);
      if (!href) {
        try { href = await tab.eval(PRODUCT_VIDEO_EXTRACT); } catch { href = ''; }
      }
    }
    return href || '';
  } finally {
    await tab.close();
  }
}

async function grabSocialVideo(pageUrl, platform) {
  if (!platform) {
    if (/xiaohongshu|rednote/i.test(pageUrl)) platform = 'xhs';
    else if (/douyin/i.test(pageUrl)) platform = 'douyin';
    else if (/taobao|tmall/i.test(pageUrl)) platform = 'taobao';
    else if (/1688/i.test(pageUrl)) platform = 'ali1688';
    else if (/tiktok/i.test(pageUrl)) platform = 'tiktok';
  }
  switch (platform) {
    case 'xhs': return grabXhsVideo(pageUrl);
    case 'douyin': return grabDouyinVideo(pageUrl);
    case 'taobao':
    case 'ali1688': return grabProductVideo(pageUrl, platform);
    default: return '';
  }
}

const PLATFORM_REFERER = {
  xhs: 'https://www.xiaohongshu.com/',
  douyin: 'https://www.douyin.com/',
  tiktok: 'https://www.tiktok.com/',
  taobao: 'https://www.taobao.com/',
  ali1688: 'https://www.1688.com/',
};

function refererFor(fileUrl, platform) {
  if (platform && PLATFORM_REFERER[platform]) return PLATFORM_REFERER[platform];
  if (/xiaohongshu|xhscdn|rednote/i.test(fileUrl)) return PLATFORM_REFERER.xhs;
  if (/douyin|douyinvod/i.test(fileUrl)) return PLATFORM_REFERER.douyin;
  if (/tiktok/i.test(fileUrl)) return PLATFORM_REFERER.tiktok;
  if (/taobao|tmall/i.test(fileUrl)) return PLATFORM_REFERER.taobao;
  if (/1688|alicdn/i.test(fileUrl)) return PLATFORM_REFERER.ali1688;
  return PLATFORM_REFERER.xhs;
}

async function fetchSocialFile(fileUrl, dest, platform) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const headers = { 'User-Agent': UA, Referer: refererFor(fileUrl, platform) };
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const ses = session.fromPartition(PART);
      const res = await net.fetch(fileUrl, { session: ses, headers });
      if (!res.ok) throw new Error(`영상 받기 실패 (${res.status})`);
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      if (!fs.existsSync(dest) || fs.statSync(dest).size < 20000) throw new Error('받은 영상이 너무 작습니다.');
      return dest;
    } catch (e) {
      lastErr = e;
      try { fs.rmSync(dest, { force: true }); } catch {}
      if (i < 2) await sleep(1200);
    }
  }
  const { spawn } = require('child_process');
  await new Promise((ok, fail) => {
    const child = spawn('curl.exe', [
      '-L', '--fail', '--connect-timeout', '30', '--max-time', '180', '--retry', '2',
      '-A', UA, '-e', headers.Referer, '-o', dest, fileUrl,
    ], { windowsHide: true });
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? ok() : fail(lastErr || new Error(`curl ${code}`))));
  });
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 20000) throw lastErr || new Error('받은 영상이 너무 작습니다.');
  return dest;
}

const IMAGE_SEARCH_PAGES = {
  taobao: {
    url: 'https://s.taobao.com/search?tab=pic',
    inputSelector: 'input[type="file"]',
    waitMs: 4000,
  },
  ali1688: {
    url: 'https://air.1688.com/kapp/1688-search/pc-image-search/',
    inputSelector: '#img-search-upload',
    waitMs: 4000,
  },
};

const IMG_SCRAPE = `(() => {
  const bad = /login|signin|accounts\\/login|passport/i;
  const ok = /item\\.taobao\\.com\\/item\\.htm\\?.*id=\\d+|detail\\.tmall\\.com\\/item\\.htm\\?.*id=\\d+|click\\.tmall\\.com|click\\.taobao\\.com|detail\\.1688\\.com\\/offer\\/\\d+|offer\\.1688\\.com\\/offer\\/\\d+|m\\.1688\\.com\\/offer|click\\.1688\\.com\\/[^\\s]*offer/i;
  const byId = new Map();
  const put = (url, title, img, video) => {
    if (!url || bad.test(url)) return;
    let href = String(url).split('#')[0];
    const offer = href.match(/offer(?:id)?[=/_-](\\d{8,})/i) || href.match(/\\/offer\\/(\\d{8,})/i);
    if (offer && /1688|alibaba/i.test(href)) href = 'https://detail.1688.com/offer/' + offer[1] + '.html';
    const id = (href.match(/[?&]id=(\\d+)/) || href.match(/offer\\/(\\d+)/) || [0, href])[1];
    const row = { url: href, title: String(title || '').replace(/\\s+/g, ' ').trim().slice(0, 90), img: img || '', video: !!video };
    if (!byId.has(id)) byId.set(id, row);
    else {
      const prev = byId.get(id);
      if (!prev.title && row.title) prev.title = row.title;
      if (!prev.img && row.img) prev.img = row.img;
      if (row.video) prev.video = true;
      if (/detail\\.1688\\.com/.test(href)) prev.url = href;
    }
  };
  const offerPut = (id, title, img, video) => {
    if (!/^\\d{8,}$/.test(String(id || ''))) return;
    put('https://detail.1688.com/offer/' + id + '.html', title, img, video);
  };
  for (const a of document.querySelectorAll('a[href]')) {
    let href = a.href || '';
    if (!ok.test(href) && !/offer(?:id)?[=/_-]\\d{8,}/i.test(href) && !/\\/offer\\/\\d{8,}/i.test(href)) continue;
    const card = a.closest('div, li, section');
    const img = a.querySelector('img') || card?.querySelector('img');
    const title = (a.getAttribute('title') || img?.alt || a.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
    const video = !!(card && (card.querySelector('video, [class*="play" i], [class*="video" i]') || /\\d{1,2}:\\d{2}/.test(card.innerText || '')));
    put(href, title, img?.src || '', video);
  }
  for (const el of document.querySelectorAll('[data-offer-id], [data-offerid], [data-offer-id], [offer-id]')) {
    const id = el.getAttribute('data-offer-id') || el.getAttribute('data-offerid') || el.getAttribute('offer-id');
    const img = el.querySelector('img') || (el.closest('div, li') && el.closest('div, li').querySelector('img'));
    offerPut(id, el.innerText || img?.alt || '', img?.src || '', !!el.querySelector('video, [class*="play" i]'));
  }
  if (/1688/.test(location.hostname || '')) {
    const html = document.documentElement ? document.documentElement.innerHTML : '';
    const re = /offer(?:Id)?["'\\s:=]{0,6}(\\d{10,})/gi;
    let m;
    while ((m = re.exec(html)) && byId.size < 30) offerPut(m[1], '', '', false);
  }
  let items = [...byId.values()];
  items = items.slice(0, 30);
  const text = (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 800);
  const gate = /登录后查看|请登录|验证|슬라이더|퍼즐을 맞추|访问异常|当前访问存在异常/.test(text) && !items.length;
  return { items, gate, text };
})()`;

async function downloadImage(imageUrl) {
  const tmpDir = path.join(app.getPath('temp'), 'shoppinglens-img');
  fs.mkdirSync(tmpDir, { recursive: true });
  if (imageUrl && !/^https?:\/\//i.test(imageUrl) && fs.existsSync(imageUrl)) {
    const ext = path.extname(imageUrl) || '.jpg';
    const tmpFile = path.join(tmpDir, `search_${Date.now()}${ext}`);
    fs.copyFileSync(imageUrl, tmpFile);
    return tmpFile;
  }
  const ses = session.fromPartition(PART);
  const res = await net.fetch(imageUrl, {
    session: ses,
    headers: { 'User-Agent': UA, Referer: 'https://www.coupang.com/' },
  });
  if (!res.ok) throw new Error(`이미지 다운로드 실패 (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error('이미지가 너무 작습니다');
  const ext = /\.png/i.test(imageUrl) ? '.png' : /\.webp/i.test(imageUrl) ? '.webp' : '.jpg';
  const tmpFile = path.join(tmpDir, `search_${Date.now()}${ext}`);
  fs.writeFileSync(tmpFile, buf);
  return tmpFile;
}

async function findFileInputNode(tab, preferredSelector) {
  await tab.send('DOM.enable');
  const trySel = async (selector) => {
    const doc = await tab.send('DOM.getDocument', { depth: -1 });
    const rootId = doc.result?.root?.nodeId;
    if (!rootId || !selector) return 0;
    try {
      const qr = await tab.send('DOM.querySelector', { nodeId: rootId, selector });
      return qr.result?.nodeId || 0;
    } catch {
      return 0;
    }
  };
  let nodeId = await trySel(preferredSelector);
  if (nodeId) return nodeId;
  nodeId = await trySel('input[type="file"]');
  if (nodeId) return nodeId;
  await tab.eval(`(() => {
    const clickables = [
      ...document.querySelectorAll('[class*="image-search" i], [class*="img-search" i], [class*="pic-search" i], [class*="camera" i], [class*="SearchPic" i], #img-search-upload, [aria-label*="图"], [title*="图搜"], [title*="拍照"]'),
    ];
    for (const el of clickables.slice(0, 8)) {
      try { el.click(); } catch {}
    }
    const labeled = [...document.querySelectorAll('div, span, button, i, a')].find((el) => /图搜|拍照搜|搜图|图片搜索|以图搜|上传图片/.test((el.innerText || el.title || el.getAttribute('aria-label') || '').slice(0, 20)));
    if (labeled) try { labeled.click(); } catch {}
    for (const fi of document.querySelectorAll('input[type="file"]')) {
      fi.style.display = 'block';
      fi.style.opacity = '1';
      fi.style.position = 'fixed';
      fi.style.left = '8px';
      fi.style.top = '8px';
      fi.style.zIndex = '2147483647';
    }
  })()`).catch(() => {});
  await sleep(800);
  nodeId = await trySel('input[type="file"]');
  if (nodeId) return nodeId;
  return trySel(preferredSelector);
}

async function searchByImage(platform, imageUrl, label) {
  checkCancel();
  const cfg = IMAGE_SEARCH_PAGES[platform];
  if (!cfg) throw new Error(`이미지 검색 미지원 플랫폼: ${platform}`);

  const imgPath = await downloadImage(imageUrl);
  const tab = await chromeDriver.openTab(cfg.url);
  try {
    await sleep(3000);
    if (await waitIfBlocked(tab, platform)) throw new Error(ACCESS_ERR);
    if (platform === 'ali1688') {
      await tab.eval(`(() => {
        const zone = document.querySelector('#img-search-upload')
          || [...document.querySelectorAll('div, span, button')].find((el) => /이미지 업로드|上传图片|点击上传|새로 선택/.test((el.innerText || '').slice(0, 30)));
        if (zone) zone.click();
      })()`).catch(() => {});
      await sleep(800);
    }
    const inputNodeId = await findFileInputNode(tab, cfg.inputSelector);
    if (!inputNodeId) throw new Error(`${platform} 이미지 업로드 입력란을 찾지 못했습니다`);

    await tab.send('DOM.setFileInputFiles', {
      nodeId: inputNodeId,
      files: [path.resolve(imgPath)],
    });
    const fileCount = await tab.eval(`document.querySelector('input[type="file"]')?.files?.length || 0`).catch(() => 0);
    console.log(`[searchByImage] ${platform} 이미지 업로드 완료 files=${fileCount}`);
    await tab.eval(`(() => {
      const fi = document.querySelector('input[type="file"]');
      if (fi) fi.dispatchEvent(new Event('change', { bubbles: true }));
    })()`).catch(() => {});
    await sleep(1200);
    let clicked = '';
    if (platform === 'taobao') {
      clicked = await tab.eval(`(() => {
        const labels = ['搜索', '搜同款', '搜图'];
        const nodes = [...document.querySelectorAll('button, span, a, div')];
        const hits = nodes.filter((el) => labels.includes((el.innerText || '').trim()) && el.offsetParent !== null);
        const inPopup = hits.find((el) => {
          const box = el.closest('div');
          return box && box.querySelector('img') && /按图片搜索|图片搜索/.test(box.innerText || '');
        });
        const hit = inPopup || hits.filter((el) => (el.innerText || '').trim() === '搜索').pop();
        if (!hit) return '';
        hit.click();
        return (hit.innerText || '').trim();
      })()`).catch(() => '');
    }
    console.log(`[searchByImage] ${platform} 검색 클릭=${clicked || 'skip'}`);
    const startHref = await tab.eval('location.href').catch(() => '');
    await sleep(cfg.waitMs);
    for (let w = 0; w < 8; w++) {
      const now = await tab.eval('location.href').catch(() => startHref);
      if (now && now !== startHref) break;
      await sleep(800);
    }
    if (await waitIfBlocked(tab, platform)) throw new Error(ACCESS_ERR);

    // Scroll and scrape results
    let last = { items: [], gate: false, text: '', href: '', title: '' };
    for (let i = 0; i < 12; i++) {
      checkCancel();
      await sleep(1200);
      if (i === 3 || i === 6 || i === 9) {
        await tab.eval('window.scrollBy(0, Math.max(800, window.innerHeight))').catch(() => {});
        await sleep(600);
      }
      try {
        last = await tab.eval(IMG_SCRAPE);
      } catch (e) {
        if (/CANCELLED/.test(String(e.message))) throw e;
        console.error(`[searchByImage] SCRAPE 실패 (${i}/12):`, e.message?.slice(0, 120));
        continue;
      }
      const got = (last.items || []).length;
      let href = '';
      try { href = await tab.eval('location.href'); } catch {}
      last.href = href;
      console.log(`[searchByImage] ${platform} round ${i}: ${got}개 href=${String(href).slice(0, 80)} gate=${!!last.gate} text=${String(last.text || '').slice(0, 80)}`);
      if (ACCESS_BLOCK.test(String(last.text || ''))) {
        if (await waitIfBlocked(tab, platform)) throw new Error(ACCESS_ERR);
      }
      if (got >= 6) break;
      if (last.gate && i >= 5) break;
    }

    const look = LOOK[platform] || { hue: 20, emoji: '▶' };
    const items = (last.items || []).map((v) => {
      const url = canonicalShopUrl(v.url) || v.url;
      return {
        id: url,
        url,
        title: v.title || label,
        img: v.img || '',
        views: 0,
        dur: 0,
        channel: label,
        platform,
        emoji: look.emoji,
        hue: look.hue,
        video: !!v.video,
      };
    }).sort((a, b) => Number(!!b.video) - Number(!!a.video));
    if (!items.length) {
      try {
        const shot = await tab.send('Page.captureScreenshot', { format: 'png' });
        const b64 = shot.result?.data;
        if (b64) {
          const shotFile = path.join(app.getPath('temp'), 'shoppinglens-img', `${platform}-search.png`);
          fs.writeFileSync(shotFile, Buffer.from(b64, 'base64'));
          console.log(`[searchByImage] ${platform} 스크린샷 ${shotFile}`);
        }
      } catch (e) {
        console.log(`[searchByImage] 스크린샷 실패 ${e.message}`);
      }
    }
    return { items, needLogin: !items.length && last.gate, href: last.href || '', text: last.text || '' };
  } finally {
    await tab.close();
    try { fs.unlinkSync(imgPath); } catch {}
  }
}

module.exports = { searchSocial, searchByImage, grabThumbs, cookieFile, grabXhsVideo, grabSocialVideo, fetchSocialFile, refererFor };
