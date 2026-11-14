const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { shell, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const settings = require('./settings');

async function jsonOrThrow(res, label) {
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.error?.code === 'ok') return body;
  if (!res.ok || (body.error && typeof body.error === 'object' && (body.error.message || body.error.code))) {
    const msg = body.error?.message || body.error_description || body.detail || body.errors?.[0]?.message || body.message || JSON.stringify(body).slice(0, 200);
    throw new Error(`${label} 오류 (${res.status}): ${msg}`);
  }
  return body;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const videoBlob = (file) => new Blob([fs.readFileSync(file)], { type: 'video/mp4' });

function setConn(key, name, extra) {
  const prev = (settings.get().sns || {})[key] || {};
  settings.set({ sns: { ...(settings.get().sns || {}), [key]: name ? { ...prev, name, at: Date.now(), ...(extra || {}) } : undefined } });
  return name;
}

function youtubePage(item) {
  const id = item?.id || '';
  const handle = item?.snippet?.customUrl || '';
  if (handle) return `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}`;
  return id ? `https://www.youtube.com/channel/${id}` : '';
}

function makePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function openSystemBrowser(url) {
  if (process.platform === 'win32') {
    // cmd.exe treats & as a command separator. An unescaped OAuth URL is cut
    // after client_id, so Google returns 400 "Required parameter is missing: response_type".
    const escaped = url.replace(/([&|^<>])/g, (ch) => `^${ch}`);
    spawn('cmd', ['/c', 'start', '', escaped], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  shell.openExternal(url).catch(() => {});
}

function oauthLoopback({ port, pathname = '/', buildUrl, label, progress }) {
  const listenPort = port || 53681;
  const redirect = `http://127.0.0.1:${listenPort}${pathname === '/' ? '' : pathname}`;
  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:"Malgun Gothic",sans-serif;padding:36px;background:#f4f1ec;color:#222}
h2{margin:0 0 12px}p{line-height:1.55;color:#444}a,button{display:inline-block;margin:8px 8px 0 0;padding:10px 14px;border-radius:8px;border:0;background:#1f6feb;color:#fff;text-decoration:none;cursor:pointer;font-size:14px}
.ghost{background:#ddd;color:#333}</style></head><body><h2>${title}</h2>${body}</body></html>`;
  return new Promise((resolve, reject) => {
    let done = false;
    let win;
    let authUrl = '';
    const finish = (fn) => (arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { server.close(); } catch { /* already closed */ }
      try { if (win && !win.isDestroyed()) win.close(); } catch { /* already closed */ }
      fn(arg);
    };
    const ok = finish(resolve);
    const fail = finish((e) => reject(e instanceof Error ? e : new Error(String(e))));

    const html = (title, extra = '') => page(title, `
      <p>${label} 로그인은 앱 안 창에서 막힐 수 있습니다. <b>Chrome 또는 Edge</b>에서 로그인하세요.</p>
      <p>작업 표시줄에 브라우저 창이 열려 있는지 확인하세요. 로그인과 권한 허용을 마치면 쇼핑렌즈가 자동으로 이어집니다.</p>
      ${extra}
      <p><a href="/__reopen">브라우저 다시 열기</a><a class="ghost" href="/__cancel">취소</a></p>`);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${listenPort}`);
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
      };
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (url.pathname === '/__wait') return send(200, html(`${label} 연결`));
      if (url.pathname === '/__reopen') {
        if (authUrl) openSystemBrowser(authUrl);
        res.writeHead(302, { Location: '/__wait' });
        return res.end();
      }
      if (url.pathname === '/__cancel') {
        send(200, page('연결 취소', '<p>이 창을 닫아도 됩니다.</p>'));
        return fail(new Error(`${label} 연결을 취소했습니다.`));
      }
      const err = url.searchParams.get('error');
      const desc = url.searchParams.get('error_description') || err;
      const code = url.searchParams.get('code');
      if (err) {
        send(200, page(`${label} 연결 실패`, `<p>${desc || err}</p>`));
        return fail(new Error(`${label} 연결 실패: ${decodeURIComponent(String(desc).replace(/\+/g, ' '))}`));
      }
      if (code) {
        send(200, page(`${label} 연결 완료`, '<p>이 창을 닫고 쇼핑렌즈로 돌아가세요.</p>'));
        return ok({ code, redirect, state: url.searchParams.get('state') });
      }
      send(200, html(`${label} 연결 대기`));
    });

    server.on('error', (e) => fail(new Error(`${label} 연결용 포트(${listenPort})를 열 수 없습니다: ${e.message}`)));
    server.listen(listenPort, '127.0.0.1', () => {
      authUrl = buildUrl(redirect);
      progress?.({ text: `${label}: 기본 브라우저에서 로그인을 완료하세요` });
      openSystemBrowser(authUrl);
      const parent = BrowserWindow.getAllWindows()[0];
      win = new BrowserWindow({
        width: 460,
        height: 360,
        title: `${label} 연결`,
        parent: parent || undefined,
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      win.setAlwaysOnTop(true);
      win.on('closed', () => { win = null; });
      win.loadURL(`http://127.0.0.1:${listenPort}/__wait`);
      win.show();
    });
    const timer = setTimeout(() => {
      fail(new Error(`${label} 연결 시간이 초과되었습니다. 브라우저에서 로그인을 마쳤는지, OAuth 클라이언트가 데스크톱 앱인지, 리디렉션 URI가 ${redirect} 인지 확인하세요.`));
    }, 5 * 60 * 1000);
  });
}

/* ---------- YouTube ---------- */
async function youtubeConnect(progress) {
  const s = settings.get();
  const clientId = String(s.ytClientId || '').trim().replace(/^["']|["']$/g, '');
  const clientSecret = String(s.ytClientSecret || '').trim().replace(/^["']|["']$/g, '');
  if (!clientId || !clientSecret) throw new Error('YouTube OAuth 클라이언트 ID와 보안 비밀을 먼저 입력하세요. Google Cloud에서 "데스크톱 앱"으로 만든 OAuth 클라이언트여야 합니다.');
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('YouTube Data API 키가 아니라 OAuth 클라이언트 ID를 넣어야 합니다. 값은 xxx.apps.googleusercontent.com 형식입니다.');
  }
  const { verifier, challenge } = makePkce();
  const { code, redirect } = await oauthLoopback({
    port: 53681,
    label: '유튜브',
    progress,
    buildUrl: (redirect_uri) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: clientId,
        redirect_uri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
        access_type: 'offline',
        prompt: 'consent',
        hl: 'ko',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
  });
  const tok = await jsonOrThrow(
    await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect,
        grant_type: 'authorization_code', code_verifier: verifier,
      }),
    }),
    'Google 토큰',
  );
  if (!tok.refresh_token) throw new Error('Google이 재발급 토큰을 주지 않았습니다. OAuth 클라이언트가 데스크톱 앱인지, 동의 화면에서 권한을 허용했는지 확인하세요.');
  settings.set({ ytClientId: clientId, ytClientSecret: clientSecret, ytRefresh: tok.refresh_token });
  return youtubeCheck(tok.access_token);
}

async function youtubeToken() {
  const s = settings.get();
  if (!s.ytRefresh) throw new Error('유튜브 계정이 연결되지 않았습니다.');
  const tok = await jsonOrThrow(
    await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: s.ytClientId, client_secret: s.ytClientSecret, refresh_token: s.ytRefresh, grant_type: 'refresh_token' }),
    }),
    'Google 토큰',
  );
  return tok.access_token;
}

async function youtubeCheck(token) {
  token ||= await youtubeToken();
  const ch = await jsonOrThrow(await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token}` } }), 'YouTube 채널');
  const item = ch.items?.[0];
  const name = item?.snippet?.title || '연결됨';
  const url = youtubePage(item);
  settings.set({ ytChannel: name, ytChannelId: item?.id || '', ytChannelUrl: url });
  return setConn('youtube', name, url ? { url, id: item?.id || '' } : undefined);
}

async function youtubeUpload(file, meta, progress) {
  const token = await youtubeToken();
  const size = fs.statSync(file).size;
  const title = /#shorts/i.test(meta.title) ? meta.title : `${meta.title} #Shorts`;
  const status = meta.publishAt
    ? { privacyStatus: 'private', publishAt: new Date(meta.publishAt).toISOString(), selfDeclaredMadeForKids: false }
    : { privacyStatus: meta.privacy || 'public', selfDeclaredMadeForKids: false };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify({ snippet: { title: title.slice(0, 100), description: meta.desc || '', categoryId: '22' }, status }),
  });
  if (!init.ok) await jsonOrThrow(init, 'YouTube 업로드 준비');
  progress({ text: '유튜브에 영상 전송 중' });
  const put = await fetch(init.headers.get('location'), { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) }, body: fs.readFileSync(file) });
  const video = await jsonOrThrow(put, 'YouTube 업로드');
  if (meta.thumbnail && fs.existsSync(meta.thumbnail)) {
    await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${video.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
      body: fs.readFileSync(meta.thumbnail),
    }).catch(() => {});
  }
  return { text: meta.publishAt ? `예약 게시 (${new Date(meta.publishAt).toLocaleString('ko-KR')})` : '업로드 완료', url: `https://youtube.com/shorts/${video.id}` };
}

/* ---------- Instagram Reels (Instagram Login, no Facebook Page) ---------- */
const FB = 'https://graph.facebook.com/v21.0';
const IG = 'https://graph.instagram.com/v21.0';
const IG_PORT = 53684;
const IG_SCOPES = 'instagram_business_basic,instagram_business_content_publish';

async function instagramTokenBody(res, label) {
  const body = await res.json().catch(() => ({}));
  const row = Array.isArray(body.data) ? body.data[0] : body;
  const err = body.error_message || body.error?.message || body.error_description;
  if (!res.ok || err || !row?.access_token) throw new Error(`${label} 오류: ${err || JSON.stringify(body).slice(0, 180)}`);
  return row;
}

function saveInstagramToken({ accessToken, userId, expiresIn }) {
  const prev = settings.get();
  settings.set({
    igToken: accessToken || prev.igToken || '',
    igUserId: String(userId || prev.igUserId || ''),
    igExpires: expiresIn ? Date.now() + (Number(expiresIn) - 120) * 1000 : prev.igExpires || 0,
  });
}

async function instagramAccess() {
  const s = settings.get();
  if (!s.igToken) throw new Error('인스타그램 계정이 연결되지 않았습니다. 앱 ID를 넣고 연결하세요.');
  const left = Number(s.igExpires || 0) - Date.now();
  if (s.igExpires && left > 0 && left < 10 * 86400 * 1000) {
    try {
      const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: s.igToken });
      const next = await instagramTokenBody(await fetch(`https://graph.instagram.com/refresh_access_token?${q}`), 'Instagram 토큰 갱신');
      saveInstagramToken({ accessToken: next.access_token, userId: s.igUserId, expiresIn: next.expires_in });
    } catch { /* 갱신 전이면 기존 토큰을 그대로 씁니다. */ }
  }
  return settings.get().igToken;
}

async function instagramConnect(progress) {
  const s = settings.get();
  const clientId = String(s.igClientId || '').trim();
  const clientSecret = String(s.igClientSecret || '').trim();
  if (!clientId || !clientSecret) throw new Error('Instagram 앱 ID와 앱 시크릿을 먼저 입력하세요. Meta 앱의 Instagram 로그인 설정에 있습니다.');
  const state = crypto.randomBytes(16).toString('hex');
  const { code, redirect, state: back } = await oauthLoopback({
    port: IG_PORT,
    pathname: '/callback/',
    label: '인스타그램',
    progress,
    buildUrl: (redirectUri) =>
      `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: IG_SCOPES,
        state,
        enable_fb_login: 'false',
      })}`,
  });
  if (back && back !== state) throw new Error('인스타그램 로그인 응답이 요청과 맞지 않습니다. 다시 연결하세요.');
  const form = new FormData();
  form.append('client_id', clientId);
  form.append('client_secret', clientSecret);
  form.append('grant_type', 'authorization_code');
  form.append('redirect_uri', redirect);
  form.append('code', String(code).replace(/#_$/, '').trim());
  const short = await instagramTokenBody(await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form }), 'Instagram 로그인');
  let accessToken = short.access_token;
  let expiresIn = short.expires_in || 3600;
  try {
    const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: clientSecret, access_token: short.access_token });
    const long = await instagramTokenBody(await fetch(`https://graph.instagram.com/access_token?${q}`), 'Instagram 장기 토큰');
    accessToken = long.access_token || accessToken;
    expiresIn = long.expires_in || 5184000;
  } catch { /* 장기 교환이 실패해도 짧은 토큰으로 연결을 마칩니다. */ }
  saveInstagramToken({ accessToken, userId: short.user_id, expiresIn });
  return instagramCheck();
}

async function instagramCheck() {
  const token = await instagramAccess();
  const r = await jsonOrThrow(await fetch(`${IG}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`), 'Instagram 계정');
  const username = r.username;
  if (!username) throw new Error('인스타그램 사용자 이름을 가져오지 못했습니다. 프로페셔널 계정인지 확인하세요.');
  if (r.user_id || r.id) saveInstagramToken({ accessToken: token, userId: r.user_id || r.id, expiresIn: 0 });
  return setConn('instagram', `@${username}`, { url: `https://www.instagram.com/${username}/` });
}

function exposeMp4(file) {
  const token = crypto.randomBytes(12).toString('hex');
  const server = http.createServer((req, res) => {
    const pathOnly = (req.url || '').split('?')[0];
    if (pathOnly !== `/${token}.mp4`) { res.writeHead(404); return res.end(); }
    const size = fs.statSync(file).size;
    const send = (start, end, status) => {
      res.writeHead(status, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start, end }).pipe(res);
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : size - 1;
      if (start <= end && end < size) return send(start, end, 206);
    }
    send(0, size - 1, 200);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const proc = spawn('ssh', [
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'UserKnownHostsFile=NUL',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=30',
        '-N', '-T',
        '-R', `80:127.0.0.1:${port}`,
        'nokey@localhost.run',
      ], { windowsHide: true });
      let buf = '';
      let opened = false;
      const fail = (message) => {
        if (opened) return;
        opened = true;
        clearTimeout(timer);
        try { proc.kill(); } catch { /* already closed */ }
        try { server.close(); } catch { /* already closed */ }
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail('인스타그램이 영상을 가져갈 임시 주소를 만들지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.'), 30000);
      const onData = (chunk) => {
        buf += chunk.toString();
        const found = buf.match(/https:\/\/[a-z0-9.-]+\.(?:localhost\.run|lhr\.life)/i);
        if (!found || opened) return;
        opened = true;
        clearTimeout(timer);
        resolve({
          url: `${found[0]}/${token}.mp4`,
          close: () => {
            try { proc.kill(); } catch { /* already closed */ }
            try { server.close(); } catch { /* already closed */ }
          },
        });
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('error', () => fail('임시 공개 주소를 열려면 Windows OpenSSH(ssh)가 필요합니다.'));
      proc.on('exit', () => { if (!opened) fail('인스타그램이 영상을 가져갈 임시 주소를 만들지 못했습니다.'); });
    });
  });
}

async function instagramUpload(file, meta, progress) {
  const token = await instagramAccess();
  const userId = settings.get().igUserId;
  if (!userId) throw new Error('인스타그램 계정이 연결되지 않았습니다.');
  progress({ text: '인스타그램이 영상을 가져갈 주소를 여는 중' });
  const hosted = await exposeMp4(file);
  try {
    const params = new URLSearchParams({
      media_type: 'REELS',
      video_url: hosted.url,
      caption: meta.desc || meta.title || '',
      share_to_feed: meta.excludeFeed ? 'false' : 'true',
      access_token: token,
    });
    const container = await jsonOrThrow(await fetch(`${IG}/${userId}/media`, { method: 'POST', body: params }), 'Instagram 컨테이너');
    progress({ text: '인스타그램이 영상을 받는 중' });
    for (let i = 0; i < 60; i++) {
      const st = await jsonOrThrow(await fetch(`${IG}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`), 'Instagram 상태');
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`Instagram 처리 실패: ${st.status || st.status_code}`);
      progress({ text: `인스타그램 처리 대기 중 (${i + 1})` });
      await wait(5000);
      if (i === 59) throw new Error('인스타그램 처리 대기 시간이 초과되었습니다.');
    }
    const pub = await jsonOrThrow(await fetch(`${IG}/${userId}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: container.id, access_token: token }) }), 'Instagram 게시');
    const link = await fetch(`${IG}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`).then((r) => r.json()).catch(() => ({}));
    return { text: '릴스 게시 완료', url: link.permalink || '' };
  } finally {
    hosted.close();
  }
}

/* ---------- Facebook Page ---------- */
async function facebookCheck() {
  const s = settings.get();
  if (!s.fbPageId || !s.fbPageToken) throw new Error('페이스북 페이지 ID와 페이지 액세스 토큰을 입력하세요.');
  const r = await jsonOrThrow(await fetch(`${FB}/${s.fbPageId}?fields=name&access_token=${encodeURIComponent(s.fbPageToken)}`), 'Facebook 페이지');
  return setConn('facebook', r.name);
}

async function facebookUpload(file, meta, progress) {
  const s = settings.get();
  if (!s.fbPageId || !s.fbPageToken) throw new Error('페이스북 페이지가 연결되지 않았습니다.');
  const form = new FormData();
  form.append('access_token', s.fbPageToken);
  form.append('title', (meta.title || '').slice(0, 250));
  form.append('description', meta.desc || meta.title || '');
  if (meta.publishAt) {
    form.append('published', 'false');
    form.append('scheduled_publish_time', String(Math.floor(new Date(meta.publishAt).getTime() / 1000)));
  }
  form.append('source', videoBlob(file), path.basename(file));
  progress({ text: '페이스북에 영상 전송 중' });
  const r = await jsonOrThrow(await fetch(`https://graph-video.facebook.com/v21.0/${s.fbPageId}/videos`, { method: 'POST', body: form }), 'Facebook 업로드');
  return { text: meta.publishAt ? `예약 게시 (${new Date(meta.publishAt).toLocaleString('ko-KR')})` : '게시 완료', url: `https://www.facebook.com/${r.id}` };
}

/* ---------- Threads ---------- */
const TH = 'https://graph.threads.net/v1.0';

async function threadsCheck() {
  const s = settings.get();
  if (!s.threadsToken) throw new Error('Threads 액세스 토큰을 입력하세요.');
  const r = await jsonOrThrow(await fetch(`${TH}/me?fields=username&access_token=${encodeURIComponent(s.threadsToken)}`), 'Threads 계정');
  return setConn('threads', `@${r.username}`);
}

async function threadsUpload(_file, meta, progress) {
  const s = settings.get();
  if (!s.threadsToken) throw new Error('Threads 계정이 연결되지 않았습니다.');
  const body = [meta.title, meta.desc].filter(Boolean).join('\n\n');
  const text = (meta.link ? `${body.slice(0, 480 - meta.link.length)}\n\n${meta.link}` : body.slice(0, 500)).trim();
  progress({ text: 'Threads에 게시 중' });
  const params = new URLSearchParams({ media_type: 'TEXT', text, access_token: s.threadsToken });
  const c = await jsonOrThrow(await fetch(`${TH}/me/threads?${params}`, { method: 'POST' }), 'Threads 게시 준비');
  await wait(2000);
  const pub = await jsonOrThrow(await fetch(`${TH}/me/threads_publish?creation_id=${c.id}&access_token=${s.threadsToken}`, { method: 'POST' }), 'Threads 게시');
  const link = await fetch(`${TH}/${pub.id}?fields=permalink&access_token=${s.threadsToken}`).then((r) => r.json()).catch(() => ({}));
  return { text: meta.link ? '글 + 유튜브 링크 게시 완료' : '글 게시 완료 (Threads는 영상 파일 직접 업로드 불가)', url: link.permalink || '' };
}

/* ---------- X (Twitter) ---------- */
const X_PORT = 53682;
const X_REDIRECT = `http://127.0.0.1:${X_PORT}/x-callback`;

function xTokenRequest(params) {
  const s = settings.get();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (s.xClientSecret) headers.Authorization = `Basic ${Buffer.from(`${s.xClientId}:${s.xClientSecret}`).toString('base64')}`;
  return fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body: new URLSearchParams({ client_id: s.xClientId, ...params }) });
}

async function xConnect(progress) {
  const s = settings.get();
  if (!s.xClientId) throw new Error('X 개발자 포털의 OAuth 2.0 Client ID를 먼저 입력하세요.');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(8).toString('hex');
  const { code } = await oauthLoopback({
    port: X_PORT,
    pathname: '/x-callback',
    label: 'X',
    progress,
    buildUrl: () =>
      `https://x.com/i/oauth2/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: s.xClientId,
        redirect_uri: X_REDIRECT,
        scope: 'tweet.read tweet.write users.read media.write offline.access',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
  });
  const tok = await jsonOrThrow(await xTokenRequest({ code, grant_type: 'authorization_code', redirect_uri: X_REDIRECT, code_verifier: verifier }), 'X 토큰');
  settings.set({ xRefresh: tok.refresh_token, xAccess: tok.access_token, xExpires: Date.now() + (tok.expires_in - 60) * 1000 });
  return xCheck();
}

async function xToken() {
  const s = settings.get();
  if (!s.xRefresh) throw new Error('X 계정이 연결되지 않았습니다.');
  if (s.xAccess && s.xExpires > Date.now()) return s.xAccess;
  const tok = await jsonOrThrow(await xTokenRequest({ grant_type: 'refresh_token', refresh_token: s.xRefresh }), 'X 토큰 갱신');
  settings.set({ xRefresh: tok.refresh_token || s.xRefresh, xAccess: tok.access_token, xExpires: Date.now() + (tok.expires_in - 60) * 1000 });
  return tok.access_token;
}

async function xCheck() {
  const token = await xToken();
  const r = await jsonOrThrow(await fetch('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${token}` } }), 'X 계정');
  settings.set({ xUser: r.data.username });
  return setConn('x', `@${r.data.username}`);
}

async function xUpload(file, meta, progress) {
  const token = await xToken();
  const auth = { Authorization: `Bearer ${token}` };
  const buf = fs.readFileSync(file);
  const init = await jsonOrThrow(
    await fetch('https://api.x.com/2/media/upload/initialize', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'video/mp4', total_bytes: buf.length, media_category: 'tweet_video' }),
    }),
    'X 업로드 준비',
  );
  const id = init.data.id;
  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0, seg = 0; i < buf.length; i += CHUNK, seg++) {
    progress({ text: `X에 영상 전송 중 (${Math.min(100, Math.round(((i + CHUNK) / buf.length) * 100))}%)` });
    const form = new FormData();
    form.append('segment_index', String(seg));
    form.append('media', new Blob([buf.subarray(i, i + CHUNK)]), 'chunk');
    const r = await fetch(`https://api.x.com/2/media/upload/${id}/append`, { method: 'POST', headers: auth, body: form });
    if (!r.ok) await jsonOrThrow(r, 'X 업로드');
  }
  let info = (await jsonOrThrow(await fetch(`https://api.x.com/2/media/upload/${id}/finalize`, { method: 'POST', headers: auth }), 'X 업로드 완료')).data?.processing_info;
  for (let i = 0; info && info.state !== 'succeeded' && i < 60; i++) {
    if (info.state === 'failed') throw new Error(`X 영상 처리 실패: ${info.error?.message || ''}`);
    progress({ text: `X 영상 처리 대기 중 (${i + 1})` });
    await wait((info.check_after_secs || 3) * 1000);
    info = (await jsonOrThrow(await fetch(`https://api.x.com/2/media/upload?command=STATUS&media_id=${id}`, { headers: auth }), 'X 상태')).data?.processing_info;
  }
  const text = [meta.title, meta.desc].filter(Boolean).join('\n\n').slice(0, 280);
  const tw = await jsonOrThrow(
    await fetch('https://api.x.com/2/tweets', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, media: { media_ids: [id] } }) }),
    'X 게시',
  );
  return { text: '게시 완료', url: `https://x.com/${settings.get().xUser || 'i'}/status/${tw.data.id}` };
}

/* ---------- TikTok ---------- */
const TIKTOK_PORT = 53683;
const TIKTOK_REDIRECT = `http://127.0.0.1:${TIKTOK_PORT}/callback/`;
const TIKTOK_SCOPES = 'user.info.basic,user.info.profile,video.upload,video.publish';

function tiktokPkce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.randomBytes(64);
  let verifier = '';
  for (let i = 0; i < bytes.length; i++) verifier += chars[bytes[i] % chars.length];
  const challenge = crypto.createHash('sha256').update(verifier).digest('hex');
  return { verifier, challenge };
}

async function tiktokTokenRequest(params) {
  const s = settings.get();
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({
      client_key: String(s.tiktokClientKey || '').trim(),
      client_secret: String(s.tiktokClientSecret || '').trim(),
      ...params,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.error && body.error !== 'ok')) {
    const msg = body.error_description || (typeof body.error === 'string' ? body.error : body.error?.message) || body.message || `HTTP ${res.status}`;
    throw new Error(`TikTok 토큰 오류: ${msg}`);
  }
  return body;
}

function saveTikTokToken(tok) {
  const prev = settings.get();
  settings.set({
    tiktokToken: tok.access_token || '',
    tiktokRefresh: tok.refresh_token || prev.tiktokRefresh || '',
    tiktokExpires: Date.now() + ((Number(tok.expires_in) || 86400) - 60) * 1000,
    tiktokOpenId: tok.open_id || prev.tiktokOpenId || '',
  });
}

async function tiktokAccess() {
  const s = settings.get();
  if (s.tiktokToken && Number(s.tiktokExpires) > Date.now()) return s.tiktokToken;
  if (!s.tiktokRefresh) throw new Error('틱톡 계정이 연결되지 않았습니다. Client Key를 넣고 연결하세요.');
  const tok = await tiktokTokenRequest({ grant_type: 'refresh_token', refresh_token: s.tiktokRefresh });
  saveTikTokToken(tok);
  return tok.access_token;
}

async function tiktokConnect(progress) {
  const s = settings.get();
  const clientKey = String(s.tiktokClientKey || '').trim();
  const clientSecret = String(s.tiktokClientSecret || '').trim();
  if (!clientKey || !clientSecret) throw new Error('TikTok Client Key와 Client Secret을 먼저 입력하세요. developers.tiktok.com 앱의 자격 증명입니다.');
  const { verifier, challenge } = tiktokPkce();
  const state = crypto.randomBytes(16).toString('hex');
  const { code, redirect, state: back } = await oauthLoopback({
    port: TIKTOK_PORT,
    pathname: '/callback/',
    label: '틱톡',
    progress,
    buildUrl: () =>
      `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
        client_key: clientKey,
        response_type: 'code',
        scope: TIKTOK_SCOPES,
        redirect_uri: TIKTOK_REDIRECT,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
  });
  if (back && back !== state) throw new Error('틱톡 로그인 응답이 요청과 맞지 않습니다. 다시 연결하세요.');
  const tok = await tiktokTokenRequest({
    code, grant_type: 'authorization_code', redirect_uri: redirect, code_verifier: verifier,
  });
  saveTikTokToken(tok);
  return tiktokCheck();
}

async function tiktokProfile(token) {
  const ask = (fields) => fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, { headers: { Authorization: `Bearer ${token}` } });
  try {
    return (await jsonOrThrow(await ask('display_name,username'), 'TikTok 계정')).data?.user || {};
  } catch {
    return (await jsonOrThrow(await ask('display_name'), 'TikTok 계정')).data?.user || {};
  }
}

async function tiktokCheck() {
  const token = await tiktokAccess();
  const user = await tiktokProfile(token);
  const name = user.display_name || user.username || '연결됨';
  const handle = user.username || 'ggultemnara';
  const url = `https://www.tiktok.com/@${handle}`;
  settings.set({ tiktokProfile: url });
  return setConn('tiktok', name, { url });
}

async function tiktokPost(token, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function tiktokUnaudited(status, data) {
  const code = data?.error?.code || '';
  const msg = data?.error?.message || '';
  return status === 403 && (code === 'unaudited_client_can_only_post_to_private_accounts' || /integration guidelines|private account/i.test(msg));
}

function tiktokFail(data, status, label) {
  const msg = data?.error?.message || data?.error?.code || `HTTP ${status}`;
  throw new Error(`${label} 오류 (${status}): ${msg}`);
}

async function tiktokUpload(file, meta, progress) {
  const token = await tiktokAccess();
  const s = settings.get();
  const size = fs.statSync(file).size;
  const source = { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 };
  const direct = await tiktokPost(token, 'https://open.tiktokapis.com/v2/post/publish/video/init/', {
    post_info: { title: (meta.desc || meta.title || '').slice(0, 2200), privacy_level: s.tiktokPrivacy || 'SELF_ONLY', disable_comment: false },
    source_info: source,
  });
  let init = direct.data;
  let inbox = false;
  const directOk = direct.status === 200 && (!direct.data?.error?.code || direct.data.error.code === 'ok');
  if (!directOk && tiktokUnaudited(direct.status, direct.data)) {
    progress({ text: '틱톡 심사 전이라 받은편지함으로 보내는 중' });
    const box = await tiktokPost(token, 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', { source_info: source });
    const boxOk = box.status === 200 && (!box.data?.error?.code || box.data.error.code === 'ok');
    if (!boxOk) tiktokFail(box.data, box.status, 'TikTok 받은편지함');
    init = box.data;
    inbox = true;
  } else if (!directOk) {
    tiktokFail(direct.data, direct.status, 'TikTok 업로드 준비');
  }
  progress({ text: '틱톡에 영상 전송 중' });
  const put = await fetch(init.data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` },
    body: fs.readFileSync(file),
  });
  if (!put.ok) throw new Error(`TikTok 업로드 오류 (${put.status})`);
  if (inbox) return { text: '틱톡 받은편지함으로 보냈습니다. 틱톡 앱 알림에서 게시하세요.', url: '' };
  return { text: `업로드 완료 (${s.tiktokPrivacy || 'SELF_ONLY'})`, url: '' };
}

/* ---------- registry ---------- */
const PLATFORMS = {
  youtube: { upload: youtubeUpload, check: () => youtubeCheck(), connect: youtubeConnect, keys: ['ytRefresh', 'ytChannel', 'ytChannelId', 'ytChannelUrl'] },
  tiktok: { upload: tiktokUpload, check: tiktokCheck, connect: tiktokConnect, keys: ['tiktokToken', 'tiktokRefresh', 'tiktokExpires', 'tiktokOpenId', 'tiktokProfile'] },
  instagram: { upload: instagramUpload, check: instagramCheck, connect: instagramConnect, keys: ['igUserId', 'igToken', 'igExpires'] },
  threads: { upload: threadsUpload, check: threadsCheck, keys: ['threadsToken'] },
  facebook: { upload: facebookUpload, check: facebookCheck, keys: ['fbPageId', 'fbPageToken'] },
  x: { upload: xUpload, check: xCheck, connect: xConnect, keys: ['xRefresh', 'xAccess', 'xExpires', 'xUser'] },};

function platform(key) {
  const p = PLATFORMS[key];
  if (!p) throw new Error(`알 수 없는 플랫폼: ${key}`);
  return p;
}

async function upload(key, file, meta, progress) {
  if (!file || !fs.existsSync(file)) throw new Error('업로드할 영상 파일이 없습니다.');
  const r = await platform(key).upload(file, meta, progress);
  return typeof r === 'string' ? { text: r, url: /^https?:/.test(r) ? r : '' } : r;
}

async function connect(key, progress) {
  const p = platform(key);
  try {
    return await (p.connect || p.check)(progress);
  } catch (e) {
    setConn(key, null);
    throw e;
  }
}

async function check(key) {
  try {
    return { ok: true, name: await platform(key).check() };
  } catch (e) {
    setConn(key, null);
    return { ok: false, error: e.message };
  }
}

function disconnect(key) {
  const patch = Object.fromEntries(platform(key).keys.map((k) => [k, '']));
  settings.set(patch);
  setConn(key, null);
}

module.exports = { youtubeConnect, youtubeCheck, upload, connect, check, disconnect, PLATFORMS };
