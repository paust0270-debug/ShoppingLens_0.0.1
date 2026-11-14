const { spawn } = require('child_process');
const path = require('path');

const procs = new Set();
const MAX_LOG = 20000;

function killProc(p) {
  if (!p?.pid) return;
  spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { windowsHide: true });
}

function run(cmd, args, { cwd, env, onLine, timeout } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: env || process.env, windowsHide: true });
    procs.add(p);
    let out = '';
    let err = '';
    let timer;
    const handle = (buf, isErr) => {
      const s = buf.toString('utf8');
      if (isErr) err = (err + s).slice(-MAX_LOG);
      else out += s;
      if (onLine) s.split(/\r?\n|\r/).forEach((l) => l && onLine(l));
    };
    if (timeout) {
      timer = setTimeout(() => {
        p.timedOut = true;
        killProc(p);
      }, timeout);
    }
    p.stdout.on('data', (d) => handle(d, false));
    p.stderr.on('data', (d) => handle(d, true));
    p.on('error', (e) => {
      if (timer) clearTimeout(timer);
      procs.delete(p);
      reject(e);
    });
    p.on('close', (code) => {
      if (timer) clearTimeout(timer);
      procs.delete(p);
      if (p.cancelled) reject(new Error('CANCELLED'));
      else if (p.timedOut) reject(new Error(`${path.basename(cmd)} 시간 초과`));
      else if (code === 0) resolve({ out, err });
      else reject(new Error(`${path.basename(cmd)} 실패 (코드 ${code}): ${err.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

let cancelFlag = false;
const aborts = new Set();

function trackFetch() {
  const ctrl = new AbortController();
  aborts.add(ctrl);
  return ctrl;
}

function releaseFetch(ctrl) {
  aborts.delete(ctrl);
}

function cancelAll() {
  cancelFlag = true;
  for (const p of procs) {
    p.cancelled = true;
    killProc(p);
  }
  for (const ctrl of aborts) ctrl.abort();
  aborts.clear();
}

function resetCancel() {
  cancelFlag = false;
}

function checkCancel() {
  if (cancelFlag) throw new Error('CANCELLED');
}

module.exports = { run, cancelAll, resetCancel, checkCancel, trackFetch, releaseFetch };
