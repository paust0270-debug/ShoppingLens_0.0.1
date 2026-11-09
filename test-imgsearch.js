const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const SAMPLE = process.argv[2] || '';

app.whenReady().then(async () => {
  const social = require('./services/socialSearch');
  const coupang = require('./services/coupang');
  const out = [];
  const log = (...a) => {
    const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    out.push(line);
    console.log(line);
  };
  try {
    let img = SAMPLE;
    if (!img || /coupang\.com|coupa\.ng/i.test(img)) {
      const url = /coupang\.com|coupa\.ng/i.test(img) ? img : '';
      if (url) {
        log('쿠팡 상품 추출', url);
        const info = await coupang.scrapePage(url);
        log('상품', info.title || '', info.img || '');
        img = info.img;
      }
    }
    if (!img) throw new Error('이미지 URL 또는 쿠팡 상품 URL을 인자로 넣으세요.');
    for (const plat of ['taobao', 'ali1688']) {
      log('---', plat, '이미지 검색');
      try {
        const r = await social.searchByImage(plat, img, plat);
        log(plat, '결과', (r.items || []).length, r.needLogin ? '로그인필요' : '', r.href || '', String(r.text || '').slice(0, 120));
        for (const it of (r.items || []).slice(0, 5)) {
          log(' ', it.video ? '영상' : '상품', (it.title || '').slice(0, 40), it.url);
        }
      } catch (e) {
        log(plat, '실패', e.message);
      }
    }
  } catch (e) {
    log('오류', e.message);
  }
  const report = path.join(__dirname, 'test-imgsearch.log');
  fs.writeFileSync(report, out.join('\n'), 'utf8');
  log('저장', report);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
