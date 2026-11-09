const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
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

function setConn(key, name) {
  settings.set({ sns: { ...(settings.get().sns || {}), [key]: name ? { name, at: Date.now() } : undefined } });
  return name;
}

function oauthLoopback({ port = 0, pathname = '/', buildUrl, label }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== pathname) return res.end();
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h2>쇼핑렌즈: ${label} ${code ? '연결이 완료되었습니다. 이 창을 닫아도 됩니다.' : '연결이 취소되었습니다.'}</h2>`);
      server.close();
      clearTimeout(timer);
      if (code) resolve({ code, redirect: `http://127.0.0.1:${server.address()?.port || usedPort}${pathname}`, state: url.searchParams.get('state') });
      else reject(new Error(`${label} 연결이 취소되었습니다.`));
    });
    let usedPort;
    server.on('error', (e) => reject(new Error(`${label} 연결용 포트(${port})를 열 수 없습니다: ${e.message}`)));
    server.listen(port, '127.0.0.1', () => {
      usedPort = server.address().port;
      shell.openExternal(buildUrl(`http://127.0.0.1:${usedPort}${pathname}`));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`${label} 연결 시간이 초과되었습니다.`));
    }, 5 * 60 * 1000);
  });
}

/* ---------- YouTube ---------- */
async function youtubeConnect() {
  const s = settings.get();
  if (!s.ytClientId || !s.ytClientSecret) throw new Error('YouTube OAuth 클라이언트 ID와 보안 비밀을 먼저 입력하세요.');
  const { code, redirect } = await oauthLoopback({
    label: '유튜브',
    buildUrl: (redirect_uri) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: s.ytClientId,
        redirect_uri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
        access_type: 'offline',
        prompt: 'consent',
      })}`,
  });
  const tok = await jsonOrThrow(
    await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: s.ytClientId, client_secret: s.ytClientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }),
    }),
    'Google 토큰',
  );
  settings.set({ ytRefresh: tok.refresh_token });
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
  const name = ch.items?.[0]?.snippet?.title || '연결됨';
  settings.set({ ytChannel: name });
  return setConn('youtube', name);
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

/* ---------- Instagram Reels ---------- */
const FB = 'https://graph.facebook.com/v21.0';

async function instagramCheck() {
  const s = settings.get();
  if (!s.igUserId || !s.igToken) throw new Error('인스타그램 비즈니스 계정 ID와 액세스 토큰을 입력하세요.');
  const r = await jsonOrThrow(await fetch(`${FB}/${s.igUserId}?fields=username&access_token=${encodeURIComponent(s.igToken)}`), 'Instagram 계정');
  return setConn('instagram', `@${r.username}`);
}

async function instagramUpload(file, meta, progress) {
  const s = settings.get();
  if (!s.igUserId || !s.igToken) throw new Error('인스타그램 계정이 연결되지 않았습니다.');
  const params = new URLSearchParams({ media_type: 'REELS', upload_type: 'resumable', caption: meta.desc || meta.title || '', share_to_feed: meta.excludeFeed ? 'false' : 'true', access_token: s.igToken });
  const container = await jsonOrThrow(await fetch(`${FB}/${s.igUserId}/media?${params}`, { method: 'POST' }), 'Instagram 컨테이너');
  const size = fs.statSync(file).size;
  progress({ text: '인스타그램에 영상 전송 중' });
  await jsonOrThrow(
    await fetch(container.uri || `https://rupload.facebook.com/ig-api-upload/v21.0/${container.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${s.igToken}`, offset: '0', file_size: String(size) },
      body: fs.readFileSync(file),
    }),
    'Instagram 업로드',
  );
  for (let i = 0; i < 60; i++) {
    const st = await jsonOrThrow(await fetch(`${FB}/${container.id}?fields=status_code,status&access_token=${s.igToken}`), 'Instagram 상태');
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR') throw new Error(`Instagram 처리 실패: ${st.status}`);
    progress({ text: `인스타그램 처리 대기 중 (${i + 1})` });
    await wait(5000);
  }
  const pub = await jsonOrThrow(await fetch(`${FB}/${s.igUserId}/media_publish?creation_id=${container.id}&access_token=${s.igToken}`, { method: 'POST' }), 'Instagram 게시');
  const link = await fetch(`${FB}/${pub.id}?fields=permalink&access_token=${s.igToken}`).then((r) => r.json()).catch(() => ({}));
  return { text: '릴스 게시 완료', url: link.permalink || '' };
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

async function xConnect() {
  const s = settings.get();
  if (!s.xClientId) throw new Error('X 개발자 포털의 OAuth 2.0 Client ID를 먼저 입력하세요.');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(8).toString('hex');
  const { code } = await oauthLoopback({
    port: X_PORT,
    pathname: '/x-callback',
    label: 'X',
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
async function tiktokCheck() {
  const s = settings.get();
  if (!s.tiktokToken) throw new Error('틱톡 액세스 토큰을 입력하세요.');
  const r = await jsonOrThrow(await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name', { headers: { Authorization: `Bearer ${s.tiktokToken}` } }), 'TikTok 계정');
  return setConn('tiktok', r.data?.user?.display_name || '연결됨');
}

async function tiktokUpload(file, meta, progress) {
  const s = settings.get();
  if (!s.tiktokToken) throw new Error('틱톡 계정이 연결되지 않았습니다.');
  const size = fs.statSync(file).size;
  const init = await jsonOrThrow(
    await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.tiktokToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        post_info: { title: (meta.desc || meta.title || '').slice(0, 2200), privacy_level: s.tiktokPrivacy || 'SELF_ONLY', disable_comment: false },
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 },
      }),
    }),
    'TikTok 업로드 준비',
  );
  progress({ text: '틱톡에 영상 전송 중' });
  const put = await fetch(init.data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` },
    body: fs.readFileSync(file),
  });
  if (!put.ok) throw new Error(`TikTok 업로드 오류 (${put.status})`);
  return { text: `업로드 완료 (${s.tiktokPrivacy || 'SELF_ONLY'})`, url: '' };
}

/* ---------- registry ---------- */
const PLATFORMS = {
  youtube: { upload: youtubeUpload, check: () => youtubeCheck(), connect: youtubeConnect, keys: ['ytRefresh', 'ytChannel'] },
  tiktok: { upload: tiktokUpload, check: tiktokCheck, keys: ['tiktokToken'] },
  instagram: { upload: instagramUpload, check: instagramCheck, keys: ['igUserId', 'igToken'] },
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

async function connect(key) {
  const p = platform(key);
  try {
    return await (p.connect || p.check)();
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

module.exports = { youtubeConnect, upload, connect, check, disconnect, PLATFORMS };
