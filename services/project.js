const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const root = () => path.join(app.getPath('documents'), 'ShoppingLens');
const safe = (n) => String(n || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'untitled';

function dir(name, sub = '') {
  const d = path.join(root(), safe(name), sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function list() {
  if (!fs.existsSync(root())) return [];
  return fs
    .readdirSync(root(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root(), e.name, 'project.json')))
    .map((e) => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(root(), e.name, 'project.json'), 'utf8'));
        return { name: p.name, updated: p.updated, step: p.step || 1, thumb: p.coverThumb || null };
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

module.exports = { root, dir, list, save, load, safe };
