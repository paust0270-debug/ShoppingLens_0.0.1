const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const qr = require('qrcode');

const SHARE_PORT = 53690;
let server;
let child;

function lanIp() {
  const scored = [];
  for (const [name, items] of Object.entries(os.networkInterfaces())) {
    if (/virtual|vmware|hyper-v|wsl|loopback|bluetooth|vbox/i.test(name)) continue;
    for (const item of items || []) {
      if ((item.family !== 'IPv4' && item.family !== 4) || item.internal) continue;
      const ip = item.address;
      let score = 1;
      if (/^192\.168\./.test(ip)) score = 3;
      else if (/^10\./.test(ip)) score = 2;
      scored.push({ ip, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.ip || '127.0.0.1';
}

function nodeBin() {
  if (!process.versions.electron) return '';
  try {
    return execFileSync('where.exe', ['node'], { encoding: 'utf8' }).split(/\r?\n/).map((s) => s.trim()).find((s) => /node\.exe$/i.test(s)) || '';
  } catch {
    return '';
  }
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
  if (child) {
    child.kill();
    child = null;
  }
}

function page(name, size) {
  const mb = (size / 1024 / 1024).toFixed(1);
  const title = name.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<body style="margin:0;font-family:sans-serif;background:#111;color:#fff">
<main style="max-width:420px;margin:0 auto;padding:32px 20px">
<h1 style="font-size:22px;margin:0 0 8px">영상 다운로드</h1>
<p style="color:#bbb;word-break:break-all">${title}</p>
<p style="color:#888">${mb}MB</p>
<a href="/file" download style="display:block;text-align:center;background:#e11d2e;color:#fff;text-decoration:none;padding:16px;border-radius:14px;font-weight:700;font-size:18px">영상 받기</a>
<p style="color:#888;font-size:13px">버튼이 바로 저장되지 않으면 버튼을 길게 눌러 다운로드를 선택하세요. 아이폰은 파일 앱에 저장됩니다.</p>
</main>
</body></html>`;
}

function sendFile(req, res, file, name, size) {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  const headers = {
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/octet-stream',
  };
  const match = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (match) {
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isFinite(start) || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  fs.createReadStream(file).pipe(res);
}

function listen(file) {
  const name = path.basename(file);
  const size = fs.statSync(file).size;
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
      if (pathname === '/file') {
        sendFile(req, res, file, name, size);
        return;
      }
      const html = page(name, size);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-store' });
      res.end(html);
    });
    server.on('error', reject);
    server.listen(SHARE_PORT, '0.0.0.0', () => resolve(`http://${lanIp()}:${SHARE_PORT}/`));
  });
}

function startWithNode(node, file) {
  return new Promise((resolve, reject) => {
    child = spawn(node, [path.join(__dirname, 'share-serve.js'), file], { windowsHide: true });
    let buf = '';
    let settled = false;
    const fail = (msg) => {
      if (settled) return;
      settled = true;
      reject(new Error(msg));
    };
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (!line || settled) return;
      settled = true;
      try {
        const msg = JSON.parse(line);
        qr.toDataURL(msg.url, { margin: 1, width: 280 }).then((img) => resolve({ url: msg.url, fileUrl: `${msg.url}file`, qr: img })).catch(fail);
      } catch (e) {
        fail(e.message);
      }
    });
    child.stderr.on('data', (d) => fail(d.toString().trim() || '폰 다운로드 서버를 열지 못했습니다.'));
    child.on('exit', (code) => { if (!settled && code) fail('폰 다운로드 서버를 열지 못했습니다.'); });
  });
}

function start(file) {
  stop();
  if (!file || !fs.existsSync(file)) throw new Error('보낼 파일이 없습니다.');
  const node = nodeBin();
  if (node) return startWithNode(node, file);
  return listen(file).then(async (url) => ({ url, fileUrl: `${url}file`, qr: await qr.toDataURL(url, { margin: 1, width: 280 }) }));
}

module.exports = { start, stop, listen };
