const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { run } = require('./run');

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

const dir = () => path.join(app.getPath('userData'), 'bin');

function paths() {
  return {
    ytdlp: path.join(dir(), 'yt-dlp.exe'),
    ffmpeg: path.join(dir(), 'ffmpeg.exe'),
    ffprobe: path.join(dir(), 'ffprobe.exe'),
  };
}

function status() {
  const p = paths();
  return { ytdlp: fs.existsSync(p.ytdlp), ffmpeg: fs.existsSync(p.ffmpeg) && fs.existsSync(p.ffprobe), dir: dir() };
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`다운로드 실패 (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    done += chunk.length;
    if (total && onProgress) onProgress(done / total);
  });
  const tmp = dest + '.part';
  await pipeline(body, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

function findFile(root, name) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name) return full;
  }
  return null;
}

const q = (s) => s.replace(/'/g, "''");

async function install(progress, force = false) {
  fs.mkdirSync(dir(), { recursive: true });
  const p = paths();
  if (force || !fs.existsSync(p.ytdlp)) {
    await download(YTDLP_URL, p.ytdlp, (r) => progress({ text: `yt-dlp 내려받는 중 ${Math.round(r * 100)}%`, progress: r * 0.2 }));
  }
  if (force || !fs.existsSync(p.ffmpeg) || !fs.existsSync(p.ffprobe)) {
    const zip = path.join(os.tmpdir(), `sl-ffmpeg-${Date.now()}.zip`);
    const out = path.join(os.tmpdir(), `sl-ffmpeg-${Date.now()}`);
    await download(FFMPEG_URL, zip, (r) => progress({ text: `FFmpeg 내려받는 중 ${Math.round(r * 100)}%`, progress: 0.2 + r * 0.7 }));
    progress({ text: 'FFmpeg 압축 푸는 중', progress: 0.92 });
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(out)}' -Force`]);
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
      const found = findFile(out, name);
      if (!found) throw new Error(`${name}을 찾지 못했습니다.`);
      fs.copyFileSync(found, path.join(dir(), name));
    }
    fs.rmSync(zip, { force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
  return status();
}

function ensureReady() {
  const s = status();
  if (!s.ytdlp || !s.ffmpeg) throw new Error('필수 도구(yt-dlp, FFmpeg)가 아직 설치되지 않았습니다. 설정 > 필수 도구에서 설치하세요.');
}

module.exports = { paths, status, install, dir, ensureReady, download };
