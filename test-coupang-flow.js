const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const RAW = process.argv[2] || 'https://www.coupang.com/vp/products/6542739738?itemId=20461740729&vendorItemId=81816101818&q=%EC%8B%B1%ED%81%AC%EB%8C%80%20%EC%B9%B8%EB%A7%89%EC%9D%B4';

app.whenReady().then(async () => {
  const coupang = require('./services/coupang');
  const social = require('./services/socialSearch');
  const ai = require('./services/ai');
  const lines = [];
  const log = (...a) => {
    const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    lines.push(s);
    console.log(s);
  };
  try {
    const href = /https?:\/\//i.test(RAW) ? RAW : `https://${RAW.replace(/^\/+/, '')}`;
    const q = (() => { try { return decodeURIComponent(new URL(href).searchParams.get('q') || ''); } catch { return ''; } })();
    log('URL 검색어', q || '(없음)');
    log('쿠팡 페이지 추출');
    const info = await coupang.scrapePage(href);
    log('상품명', info.title || '');
    log('이미지', (info.imgs || []).length, info.img || '');
    let zh = q || info.title || '';
    if (ai.hasAI()) {
      try { zh = String(await ai.translateZh(q || info.title) || zh); } catch (e) { log('번역 실패', e.message); }
    } else log('번역 건너뜀 (AI 키 없음)');
    log('중국어', zh);
    const img = (info.imgs && info.imgs[0]) || info.img;
    if (img) {
      log('타오바오 이미지 검색');
      try {
        const r = await social.searchByImage('taobao', img, '타오바오');
        log('타오바오 상품', (r.items || []).length);
        for (const it of (r.items || []).slice(0, 3)) log(' ', (it.title || '').slice(0, 40), String(it.url || '').slice(0, 90));
        for (const it of (r.items || []).slice(0, 4)) {
          log('영상 확인', (it.title || '').slice(0, 24));
          const media = await social.grabSocialVideo(it.url, 'taobao');
          log(' ', media ? media.slice(0, 120) : '(없음)');
          if (media) break;
        }
      } catch (e) {
        log('타오바오 실패', e.message);
      }
    }
  } catch (e) {
    log('오류', e.message);
  }
  const report = path.join(__dirname, 'test-coupang-flow.log');
  fs.writeFileSync(report, lines.join('\n'), 'utf8');
  log('저장', report);
  app.quit();
});
