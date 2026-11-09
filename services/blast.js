const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const uploader = require('./upload');

const NATIVE_SCHEDULE = ['youtube', 'facebook'];
const ORDER = ['youtube', 'tiktok', 'instagram', 'facebook', 'x', 'threads'];
const MAX_HISTORY = 20;

const storeFile = () => path.join(app.getPath('userData'), 'blast.json');
const queueDir = () => path.join(app.getPath('userData'), 'blast-queue');

function load() {
  try {
    return { jobs: [], history: [], ...JSON.parse(fs.readFileSync(storeFile(), 'utf8')) };
  } catch {
    return { jobs: [], history: [] };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(db, null, 2));
}

function broadcast() {
  BrowserWindow.getAllWindows().forEach((w) => !w.webContents.isDestroyed() && w.webContents.send('blast-update'));
}

function addHistory(entry) {
  const db = load();
  db.history = [entry, ...db.history].slice(0, MAX_HISTORY);
  save(db);
  broadcast();
}

async function runTargets(file, meta, targets, progress) {
  const results = [];
  const sorted = ORDER.filter((k) => targets.includes(k));
  let link = meta.link || '';
  for (const key of sorted) {
    progress({ text: `${key} 업로드 중 (${results.length + 1}/${sorted.length})` });
    try {
      const r = await uploader.upload(key, file, { ...meta, link }, progress);
      if (key === 'youtube' && r.url && !meta.publishAt) link = r.url;
      results.push({ platform: key, ok: true, ...r });
    } catch (e) {
      results.push({ platform: key, ok: false, text: e.message });
    }
  }
  return results;
}

async function blast(progress, { file, title, desc, targets, excludeFeed, when }) {
  if (!file || !fs.existsSync(file)) throw new Error('업로드할 영상을 먼저 선택하세요.');
  if (!targets?.length) throw new Error('업로드할 SNS를 하나 이상 선택하세요.');
  if (!title && !desc) throw new Error('제목이나 설명을 입력하세요.');
  const meta = { title, desc, excludeFeed };
  const base = { id: Date.now().toString(36), time: Date.now(), title: title || desc.slice(0, 30), file: path.basename(file) };

  if (when && when > Date.now() + 60 * 1000) {
    const native = targets.filter((t) => NATIVE_SCHEDULE.includes(t));
    const queued = targets.filter((t) => !NATIVE_SCHEDULE.includes(t));
    let results = [];
    if (native.length) {
      results = await runTargets(file, { ...meta, publishAt: new Date(when).toISOString() }, native, progress);
      addHistory({ ...base, scheduledFor: when, results });
    }
    if (queued.length) {
      fs.mkdirSync(queueDir(), { recursive: true });
      const copy = path.join(queueDir(), `${base.id}${path.extname(file) || '.mp4'}`);
      fs.copyFileSync(file, copy);
      const db = load();
      db.jobs.push({ ...base, src: copy, meta, targets: queued, when });
      save(db);
      broadcast();
    }
    return { scheduled: true, native, queued, results };
  }

  const results = await runTargets(file, meta, targets, progress);
  addHistory({ ...base, results });
  return { scheduled: false, results };
}

let running = false;
async function tick() {
  if (running) return;
  const due = load().jobs.filter((j) => j.when <= Date.now());
  if (!due.length) return;
  running = true;
  try {
    for (const job of due) {
      const db = load();
      db.jobs = db.jobs.filter((j) => j.id !== job.id);
      save(db);
      broadcast();
      const late = Date.now() - job.when > 10 * 60 * 1000;
      const results = fs.existsSync(job.src)
        ? await runTargets(job.src, job.meta, job.targets, () => {})
        : job.targets.map((platform) => ({ platform, ok: false, text: '예약된 영상 파일을 찾을 수 없습니다.' }));
      addHistory({ id: job.id, time: Date.now(), title: job.title, file: job.file, scheduledFor: job.when, late, results });
      fs.rmSync(job.src, { force: true });
    }
  } finally {
    running = false;
  }
}

function start() {
  setTimeout(tick, 5000);
  setInterval(tick, 30 * 1000);
}

function state() {
  const db = load();
  return { jobs: db.jobs.sort((a, b) => a.when - b.when), history: db.history };
}

function cancelJob(id) {
  const db = load();
  const job = db.jobs.find((j) => j.id === id);
  db.jobs = db.jobs.filter((j) => j.id !== id);
  save(db);
  if (job) fs.rmSync(job.src, { force: true });
  return state();
}

function clearHistory() {
  const db = load();
  db.history = [];
  save(db);
  return state();
}

module.exports = { blast, state, cancelJob, clearHistory, start };
