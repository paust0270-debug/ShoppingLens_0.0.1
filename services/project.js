const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const root = () => path.join(app.getPath('documents'), 'ShoppingLens');
const safe = (n) => String(n || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'untitled';

function collectRoot() {
  try {
    if (app.isPackaged) {
      let dir = path.dirname(app.getPath('exe'));
      for (let i = 0; i < 6; i++) {
        if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'main.js'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return path.dirname(app.getPath('exe'));
    }
  } catch {}
  return path.join(__dirname, '..');
}

function collectDir(kind) {
  const d = path.join(collectRoot(), kind);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function collectCopy(kind, file, name, tag = '') {
  if (!file || !fs.existsSync(file)) return '';
  const destDir = collectDir(kind);
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const label = [safe(name), tag, stamp].filter(Boolean).join('_');
  const ext = path.extname(file) || '.mp4';
  let dest = path.join(destDir, `${label}${ext}`);
  let n = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(destDir, `${label}_${n}${ext}`);
    n += 1;
  }
  fs.copyFileSync(file, dest);
  return dest;
}

function dir(name, sub = '') {
  const d = path.join(root(), safe(name), sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function listFinished() {
  const dir = path.join(collectRoot(), 'one_mp4');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /\.mp4$/i.test(name))
    .map((name) => {
      const file = path.join(dir, name);
      const st = fs.statSync(file);
      return { name: name.replace(/\.mp4$/i, ''), file, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function list() {
  if (!fs.existsSync(root())) return [];
  return fs
    .readdirSync(root(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root(), e.name, 'project.json')))
    .map((e) => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(root(), e.name, 'project.json'), 'utf8'));
        const exported = p.exported && fs.existsSync(p.exported) ? p.exported : '';
        const source = (p.videos || []).map((v) => v?.file).find((f) => f && fs.existsSync(f)) || '';
        return { name: p.name, updated: p.updated, step: p.step || 1, thumb: p.coverThumb || null, preview: exported || source };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

function save(p) {
  const data = { ...p, updated: new Date().toISOString() };
  fs.writeFileSync(path.join(dir(p.name), 'project.json'), JSON.stringify(data, null, 2));
  return data.updated;
}

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(dir(name), 'project.json'), 'utf8'));
}

module.exports = { root, dir, list, listFinished, save, load, safe, collectRoot, collectDir, collectCopy };
