const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const CDP_PORT = 9223;
const INCOGNITO_PORT = 9224;
const REAL_DATA_DIR = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
const DEBUG_DATA_DIR = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'DebugProfile');
const HEADLESS_DIR = path.join(process.env.LOCALAPPDATA || '', 'ShoppingLens', 'chrome-headless');
const INCOGNITO_DIR = path.join(process.env.LOCALAPPDATA || '', 'ShoppingLens', 'chrome-incognito');

let chromeProc = null;
let incognitoProc = null;
let wsEndpoint = null;
let incognitoWs = null;

function findChrome() {
  const candidates = [
    path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function cdpGet(urlPath, port = CDP_PORT) {
  return new Promise((ok, fail) => {
    const opts = { hostname: '127.0.0.1', port, path: urlPath };
    http.get(opts, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => { try { ok(JSON.parse(d)); } catch { ok(d); } });
    }).on('error', fail);
  });
}

async function cdpPut(urlPath, port = CDP_PORT) {
  return new Promise((ok, fail) => {
    const opts = { hostname: '127.0.0.1', port, path: urlPath, method: 'PUT' };
    const req = http.request(opts, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => { try { ok(JSON.parse(d)); } catch { ok(d); } });
    });
    req.on('error', fail);
    req.end();
  });
}

async function waitForCdp(timeoutMs = 25000, port = CDP_PORT) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const data = await cdpGet('/json/version', port);
      if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
    } catch {}
    await new Promise(ok => setTimeout(ok, 500));
  }
  throw new Error('Chrome CDP 연결 시간 초과');
}

async function killAllChrome() {
  try {
    execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore', timeout: 5000 });
  } catch {}
  chromeProc = null;
  wsEndpoint = null;
  for (let i = 0; i < 15; i++) {
    await new Promise(ok => setTimeout(ok, 500));
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { timeout: 3000 }).toString();
      if (!/chrome\.exe/i.test(out)) {
        console.log('[chromeDriver] Chrome 완전 종료');
        return;
      }
    } catch {}
  }
  try { execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore', timeout: 5000 }); } catch {}
  await new Promise(ok => setTimeout(ok, 2000));
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      try { fs.copyFileSync(s, d); } catch (e) {
        console.log(`[chromeDriver] 파일 복사 실패: ${entry.name} - ${e.message}`);
      }
    }
  }
}

function copyProfile() {
  console.log('[chromeDriver] 로그인 쿠키만 DebugProfile로 복사...');
  const srcDefault = path.join(REAL_DATA_DIR, 'Default');
  const dstDefault = path.join(DEBUG_DATA_DIR, 'Default');
  fs.mkdirSync(dstDefault, { recursive: true });

  const localState = path.join(REAL_DATA_DIR, 'Local State');
  if (fs.existsSync(localState)) {
    try { fs.copyFileSync(localState, path.join(DEBUG_DATA_DIR, 'Local State')); } catch {}
  }

  const netSrc = path.join(srcDefault, 'Network');
  if (fs.existsSync(netSrc)) copyDir(netSrc, path.join(dstDefault, 'Network'));

  for (const name of ['Cookies', 'Cookies-journal', 'Login Data', 'Login Data-journal', 'Preferences', 'Secure Preferences']) {
    const s = path.join(srcDefault, name);
    if (!fs.existsSync(s)) continue;
    try { fs.copyFileSync(s, path.join(dstDefault, name)); } catch {}
  }
  console.log('[chromeDriver] 프로필 복사 완료');
}

function prepareHeadlessProfile(srcUserData) {
  fs.rmSync(HEADLESS_DIR, { recursive: true, force: true });
  const dstNetwork = path.join(HEADLESS_DIR, 'Default', 'Network');
  fs.mkdirSync(dstNetwork, { recursive: true });
  const localState = path.join(srcUserData, 'Local State');
  if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(HEADLESS_DIR, 'Local State'));
  const cookie = path.join(srcUserData, 'Default', 'Network', 'Cookies');
  if (!fs.existsSync(cookie)) throw new Error('Chrome 로그인 쿠키를 찾지 못했습니다.');
  fs.copyFileSync(cookie, path.join(dstNetwork, 'Cookies'));
  console.log('[chromeDriver] 헤드리스 프로필 준비');
}

async function launch() {
  // Already running with CDP?
  if (chromeProc && !chromeProc.killed) {
    try {
      const ver = await cdpGet('/json/version');
      if (ver.webSocketDebuggerUrl) {
        wsEndpoint = ver.webSocketDebuggerUrl;
        return;
      }
    } catch {
      chromeProc.kill();
      chromeProc = null;
    }
  }
  // Check if any Chrome has CDP port already
  try {
    const ver = await cdpGet('/json/version');
    if (ver.webSocketDebuggerUrl) {
      wsEndpoint = ver.webSocketDebuggerUrl;
      console.log('[chromeDriver] 기존 Chrome CDP 연결됨');
      return;
    }
  } catch {}

  const exe = findChrome();
  if (!exe) throw new Error('Chrome을 찾을 수 없습니다.');

  let chromeBusy = false;
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { timeout: 3000 }).toString();
    chromeBusy = /chrome\.exe/i.test(out);
  } catch {}

  if (chromeBusy) {
    console.log('[chromeDriver] Chrome이 이미 실행 중 → 로그인 쿠키만 복사 (기존 창은 유지)');
    copyProfile();
    prepareHeadlessProfile(DEBUG_DATA_DIR);
  } else {
    prepareHeadlessProfile(REAL_DATA_DIR);
  }

  console.log('[chromeDriver] 헤드리스 Chrome 시작...');
  chromeProc = spawn(exe, [
    '--headless=new',
    '--disable-gpu',
    '--mute-audio',
    '--disable-blink-features=AutomationControlled',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${HEADLESS_DIR}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
  ], { stdio: 'ignore', detached: true });
  chromeProc.unref();
  chromeProc.on('exit', () => { chromeProc = null; wsEndpoint = null; });
  wsEndpoint = await waitForCdp();
  console.log('[chromeDriver] Chrome 준비 완료');
}

const SPAWNED_TAB = /1688|taobao|tmall|xiaohongshu|rednote|douyin|alibaba|coupang|about:blank|chrome:\/\/newtab/i;

async function closeTarget(id, port = CDP_PORT) {
  if (!id) return;
  try {
    await cdpGet('/json/close/' + encodeURIComponent(id), port);
  } catch (e) {
    console.log(`[chromeDriver] 탭 닫기 실패 ${String(id).slice(0, 12)} ${e.message || e}`);
  }
}

async function quitIncognito() {
  const pid = incognitoProc?.pid;
  incognitoProc = null;
  incognitoWs = null;
  if (!pid) return;
  try {
    execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore', timeout: 5000 });
  } catch {}
}

class CdpTab {
  constructor(wsUrl, targetId, priorIds, port = CDP_PORT) {
    this._wsUrl = wsUrl;
    this._targetId = targetId;
    this._priorIds = priorIds || new Set();
    this._port = port;
    this._ws = null;
    this._msgId = 0;
    this._pending = new Map();
    this._listeners = [];
    this._closed = false;
  }
  async connect() {
    const WebSocket = globalThis.WebSocket || require('ws');
    this._ws = new WebSocket(this._wsUrl);
    this._ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id !== undefined && this._pending.has(msg.id)) {
        this._pending.get(msg.id)(msg);
        this._pending.delete(msg.id);
      }
      for (const fn of this._listeners) fn(msg);
    });
    await new Promise((ok, fail) => {
      this._ws.addEventListener('open', ok);
      this._ws.addEventListener('error', fail);
    });
  }
  send(method, params = {}, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++this._msgId;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP 시간 초과: ${method}`));
      }, timeoutMs);
      this._pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg);
      });
      this._ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) { this._listeners.push(fn); }
  off(fn) { this._listeners = this._listeners.filter(f => f !== fn); }
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      timeout,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || 'eval error');
    }
    return r.result?.result?.value;
  }
  async navigate(url) {
    await this.send('Page.navigate', { url });
    await new Promise(ok => setTimeout(ok, 3500));
  }
  async close() {
    if (this._closed) return;
    this._closed = true;
    try { await this.send('Page.stopLoading', {}, 3000); } catch {}
    if (this._ws) {
      try { this._ws.close(); } catch {}
      this._ws = null;
    }
    await closeTarget(this._targetId, this._port);
    try {
      const list = await cdpGet('/json/list', this._port);
      const pages = Array.isArray(list) ? list : [];
      for (const t of pages) {
        if (!t || t.type !== 'page' || !t.id) continue;
        if (t.id === this._targetId || this._priorIds.has(t.id)) continue;
        if (!SPAWNED_TAB.test(t.url || '')) continue;
        await closeTarget(t.id, this._port);
      }
    } catch {}
    if (this._port === INCOGNITO_PORT) {
      let leftover = [];
      try {
        const still = await cdpGet('/json/list', this._port);
        leftover = (Array.isArray(still) ? still : []).filter((t) => t.type === 'page' && !/chrome:\/\/(newtab|welcome)|about:blank/i.test(t.url || ''));
      } catch {}
      if (!leftover.length) await quitIncognito();
    }
  }
}

async function openOnPort(url, port) {
  const existing = await cdpGet('/json/list', port);
  const priorIds = new Set((Array.isArray(existing) ? existing : []).map((t) => t.id).filter(Boolean));
  const target = await cdpPut('/json/new?about:blank', port);
  if (!target || !target.webSocketDebuggerUrl) throw new Error('Chrome 탭을 만들지 못했습니다.');
  priorIds.delete(target.id);
  const tab = new CdpTab(target.webSocketDebuggerUrl, target.id, priorIds, port);
  try {
    await tab.connect();
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    await tab.send('Network.enable');
    if (url && url !== 'about:blank') {
      await tab.navigate(url);
    }
    return tab;
  } catch (e) {
    await tab.close().catch(() => {});
    throw e;
  }
}

async function openTab(url) {
  await launch();
  return openOnPort(url, CDP_PORT);
}

async function launchIncognito() {
  if (incognitoProc && !incognitoProc.killed) {
    try {
      const ver = await cdpGet('/json/version', INCOGNITO_PORT);
      if (ver.webSocketDebuggerUrl) {
        incognitoWs = ver.webSocketDebuggerUrl;
        return;
      }
    } catch {
      try { incognitoProc.kill(); } catch {}
      incognitoProc = null;
    }
  }
  try {
    const ver = await cdpGet('/json/version', INCOGNITO_PORT);
    if (ver.webSocketDebuggerUrl) {
      incognitoWs = ver.webSocketDebuggerUrl;
      console.log('[chromeDriver] 기존 시크릿 Chrome 연결됨');
      return;
    }
  } catch {}

  const exe = findChrome();
  if (!exe) throw new Error('Chrome을 찾을 수 없습니다.');
  fs.mkdirSync(INCOGNITO_DIR, { recursive: true });
  console.log('[chromeDriver] 쿠팡용 시크릿 Chrome 시작');
  incognitoProc = spawn(exe, [
    `--remote-debugging-port=${INCOGNITO_PORT}`,
    `--user-data-dir=${INCOGNITO_DIR}`,
    '--incognito',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
  ], { stdio: 'ignore', detached: true });
  incognitoProc.unref();
  incognitoProc.on('exit', () => { incognitoProc = null; incognitoWs = null; });
  incognitoWs = await waitForCdp(25000, INCOGNITO_PORT);
  console.log('[chromeDriver] 시크릿 Chrome 준비 완료');
}

async function openIncognitoTab(url) {
  await launchIncognito();
  return openOnPort(url, INCOGNITO_PORT);
}

async function closeChrome() {
  chromeProc = null;
  wsEndpoint = null;
}

module.exports = { launch, openTab, openIncognitoTab, closeChrome, findChrome };
