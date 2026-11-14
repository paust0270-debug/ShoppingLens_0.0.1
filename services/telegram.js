const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const MAX_BYTES = 49 * 1024 * 1024;

function token() {
  const value = String(settings.get().tgToken || '').trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(value)) {
    throw new Error('설정에서 텔레그램 봇 토큰을 넣고 연결하세요.');
  }
  return value;
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const desc = String(data.description || '');
    if (/unauthorized/i.test(desc) || res.status === 401) throw new Error('텔레그램 봇 토큰이 올바르지 않습니다.');
    throw new Error(desc || `텔레그램 오류 (${res.status})`);
  }
  return data.result;
}

async function latestPrivateChat() {
  let offset = 0;
  let chat = null;
  for (let i = 0; i < 10; i++) {
    const updates = await call('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] });
    if (!updates.length) break;
    for (const update of updates) {
      offset = update.update_id + 1;
      const next = update.message?.chat;
      if (next?.type === 'private') chat = next;
    }
  }
  if (offset) await call('getUpdates', { offset, timeout: 0 }).catch(() => {});
  return chat;
}

async function connect() {
  const me = await call('getMe');
  const bot = me.username || '';
  settings.set({ tgBot: bot });
  const chat = await latestPrivateChat();
  if (!chat) {
    return { ok: false, bot, url: bot ? `https://t.me/${bot}` : '' };
  }
  const name = chat.first_name || chat.username || '나';
  settings.set({ tgBot: bot, tgChat: String(chat.id), tgChatName: name });
  return { ok: true, bot, name };
}

async function sendVideo(file, caption) {
  if (!file || !fs.existsSync(file)) throw new Error('보낼 영상 파일을 찾지 못했습니다.');
  const size = fs.statSync(file).size;
  if (size > MAX_BYTES) throw new Error('텔레그램 봇은 50MB보다 작은 영상만 보낼 수 있습니다.');
  if (!settings.get().tgChat) {
    const linked = await connect();
    if (!linked.ok) {
      throw new Error(linked.bot
        ? `텔레그램에서 @${linked.bot} 대화를 열고 시작을 누른 뒤, 설정에서 다시 연결하세요.`
        : '설정에서 텔레그램 봇 토큰을 넣고 연결하세요.');
    }
  }
  const chatId = settings.get().tgChat;
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', String(caption || path.basename(file, path.extname(file))).slice(0, 1024));
  form.append('supports_streaming', 'true');
  form.append('video', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), 'video.mp4');
  const res = await fetch(`https://api.telegram.org/bot${token()}/sendVideo`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const desc = String(data.description || '');
    if (/chat not found/i.test(desc)) throw new Error('텔레그램 대화가 없습니다. 설정에서 봇 연결을 다시 하세요.');
    if (/unauthorized/i.test(desc) || res.status === 401) throw new Error('텔레그램 봇 토큰이 올바르지 않습니다.');
    throw new Error(desc || `텔레그램 전송 오류 (${res.status})`);
  }
  return { ok: true, bot: settings.get().tgBot || '' };
}

module.exports = { connect, sendVideo };
