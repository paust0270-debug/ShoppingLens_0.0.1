const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { app, session } = require('electron');

const CHROME_BASE = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
const LOCAL_STATE = path.join(CHROME_BASE, 'Local State');
const COOKIE_DB = path.join(CHROME_BASE, 'Default', 'Network', 'Cookies');

const DOMAINS = [
  'xiaohongshu.com', '.xiaohongshu.com',
  'xhscdn.com', '.xhscdn.com',
  'rednote.com', '.rednote.com',
  'douyin.com', '.douyin.com',
  'tiktok.com', '.tiktok.com',
  'taobao.com', '.taobao.com',
  'tmall.com', '.tmall.com',
  '1688.com', '.1688.com',
  'alicdn.com', '.alicdn.com',
  'aliyun.com', '.aliyun.com',
];

let aesKey = null;

function getAesKey() {
  if (aesKey) return aesKey;
  const state = JSON.parse(fs.readFileSync(LOCAL_STATE, 'utf8'));
  const encKeyB64 = state.os_crypt.encrypted_key;
  const encKeyRaw = Buffer.from(encKeyB64, 'base64');
  const dpapiBlob = encKeyRaw.slice(5);
  const b64 = dpapiBlob.toString('base64');
  const ps = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64}'), $null, 'CurrentUser'))`;
  const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8', timeout: 10000 }).trim();
  aesKey = Buffer.from(out, 'base64');
  return aesKey;
}

function decryptValue(encBuf) {
  if (!encBuf || encBuf.length < 15) return '';
  const prefix = encBuf.slice(0, 3).toString('ascii');
  if (prefix !== 'v10' && prefix !== 'v20') {
    return encBuf.toString('utf8');
  }
  const key = getAesKey();
  const nonce = encBuf.slice(3, 15);
  const cipherAndTag = encBuf.slice(15);
  if (cipherAndTag.length < 16) return '';
  const tag = cipherAndTag.slice(cipherAndTag.length - 16);
  const cipher = cipherAndTag.slice(0, cipherAndTag.length - 16);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  dec.setAuthTag(tag);
  let val = dec.update(cipher, null, 'utf8');
  val += dec.final('utf8');
  return val;
}

async function importToPartition(partition) {
  if (!fs.existsSync(COOKIE_DB)) throw new Error('Chrome 쿠키 DB를 찾을 수 없습니다.');
  const tmpDir = path.join(app.getPath('temp'), 'shoppinglens');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpDb = path.join(tmpDir, 'chrome_cookies_tmp');
  fs.copyFileSync(COOKIE_DB, tmpDb);

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(tmpDb);
  const db = new SQL.Database(buf);

  const placeholders = DOMAINS.map(() => '?').join(',');
  const stmt = db.prepare(`SELECT host_key, name, path, encrypted_value, is_secure, is_httponly, expires_utc, samesite FROM cookies WHERE host_key IN (${placeholders})`);
  stmt.bind(DOMAINS);

  const ses = session.fromPartition(partition);
  let count = 0;
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const domain = row.host_key;
    const name = row.name;
    const cookiePath = row.path || '/';
    const secure = !!row.is_secure;
    const httpOnly = !!row.is_httponly;
    const sameSite = row.samesite === 1 ? 'lax' : row.samesite === 2 ? 'strict' : 'no_restriction';
    let expirationDate;
    if (row.expires_utc && row.expires_utc > 0) {
      expirationDate = (Number(row.expires_utc) / 1000000) - 11644473600;
    }

    let value = '';
    try {
      const encBuf = Buffer.isBuffer(row.encrypted_value) ? row.encrypted_value : Buffer.from(row.encrypted_value);
      value = decryptValue(encBuf);
    } catch {
      continue;
    }
    if (!value) continue;

    const url = `http${secure ? 's' : ''}://${domain.replace(/^\./, '')}${cookiePath}`;
    const cookie = { url, name, value, domain, path: cookiePath, secure, httpOnly, sameSite };
    if (expirationDate && expirationDate > Date.now() / 1000) cookie.expirationDate = expirationDate;
    try {
      await ses.cookies.set(cookie);
      count++;
    } catch {
      // skip invalid cookies
    }
  }
  stmt.free();
  db.close();
  try { fs.unlinkSync(tmpDb); } catch {}
  return count;
}

async function writeCookieFile() {
  if (!fs.existsSync(COOKIE_DB)) return '';
  const tmpDir = path.join(app.getPath('temp'), 'shoppinglens');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpDb = path.join(tmpDir, 'chrome_cookies_tmp2');
  fs.copyFileSync(COOKIE_DB, tmpDb);

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(tmpDb);
  const db = new SQL.Database(buf);

  const placeholders = DOMAINS.map(() => '?').join(',');
  const stmt = db.prepare(`SELECT host_key, name, path, encrypted_value, is_secure, expires_utc FROM cookies WHERE host_key IN (${placeholders})`);
  stmt.bind(DOMAINS);

  const lines = ['# Netscape HTTP Cookie File', ''];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    let value = '';
    try {
      const encBuf = Buffer.isBuffer(row.encrypted_value) ? row.encrypted_value : Buffer.from(row.encrypted_value);
      value = decryptValue(encBuf);
    } catch { continue; }
    if (!value) continue;
    const domain = row.host_key;
    const sub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    let exp = Math.floor(Date.now() / 1000 + 86400 * 7);
    if (row.expires_utc && row.expires_utc > 0) exp = Math.floor((Number(row.expires_utc) / 1000000) - 11644473600);
    lines.push([domain, sub, row.path || '/', row.is_secure ? 'TRUE' : 'FALSE', String(exp), row.name, value].join('\t'));
  }
  stmt.free();
  db.close();
  try { fs.unlinkSync(tmpDb); } catch {}

  const file = path.join(tmpDir, 'chrome-cookies.txt');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

async function readCookies() {
  if (!fs.existsSync(COOKIE_DB)) return [];
  const tmpDir = path.join(app.getPath('temp'), 'shoppinglens');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpDb = path.join(tmpDir, 'chrome_cookies_tmp3');
  fs.copyFileSync(COOKIE_DB, tmpDb);

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(tmpDb);
  const db = new SQL.Database(buf);

  const placeholders = DOMAINS.map(() => '?').join(',');
  const stmt = db.prepare(`SELECT host_key, name, path, encrypted_value, is_secure, is_httponly, expires_utc, samesite FROM cookies WHERE host_key IN (${placeholders})`);
  stmt.bind(DOMAINS);

  const out = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    let value = '';
    try {
      const encBuf = Buffer.isBuffer(row.encrypted_value) ? row.encrypted_value : Buffer.from(row.encrypted_value);
      value = decryptValue(encBuf);
    } catch { continue; }
    if (!value) continue;
    const domain = row.host_key;
    const secure = !!row.is_secure;
    const httpOnly = !!row.is_httponly;
    const sameSite = row.samesite === 1 ? 'Lax' : row.samesite === 2 ? 'Strict' : 'None';
    let expires = -1;
    if (row.expires_utc && row.expires_utc > 0) expires = (Number(row.expires_utc) / 1000000) - 11644473600;
    out.push({ name: row.name, value, domain, path: row.path || '/', secure, httpOnly, sameSite, expires });
  }
  stmt.free();
  db.close();
  try { fs.unlinkSync(tmpDb); } catch {}
  return out;
}

module.exports = { importToPartition, writeCookieFile, readCookies };
