const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));

app.whenReady().then(async () => {
  const media = require('../services/media');
  const src = fs.readdirSync(path.join(app.getPath('documents'), 'ShoppingLens', '휴대용선풍기', 'videos')).find((f) => f.endsWith('.mp4'));
  const file = path.join(app.getPath('documents'), 'ShoppingLens', '휴대용선풍기', 'videos', src);
  const dir = path.join(app.getPath('documents'), 'ShoppingLens', '효과테스트');
  fs.rmSync(dir, { recursive: true, force: true });
  const scene = (effect) => ({ file, start: 8, dur: 2, hasAudio: true });
  try {
    for (const [name, effect, frame] of [['zoom', 'zoom', 'bar'], ['phone', 'pan', 'phone'], ['auto', 'auto', 'phone']]) {
      const header = frame === 'phone'
        ? { show: true, top: '여름필수템', title: '가방에 쏙', color: '#1d1b18', frame: 'phone', bg: '#ffffff', bar: '#9eb6ff' }
        : { show: true, top: '리뷰왕', title: '줌 테스트', color: '#f5c64a', frame: 'bar', bg: '#111', bar: '#f5c64a' };
      const out = await media.render(dir, {
        scenes: [scene(), { ...scene(), start: 14 }],
        subs: [{ start: 0.2, end: 1.8, text: '효과 확인' }],
        edit: { font: 'Malgun Gothic', size: 80, border: true, filter: 'none', effect, transition: true },
        header, voiceOn: false, subOn: true, keepAudio: false,
      }, (d) => d.text && console.log(name, d.text));
      const moved = out.replace(/final_/, `fx_${name}_`);
      fs.renameSync(out, moved);
      const meta = await media.probe(moved);
      await media.frame(moved, 1.2, path.join(__dirname, 'shots', `fx-${name}.jpg`), 360);
      console.log('OK', name, meta.width, meta.height, meta.dur.toFixed(1), (fs.statSync(moved).size / 1048576).toFixed(1) + 'MB');
    }
  } catch (e) {
    console.log('FAILED', e.stack || e.message);
  }
  app.quit();
});
