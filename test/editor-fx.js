const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));

app.whenReady().then(async () => {
  const media = require('../services/media');
  const src = path.join(app.getPath('documents'), 'ShoppingLens', '효과테스트', 'output', 'fx_zoom_20261026080102.mp4');
  const dir = path.join(app.getPath('temp'), 'sl-editor-check');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const edit = {
    font: 'Malgun Gothic', size: 72, border: true, shadow: true, filter: 'none', effect: 'none',
    overlays: [
      { kind: 'text', text: '문구 입력', x: 50, y: 28, size: 84, bold: true, outline: true, shadow: true, opacity: 100, color: '#ffe14a' },
      { kind: 'shape', shape: 'line', x: 50, y: 40, w: 40, color: '#ffffff', opacity: 100 },
    ],
    topBox: { on: true, color: '#000000', height: 18, opacity: 80, zoom: 50 },
    bottomBox: { on: true, color: '#111111', height: 16, opacity: 70, zoom: 50 },
  };
  try {
    const out = await media.render(dir, {
      scenes: [{ file: src, start: 0.4, dur: 2, hasAudio: false }],
      subs: [{ start: 0.2, end: 1.6, text: '더블클릭 글씨' }],
      edit, header: { show: true, top: '리뷰왕', title: '이게 대체 뭐야?', color: '#f5c64a', frame: 'bar' },
      voiceOn: false, subOn: true, keepAudio: false,
    }, () => {});
    const meta = await media.probe(out);
    const frame = path.join(dir, 'raw.jpg');
    await media.frame(out, 0.8, frame, 1080);
    const still = path.join(dir, 'still.jpg');
    await media.composeStill(frame, still, { edit, header: { show: false }, flip: true });
    const intro = path.join(dir, 'intro.mp4');
    await media.introClip(frame, '예상 못한 한 장면', intro);
    const sfx = path.join(dir, 'sfx.wav');
    await media.synthSfx('whoosh click', sfx, 0.4);
    const lead = path.join(dir, 'lead.mp4');
    await media.prependStill(out, still, 5, lead);
    const leadMeta = await media.probe(lead);
    const introMeta = await media.probe(intro);
    console.log('OK', JSON.stringify({
      render: [meta.width, meta.height, +meta.dur.toFixed(2)],
      still: fs.statSync(still).size,
      intro: +introMeta.dur.toFixed(2),
      sfx: fs.statSync(sfx).size,
      lead: +leadMeta.dur.toFixed(2),
    }));
  } catch (e) {
    console.log('FAILED', e.stack || e.message);
  }
  app.quit();
});
