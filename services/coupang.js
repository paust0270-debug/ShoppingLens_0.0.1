const crypto = require('crypto');
const { BrowserWindow } = require('electron');
const settings = require('./settings');
const { checkCancel } = require('./run');

const HOST = 'https://api-gateway.coupang.com';

function auth(method, pathWithQuery, access, secret) {
  const [p, query = ''] = pathWithQuery.split('?');
  const dt = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2);
  const sig = crypto.createHmac('sha256', secret).update(dt + method + p + query).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${access}, signed-date=${dt}, signature=${sig}`;
}

function keys() {
  const s = settings.get();
  if (!s.coupangAccess || !s.coupangSecret) throw new Error('NO_COUPANG_KEY');
  return [s.coupangAccess, s.coupangSecret];
}

async function call(method, pathWithQuery, body) {
  const [a, sec] = keys();
  const res = await fetch(HOST + pathWithQuery, {
    method,
    headers: { Authorization: auth(method, pathWithQuery, a, sec), 'Content-Type': 'application/json;charset=UTF-8' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.rCode && data.rCode !== '0')) throw new Error(`쿠팡 API 오류: ${data.rMessage || data.message || res.status}`);
  return data.data;
}

async function search(keyword, limit = 10) {
  const data = await call('GET', `/v2/providers/affiliate_open_api/apis/openapi/products/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}`);
  return (data?.productData || []).map((p) => ({
    title: p.productName,
    price: p.productPrice,
    img: p.productImage,
    url: p.productUrl,
    rocket: p.isRocket,
    productId: String(p.productId || ''),
  }));
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const PART = 'persist:shoppinglens-coupang';
let win;

function pageWin() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    show: false,
    title: '쿠팡 검색',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { partition: PART, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setUserAgent(UA);
  win.on('closed', () => { win = null; });
  return win;
}

function sleep(ms) {
  return new Promise((resolve, reject) => {
    const step = setInterval(() => {
      try { checkCancel(); } catch (e) { clearInterval(step); clearTimeout(done); reject(e); }
    }, 250);
    const done = setTimeout(() => { clearInterval(step); resolve(); }, ms);
  });
}

const PAGE_SCRAPE = `(() => {
  const items = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/vp/products/"]')) {
    const id = ((a.href || '').match(/\\/vp\\/products\\/(\\d+)/) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const card = a.closest('li') || a;
    const img = card.querySelector('img');
    const text = (card.innerText || '').replace(/\\s+/g, ' ').trim();
    const alt = ((img && img.alt) || '').trim();
    const sale = text.match(/(\\d{1,2})%\\s*([\\d,]+)원/);
    const first = text.match(/([\\d,]+)원/);
    const price = sale ? Number(sale[2].replace(/,/g, '')) : (first ? Number(first[1].replace(/,/g, '')) : 0);
    items.push({
      title: alt || text.slice(0, 80),
      price,
      img: (img && (img.currentSrc || img.src)) || '',
      url: 'https://www.coupang.com/vp/products/' + id,
      rocket: /로켓/.test(text),
    });
    if (items.length >= 12) break;
  }
  const body = ((document.body && document.body.innerText) || '').slice(0, 300);
  return { items, blocked: !items.length && /자동 입력 방지|로봇이 아닙니다|Access Denied|확인을 진행/.test(body) };
})()`;

async function scrapeSearch(evalPage, limit) {
  let last = { items: [], blocked: false };
  for (let i = 0; i < 10; i++) {
    checkCancel();
    await sleep(1000);
    try {
      last = await evalPage();
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
      break;
    }
    if ((last.items || []).length >= 4) break;
  }
  const items = (last.items || []).slice(0, limit);
  if (!items.length) {
    throw Object.assign(new Error(last.blocked
      ? '쿠팡 확인 화면이 떴습니다. 열린 시크릿 창에서 확인을 마친 뒤 다시 검색하세요.'
      : '쿠팡 검색 결과를 찾지 못했습니다.'), { blocked: !!last.blocked });
  }
  return items;
}

async function searchPage(keyword, limit = 10) {
  const q = String(keyword || '').trim();
  if (!q) throw new Error('검색어가 없습니다.');
  checkCancel();
  const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(q)}&channel=user`;
  try {
    const chromeDriver = require('./chromeDriver');
    const tab = await chromeDriver.openIncognitoTab(url);
    let keep = false;
    try {
      return await scrapeSearch(() => tab.eval(PAGE_SCRAPE), limit);
    } catch (e) {
      keep = !!e.blocked;
      throw e;
    } finally {
      if (!keep) await tab.close();
    }
  } catch (e) {
    if (/CANCELLED/.test(String(e.message))) throw e;
    if (e.blocked || /시크릿 창에서 확인/.test(e.message || '')) throw e;
  }

  const w = pageWin();
  w.setTitle('쿠팡 검색');
  try {
    await w.loadURL(url);
  } catch (e) {
    if (!/ERR_ABORTED/.test(e.message)) throw e;
  }
  const items = await scrapeSearch(async () => {
    if (w.isDestroyed()) return { items: [], blocked: false };
    return w.webContents.executeJavaScript(PAGE_SCRAPE);
  }, limit).catch((e) => {
    if (!e.blocked && !w.isDestroyed()) w.close();
    throw e;
  });
  if (!w.isDestroyed()) w.close();
  return items;
}

function parseCoupangUrls(text) {
  const found = String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return found.filter((u) => /coupang\.com|coupa\.ng/i.test(u));
}

function normalizeCoupangUrl(raw) {
  let href = String(raw || '').trim();
  const embedded = href.match(/https?:\/\/[^\s"'<>]+/i);
  if (embedded) href = embedded[0];
  try { href = decodeURIComponent(href); } catch { /* keep */ }
  let u;
  try { u = new URL(href); } catch {
    throw new Error('쿠팡 링크가 아닙니다.');
  }
  const host = u.hostname.replace(/^www\./, '');
  if (!/coupang\.com$|coupa\.ng$/.test(host)) throw new Error('쿠팡 링크가 아닙니다.');
  if (/^(link\.)?coupang\.com$/.test(host) && !/\/vp\/products\//.test(u.pathname)) {
    return href.split('#')[0];
  }
  const pid = (u.pathname.match(/\/vp\/products\/(\d+)/) || [])[1]
    || u.searchParams.get('pageValue')
    || u.searchParams.get('ctag');
  if (!pid) throw new Error('상품 번호를 찾지 못했습니다.');
  const out = new URL(`https://www.coupang.com/vp/products/${pid}`);
  const itemId = u.searchParams.get('itemId');
  const vendorItemId = u.searchParams.get('vendorItemId');
  if (itemId) out.searchParams.set('itemId', itemId);
  if (vendorItemId) out.searchParams.set('vendorItemId', vendorItemId);
  return out.toString();
}

function productIdOf(url) {
  return (String(url || '').match(/\/vp\/products\/(\d+)/) || [])[1] || '';
}

async function deeplink(urls) {
  const cleaned = urls.map(normalizeCoupangUrl);
  const data = await call('POST', '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink', { coupangUrls: cleaned });
  return (data || []).map((d, i) => {
    const original = d.originalUrl || cleaned[i];
    return {
      original,
      url: d.shortenUrl || d.landingUrl,
      short: d.shortenUrl || '',
      landing: d.landingUrl || '',
      productId: productIdOf(original) || productIdOf(cleaned[i]),
      partner: true,
    };
  });
}

async function makeLinks(text) {
  const raws = parseCoupangUrls(text);
  if (!raws.length) throw new Error('쿠팡 상품 링크를 붙여넣으세요.');
  const cleaned = [...new Set(raws.map(normalizeCoupangUrl))];
  if (!hasKeys()) {
    return cleaned.map((url) => ({
      original: url,
      url,
      short: '',
      landing: url,
      productId: productIdOf(url),
      partner: false,
    }));
  }
  return deeplink(cleaned);
}

const hasKeys = () => {
  const s = settings.get();
  return !!(s.coupangAccess && s.coupangSecret);
};

const PRODUCT_SCRAPE = `(() => {
  const title = (document.querySelector('.prod-buy-header__title') || document.querySelector('h1.prod-buy-header__title') || document.querySelector('h2.prod-buy-header__title') || document.querySelector('meta[property="og:title"]'))?.textContent?.trim() || document.querySelector('meta[property="og:title"]')?.content?.trim() || '';
  const imgs = [];
  const push = (u) => {
    if (!u || /blank|placeholder|data:image\\/(gif|svg)|1x1/i.test(u)) return;
    const abs = u.startsWith('//') ? 'https:' + u : u;
    if (!imgs.includes(abs)) imgs.push(abs);
  };
  for (const el of document.querySelectorAll('.prod-image img, .prod-image__detail img, .prod-image__item img, .prod-image__items img, [class*="prod-image"] img')) {
    push(el.currentSrc || el.src || el.getAttribute('data-src') || '');
  }
  push(document.querySelector('meta[property="og:image"]')?.content || '');
  const img = imgs[0] || '';
  const priceEl = document.querySelector('.total-price strong') || document.querySelector('.prod-sale-price .total-price') || document.querySelector('.prod-price__amount');
  const price = priceEl ? Number((priceEl.textContent || '').replace(/[^0-9]/g, '')) : 0;
  const rocket = /로켓/.test((document.body && document.body.innerText || '').slice(0, 3000));
  const body = ((document.body && document.body.innerText) || '').slice(0, 300);
  const blocked = !title && /자동 입력 방지|로봇이 아닙니다|Access Denied|확인을 진행/.test(body);
  return { title, img, imgs, price, rocket, blocked };
})()`;

function queryOf(raw) {
  try {
    const href = /https?:\/\//i.test(raw) ? raw : `https://${String(raw).replace(/^\/+/, '')}`;
    return (new URL(href).searchParams.get('q') || '').trim();
  } catch {
    return '';
  }
}

function matchPid(items, pid) {
  return (items || []).find((it) => String(it.productId || '') === String(pid) || productIdOf(it.url) === String(pid));
}

async function scrapePage(rawUrl) {
  const url = normalizeCoupangUrl(rawUrl);
  const pid = productIdOf(url);
  if (!pid) throw new Error('상품 번호를 찾지 못했습니다.');
  const q = queryOf(rawUrl);
  checkCancel();

  let partnerUrl = '';
  if (hasKeys()) {
    try {
      const link = (await deeplink([url]))[0];
      if (link?.url) partnerUrl = link.url;
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
    }
  }

  const pack = (row) => ({
    title: row.title,
    img: row.img,
    imgs: row.imgs?.length ? row.imgs : (row.img ? [row.img] : []),
    price: row.price,
    rocket: row.rocket,
    url: partnerUrl || row.url || url,
    productId: pid,
    partner: !!partnerUrl,
    query: q,
  });

  let found = null;
  if (hasKeys() && q) {
    const items = await search(q, 10).catch(() => []);
    found = matchPid(items, pid) || items.find((it) => q.split(/\s+/).filter((w) => w.length >= 2).every((w) => (it.title || '').includes(w))) || items[0] || null;
  }

  try {
    const chromeDriver = require('./chromeDriver');
    const tab = await chromeDriver.openIncognitoTab(url);
    let keep = false;
    try {
      let last = { title: '', img: '', imgs: [], price: 0, rocket: false, blocked: false };
      for (let i = 0; i < 8; i++) {
        checkCancel();
        await sleep(1000);
        last = await tab.eval(PRODUCT_SCRAPE);
        if (last.title || last.blocked) break;
      }
      if (last.title) {
        const imgs = [...new Set([...(last.imgs || []), found?.img, last.img].filter(Boolean))];
        return pack({ ...last, imgs, img: imgs[0] || last.img, url });
      }
      if (last.blocked) {
        keep = true;
        throw Object.assign(new Error('쿠팡 확인 화면이 떴습니다. 열린 시크릿 창에서 확인을 마친 뒤 다시 시도하세요.'), { blocked: true });
      }
    } catch (e) {
      if (e.blocked) keep = true;
      throw e;
    } finally {
      if (!keep) await tab.close();
    }
  } catch (e) {
    if (/CANCELLED/.test(String(e.message))) throw e;
    if (e.blocked) throw e;
  }

  const w = pageWin();
  w.setTitle('쿠팡 상품 정보');
  try {
    await w.loadURL('https://www.coupang.com/');
  } catch (e) {
    if (!/ERR_ABORTED/.test(e.message)) throw e;
  }
  await sleep(1500);
  checkCancel();
  try {
    await w.loadURL(url);
  } catch (e) {
    if (!/ERR_ABORTED/.test(e.message)) throw e;
  }
  let last = { title: '', img: '', imgs: [], price: 0, rocket: false, blocked: false };
  for (let i = 0; i < 8; i++) {
    checkCancel();
    await sleep(1000);
    if (w.isDestroyed()) break;
    try {
      last = await w.webContents.executeJavaScript(PRODUCT_SCRAPE);
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
      break;
    }
    if (last.title || last.blocked) break;
  }
  if (!w.isDestroyed()) w.close();
  if (last.title) {
    const imgs = [...new Set([...(last.imgs || []), found?.img, last.img].filter(Boolean))];
    return pack({ ...last, imgs, img: imgs[0] || last.img, url });
  }
  if (found) return pack(found);

  throw new Error(last.blocked
    ? '쿠팡 확인 화면이 떴습니다. 열린 창에서 확인을 마친 뒤 다시 시도하세요.'
    : '쿠팡 상품 정보를 가져오지 못했습니다.');
}

module.exports = { search, searchPage, deeplink, makeLinks, normalizeCoupangUrl, scrapePage, hasKeys };
