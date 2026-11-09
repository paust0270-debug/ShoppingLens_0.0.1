const { execFileSync } = require('child_process');
const y = process.env.APPDATA + '\\ShoppingLens\\bin\\yt-dlp.exe';
const targets = process.argv.slice(2);
for (const t of targets) {
  const out = execFileSync(y, ['--no-warnings', '--flat-playlist', '-J', '--playlist-end', '20', t], { env: { ...process.env, PYTHONUTF8: '1' }, maxBuffer: 1e8 }).toString('utf8');
  const j = JSON.parse(out);
  console.log('==', t, 'entries', (j.entries || []).length);
  (j.entries || []).slice(0, 8).forEach((e) => console.log(' ', e.id, e.ie_key, e.duration, e.view_count, (e.title || '').slice(0, 40), e.url));
}
