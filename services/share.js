const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const qr = require('qrcode');

let server;

function lanIp() {
  const list = Object.values(os.networkInterfaces()).flat().filter(Boolean);
  return (list.find((i) => i.family === 'IPv4' && !i.internal) || {}).address || '127.0.0.1';
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

function start(file) {
  stop();
  if (!file || !fs.existsSync(file)) throw new Error('보낼 파일이 없습니다.');
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(path.basename(file))}"`,
      });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '0.0.0.0', async () => {
      const url = `http://${lanIp()}:${server.address().port}/${encodeURIComponent(path.basename(file))}`;
      resolve({ url, qr: await qr.toDataURL(url, { margin: 1, width: 280 }) });
    });
  });
}

module.exports = { start, stop };
