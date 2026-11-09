const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const BANK = JSON.parse(fs.readFileSync(path.join(__dirname, 'hookBank.json'), 'utf8'));
const FALLBACK = '일본 천재가 개발해 떼돈 번 제품';
const GROUPS = BANK.groups || [];
const KITCHEN = /주방|요리|조리|설거지|냉장고|냄비|국자|도마|밥|쌀|커피|컵|팬|후라이|주걱|김치|두부/;
const ORGANIZE = /정리|수납|청소|선반|후크|옷걸이|먼지|틈새|보관|바구니|행거|옷장/;

const compact = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

function allBank() {
  return GROUPS.flatMap((g) => (g.items || []).map((text) => ({ text, group: g.id, name: g.name, learned: false })));
}

function learnedList() {
  return (settings.get().hookLearned || []).map((text) => ({ text, group: 'learned', name: '학습', learned: true }));
}

function usedSet() {
  return new Set((settings.get().hookUsed || []).map(compact).filter(Boolean));
}

function guessGroup(product) {
  const t = String(product || '');
  if (KITCHEN.test(t)) return 'kitchen';
  if (ORGANIZE.test(t)) return 'organize';
  return '';
}

function pool(category, product) {
  const cat = category && category !== 'auto' && category !== 'all' ? category : guessGroup(product);
  const bank = allBank();
  const extra = learnedList();
  if (!cat) return [...bank, ...extra];
  return [...bank.filter((x) => x.group === cat), ...extra];
}

function overlap(a, b) {
  const x = compact(a);
  const y = compact(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length > 8 && y.length > 8 && (x.includes(y) || y.includes(x))) return true;
  return false;
}

function taken() {
  return [...allBank(), ...learnedList()].map((x) => x.text).concat(settings.get().hookUsed || []);
}

function pickUnused(category, product) {
  const used = usedSet();
  const open = pool(category, product).filter((x) => !used.has(compact(x.text)));
  if (!open.length) return null;
  return open[Math.floor(Math.random() * open.length)];
}

function remember(text, learned) {
  const s = settings.get();
  const used = s.hookUsed || [];
  const key = compact(text);
  if (key && !used.some((u) => compact(u) === key)) used.push(text);
  const learnedList = s.hookLearned || [];
  if (learned && key && !learnedList.some((u) => compact(u) === key)) learnedList.push(text);
  settings.set({ hookUsed: used.slice(-800), hookLearned: learnedList.slice(-400) });
}

async function invent(product, category) {
  const ai = require('./ai');
  if (!ai.hasAI()) return null;
  const group = GROUPS.find((g) => g.id === (category && category !== 'auto' && category !== 'all' ? category : guessGroup(product))) || GROUPS[Math.floor(Math.random() * GROUPS.length)];
  const samples = (group.items || []).slice().sort(() => Math.random() - 0.5).slice(0, 8);
  const banned = taken().slice(-60);
  const r = await ai.json(
    '꿀템나라 쇼츠 제목 훅을 만듭니다. 존댓말 한 문장, 제품명을 넣지 않습니다.',
    `아래 예시를 응용하되 같은 문장·같은 뜻은 쓰지 마세요. 18~34자, 마침표나 물음표로 끝내세요.
카테고리: ${group.name}
제품 힌트: ${String(product || '').slice(0, 80) || '(일반 생활템)'}
예시:
${samples.map((t, i) => `${i + 1}. ${t}`).join('\n')}
이미 쓴 훅(반복 금지):
${banned.slice(-30).map((t) => `- ${t}`).join('\n')}
JSON: {"text":"한 문장 훅"}`,
  );
  const text = String(r.text || '').replace(/\s+/g, ' ').trim();
  if (text.length < 10 || text.length > 42) return null;
  if (taken().some((t) => overlap(t, text))) return null;
  return { text, group: group.id, name: group.name, learned: true };
}

function defaults() {
  const s = settings.get();
  const cfg = {
    hookAuto: s.hookAuto === 'off' ? 'off' : 'on',
    hookStyle: s.hookStyle || 'both',
    hookCategory: s.hookCategory || 'auto',
  };
  if (s.hookAuto == null || s.hookStyle == null || s.hookCategory == null) {
    settings.set(cfg);
  }
  return cfg;
}

function status() {
  const cfg = defaults();
  const used = usedSet();
  const bank = allBank();
  return {
    ...cfg,
    groups: GROUPS.map((g) => ({ id: g.id, name: g.name, count: (g.items || []).length })),
    bank: bank.length,
    used: used.size,
    left: bank.filter((x) => !used.has(compact(x.text))).length,
    learned: (settings.get().hookLearned || []).length,
  };
}

async function next(input = {}) {
  const cfg = defaults();
  const product = String(input.product || '').trim();
  const category = input.category || cfg.hookCategory;
  if (cfg.hookAuto === 'off') return { text: FALLBACK, source: 'off', group: '' };

  const style = cfg.hookStyle || 'both';
  if (style !== 'learn') {
    const hit = pickUnused(category, product);
    if (hit) {
      remember(hit.text, false);
      return { text: hit.text, source: hit.learned ? 'learned' : 'bank', group: hit.group, name: hit.name };
    }
    if (style === 'rotate') {
      const any = pool(category, product);
      const pick = any[Math.floor(Math.random() * Math.max(1, any.length))];
      if (pick) {
        remember(pick.text, false);
        return { text: pick.text, source: 'repeat', group: pick.group, name: pick.name };
      }
    }
  }

  for (let i = 0; i < 3; i++) {
    try {
      const made = await invent(product, category);
      if (made) {
        remember(made.text, true);
        return { text: made.text, source: 'learn', group: made.group, name: made.name };
      }
    } catch (e) {
      if (/CANCELLED/.test(String(e.message))) throw e;
    }
  }
  const hit = pickUnused('all', product) || allBank()[0];
  if (hit) remember(hit.text, false);
  return { text: (hit && hit.text) || FALLBACK, source: 'fallback', group: (hit && hit.group) || '' };
}

function resetUsed() {
  settings.set({ hookUsed: [] });
  return status();
}

module.exports = { next, status, resetUsed, defaults, FALLBACK };
