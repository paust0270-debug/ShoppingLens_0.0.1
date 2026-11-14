const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const { checkCancel, trackFetch, releaseFetch } = require('./run');

async function postJson(url, headers, body, label, ms) {
  checkCancel();
  const ctrl = trackFetch();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    return await readJson(res, label);
  } catch (e) {
    if (ctrl.signal.aborted) {
      checkCancel();
      throw new Error(`${label} 응답 시간 초과`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    releaseFetch(ctrl);
  }
}

function provider() {
  const s = settings.get();
  const order = s.aiProvider === 'openai' ? ['openai', 'gemini'] : ['gemini', 'openai'];
  return order.find((p) => s[p]) || null;
}

const hasAI = () => !!provider();

async function pause(ms) {
  const step = 500;
  let left = ms;
  while (left > 0) {
    checkCancel();
    const n = Math.min(step, left);
    await new Promise((r) => setTimeout(r, n));
    left -= n;
  }
  checkCancel();
}

const geminiBusy = (msg) => /시간 초과|비어|503|429|502|504|UNAVAILABLE|high demand|overloaded/i.test(String(msg));

async function readJson(res, label) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label} 오류 (${res.status}): ${body.error?.message || JSON.stringify(body).slice(0, 200)}`);
  return body;
}

function parseLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('AI 응답을 해석하지 못했습니다.');
  }
}

function asImage(img) {
  if (img && typeof img === 'object') return { mime: img.mime || 'image/jpeg', data: String(img.data || '') };
  return { mime: 'image/jpeg', data: String(img || '') };
}

async function json(system, prompt, images = [], timeout) {
  const s = settings.get();
  const p = provider();
  if (!p) throw new Error('NO_AI_KEY');
  const pics = images.map(asImage).filter((x) => x.data);
  const ms = timeout || (pics.length ? 20000 : 35000);
  if (p === 'openai') {
    const body = await postJson('https://api.openai.com/v1/chat/completions', {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${s.openai}`,
    }, {
      model: s.openaiModel || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.8,
      messages: [
        { role: 'system', content: system + '\n반드시 JSON 객체로만 답하세요.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...pics.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}`, detail: 'low' } })),
          ],
        },
      ],
    }, 'OpenAI', ms);
    return parseLoose(body.choices[0].message.content);
  }
  return geminiJson(s, system, prompt, pics, ms);
}

async function geminiJson(s, system, prompt, images, ms) {
  const preferred = (s.geminiModel === 'gemini-3.8-flash' ? 'gemini-3.5-flash' : s.geminiModel) || 'gemini-3.5-flash';
  const chain = preferred === 'gemini-3.5-flash-lite' ? [preferred] : [preferred, 'gemini-3.5-flash-lite'];
  let last;
  for (let i = 0; i < chain.length; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${chain[i]}:generateContent?key=${s.gemini}`, {
          'Content-Type': 'application/json',
        }, {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }, ...images.map((img) => ({ inline_data: { mime_type: img.mime || 'image/jpeg', data: img.data || img } }))] }],
          generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
        }, 'Gemini', ms);
        const text = (body.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text).join('');
        if (!text) throw new Error('Gemini 응답이 비어 있습니다.');
        return parseLoose(text);
      } catch (e) {
        last = e;
        if (/CANCELLED/.test(String(e.message))) throw e;
        const missing = /404/.test(String(e.message));
        if (missing) break;
        if (!geminiBusy(e.message)) throw e;
        if (attempt === 0) {
          await pause(6000);
          continue;
        }
        break;
      }
    }
  }
  throw last;
}

async function transcribe(file) {
  const s = settings.get();
  const p = provider();
  if (!p) throw new Error('NO_AI_KEY');
  if (p === 'openai') {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
    form.append('model', 'whisper-1');
    form.append('language', 'ko');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${s.openai}` }, body: form });
    return (await readJson(res, 'OpenAI STT')).text || '';
  }
  const model = s.geminiModel || 'gemini-3.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${s.gemini}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: '이 오디오를 한국어로 그대로 받아적어 주세요. 받아쓴 문장만 출력하세요.' }, { inline_data: { mime_type: 'audio/mp3', data: fs.readFileSync(file).toString('base64') } }] }],
    }),
  });
  const body = await readJson(res, 'Gemini STT');
  return (body.candidates?.[0]?.content?.parts || []).map((x) => x.text).join('').trim();
}

const SYSTEM = '당신은 한국 쇼핑 쇼츠(유튜브 쇼츠, 릴스, 틱톡) 전문 기획자이자 카피라이터입니다. 조회수가 터지는 쇼핑 쇼츠의 구조, 후킹, 말투를 정확히 분석하고 재현합니다.';

function analyzeVideo(info, transcriptText) {
  return json(
    SYSTEM,
    `다음 쇼핑 쇼츠를 분석하세요.
제목: ${info.title}
채널: ${info.channel}
조회수: ${info.views}
설명: ${String(info.description).slice(0, 1500)}
대본(자막): ${transcriptText ? transcriptText.slice(0, 4000) : '(자막 없음)'}

다음 JSON 형식으로 답하세요:
{"product":"제품명 (분류)","features":["특징 3개"],"kw":{"ko":["한글 검색어 3개"],"en":["영어 검색어 3개"],"zh":["중국어 검색어 3개"]},"flow":"영상 흐름 (→로 연결)","why":"왜 떴는가","hook":{"visual":"비주얼 훅","ment":"멘트 훅","point":"후킹 포인트"},"cta":"CTA 방식"}`,
  );
}

function analyzeStyle(info, transcriptText) {
  return json(
    SYSTEM,
    `다음 쇼츠의 대본 스타일을 분석해 다른 제품에도 적용할 수 있는 스타일 가이드로 요약하세요.
제목: ${info.title}
영상 길이: ${Math.round(info.dur)}초
대본: ${transcriptText ? transcriptText.slice(0, 4000) : '(자막 없음, 제목과 설명으로 추정)'}
설명: ${String(info.description).slice(0, 800)}

JSON 형식:
{"title":"스타일 이름 (짧게)","summary":{"length":"영상 길이","hook":"첫 훅 유형","speed":"속도·문장 수","flow":"장면 흐름 (→)","tone":"말투","expose":"제품 노출 방식","cta":"행동 유도","guide":"작성 지침"}}`,
  );
}

function narrationSeconds(length) {
  const n = Math.round(Number(length));
  if (!Number.isFinite(n)) return 30;
  return Math.max(25, Math.min(40, n));
}

function script(ctx) {
  const sec = narrationSeconds(ctx.length);
  const lo = Math.round(sec * 6.2);
  const hi = Math.round(sec * 7.4);
  const spoken = Math.round(Number(ctx.spoken) || 0);
  const rewrite = ctx.rewrite
    ? `\n[다시 쓰기]\n이전 대본을 살짝 빠른 속도로 읽으니 ${spoken}초였습니다. 25초보다 짧습니다. 같은 제품 이야기로 장면과 문장을 더해 ${sec}초 안팎, 최소 25초가 되게 다시 쓰세요.\n이전 대본:\n${String(ctx.rewrite).slice(0, 1500)}\n`
    : '';
  return json(
    SYSTEM,
    `아래 정보로 쇼핑 쇼츠 내레이션 대본을 쓰세요.
낭독 시간은 최소 25초, 최대 40초입니다. 목표는 ${sec}초입니다.
읽는 속도는 보통보다 살짝 빠른 쇼츠 말투이고, 1초에 약 7글자입니다.
전체 글자 수는 ${lo}~${hi}자, 문장은 8~14개입니다. 한 문장은 한 장면이며 12~22자로 짧고 리듬감 있게 쓰세요.
첫 낭독(제목 훅)은 프로그램이 따로 붙이니, 대본은 그 다음 장면부터 쓰세요.
스타일 가이드의 길이가 달라도 25~40초를 우선하세요. 25초보다 짧게 끝내지 마세요.
${rewrite}
[제품]
${ctx.product}

[소스 영상 정보]
${ctx.sources || '(없음)'}

[참고 스타일]
${ctx.style}
${ctx.styleTranscript ? `참고 대본 예시: ${ctx.styleTranscript.slice(0, 1500)}` : ''}

[사전 지시]
${ctx.instruction || '(없음)'}

JSON 형식: {"lines":["문장1","문장2", "..."]}`,
  );
}

function labelScenes(images) {
  return json(SYSTEM, `다음 ${images.length}개의 이미지는 한 쇼핑 영상의 장면 순서입니다. 각 장면을 8~14자 한국어로 설명하세요 (예: "제품 외형 클로즈업"). JSON: {"labels":["...", "..."]}`, images);
}

function matchClips(youtube, xhs, images) {
  const yLines = youtube.map((v, i) => `Y${i}: ${String(v.title || '').slice(0, 80)}`).join('\n');
  const xLines = xhs.map((v, i) => `X${i}: ${String(v.title || '').slice(0, 80)}`).join('\n');
  return json(
    '썸네일로 같은 제품 시연인지 판단합니다. 제목만 비슷하고 화면의 제품·손·구도가 다르면 점수를 낮춥니다.',
    `이미지는 순서대로 유튜브 Y0~Y${youtube.length - 1} ${youtube.length}장, 이어서 샤오홍슈 X0~X${xhs.length - 1} ${xhs.length}장입니다.
같은 제품이 거의 같은 구도로 나온 쌍만 고르세요. 번호는 0부터입니다. 최대 6쌍.
유튜브
${yLines}
샤오홍슈
${xLines}
JSON: {"pairs":[{"y":0,"x":1,"score":90,"why":"같은 제품 클로즈업"}]}`,
    images,
    55000,
  );
}

function coupangQuery(title, keyword) {
  return json(
    '샤오홍슈 영상에서 쿠팡에 팔 제품 하나를 고릅니다. 여러 제품을 모아 둔 영상이거나 제품이 특정되지 않으면 specific은 false입니다. 생활용품, 꿀템처럼 범주만 있는 검색어는 제품이 아닙니다.',
    `영상 제목: ${String(title || '').slice(0, 120)}
참고 검색어: ${String(keyword || '').slice(0, 40)}
JSON: {"specific":true,"query":"로션 디스펜서","name":"원터치 로션 디스펜서"}`,
  );
}

function coupangSame(title, name, items) {
  const list = (items || []).slice(0, 8).map((item, i) => `${i}. ${String(item.title || '').slice(0, 80)}`).join('\n');
  return json(
    '쿠팡 상품이 영상 속 제품과 같은 종류인지 판단합니다. 범주만 같고 용도가 다르면 ok는 false입니다. 브랜드는 달라도 형태와 용도가 같으면 ok입니다.',
    `영상 제목: ${String(title || '').slice(0, 120)}
찾을 제품: ${String(name || '').slice(0, 40)}
쿠팡 상품:
${list}
JSON: {"ok":false,"index":0,"why":"같은 제품이 없음"}`,
  );
}

function relatedZh(keyword, used) {
  const skip = (used || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 12);
  return json(
    '1688에서 상품 영상을 찾는 짧은 중국어 간체 검색어만 만듭니다.',
    `원래 검색어와 같은 상품을 1688에서 찾기 위한 다른 검색어 4개를 만드세요.
문장으로 설명하지 말고, 각 2~12자의 상품 검색어로 쓰세요. 이미 검색한 단어는 넣지 마세요.
원래 검색어: ${String(keyword || '').slice(0, 80)}
이미 검색: ${skip.join(' | ') || '(없음)'}
JSON: {"qs":["浴室暖风机","免打孔取暖器","卫生间暖风机","壁挂取暖器"]}`,
  ).then((r) => {
    const list = Array.isArray(r?.qs) ? r.qs : [];
    const seen = new Set(skip);
    const out = [];
    for (const item of list) {
      const s = String(item || '').replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();
      if (!/[\u4e00-\u9fff]/.test(s) || s.length < 2 || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out.slice(0, 4);
  });
}

function translateZh(text) {
  return json(
    '샤오홍슈(小红书)와 도우인 검색용으로, 상품을 찾는 짧은 중국어 간체 검색어만 만듭니다.',
    `다음 검색어를 샤오홍슈에서 관련 영상이 나오게 중국어 간체 키워드로 바꾸세요. 문장으로 설명하지 말고 2~12자 검색어로 줄이세요.
검색어: ${String(text).slice(0, 80)}
JSON: {"q":"厨房好物"}`,
  ).then((r) => String(r.q || '').replace(/[“”"']/g, '').trim());
}

function judgeSource(images) {
  return json(
    '쇼핑 쇼츠 원본을 고릅니다. 화면에 중국어가 씌워진 영상은 탈락입니다. 사람은 있어도 됩니다.',
    `이미지는 상품 영상 장면입니다.
person: 얼굴이나 사람 상반신이 보이면 true. 손만 제품 위에 있는 건 false.
chinese: 화면에 중국어 한자가 자막·제목·워터마크·큰 문구로 씌워져 있으면 true. 상품 포장에만 작게 있는 글자는 false. 한자가 분명하면 true.
ok: chinese가 아니면 true. 사람이 보여도 chinese가 아니면 ok는 true.
JSON: {"ok":true,"person":false,"chinese":false,"why":""}`,
    images,
    18000,
  );
}

function captionBand(images) {
  return json(
    '쇼츠 프레임에서 씌워진 자막(중국어 한자 제목·문구 포함)의 위치만 찾습니다. 상품 포장, 로고, 배경에 원래 있는 글자는 자막이 아닙니다.',
    `이미지 ${images.length}장은 한 영상의 다른 장면입니다. 화면 위에 편집으로 올린 큰 자막이나 중국어 문구가 공통으로 놓인 세로 구간을 화면 높이 대비 비율로 답하세요. 위·가운데·아래 어디든 될 수 있습니다. 맨 위가 0, 맨 아래가 1입니다. 그 자리에 한국어 자막을 덮을 수 있게 구간을 조금 넉넉히 잡으세요. 자막이 없으면 h를 0으로 하세요.
JSON: {"y":0.62,"h":0.08}`,
    images,
  );
}

function matchScenes(lines, sources) {
  return json(
    SYSTEM,
    `대본 문장마다 가장 어울리는 장면을 고르세요. 가능하면 같은 장면을 반복하지 마세요.
[대본]
${lines.map((l, i) => `${i}. ${l}`).join('\n')}
[장면 목록] (src=소스 번호, clip=장면 번호)
${sources.map((s, si) => s.map((label, ci) => `src=${si} clip=${ci}: ${label}`).join('\n')).join('\n')}
JSON: {"matches":[{"line":0,"src":0,"clip":0}]}`,
  );
}

function fixSubtitles(texts) {
  return json('당신은 한국어 교정 전문가입니다.', `다음 자막들의 맞춤법과 띄어쓰기만 고치세요. 개수와 순서를 그대로 유지하세요.\n${JSON.stringify(texts)}\nJSON: {"texts":["..."]}`);
}

function uploadTexts(ctx) {
  return json(
    SYSTEM,
    `다음 쇼핑 쇼츠의 업로드 설명 문구를 3가지 스타일로 쓰세요. 각 문구는 간결하고 세련되게, 해시태그 3~5개 포함.
스타일: 1) 공감 후기형 2) 쿠팡 체크형 (첫 줄에 "이 포스팅은 쿠팡파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다." 포함, ✔ 체크리스트) 3) 호기심형
제품: ${ctx.product}
대본: ${ctx.lines.join(' ')}
${ctx.link ? `구매 링크: ${ctx.link}` : '구매 링크 자리에는 "프로필 링크"라고 쓰세요.'}
JSON: {"title":"쇼츠 제목 (40자 이내)","styles":[{"name":"공감 후기형","text":"..."},{"name":"쿠팡 체크형","text":"..."},{"name":"호기심형","text":"..."}]}`,
  );
}

function lensReport(info, transcriptText, cues = []) {
  const timed = cues.slice(0, 40).map((c) => `${Math.floor(c.t / 60)}:${String(Math.floor(c.t % 60)).padStart(2, '0')} ${c.text}`).join('\n');
  return json(
    SYSTEM,
    `쇼핑 영상을 벤치마크 분석하세요. 자막이 없으면 제목과 설명으로 추정하고, 추정임을 문장 안에 밝히세요.
제목: ${info.title}
채널: ${info.channel}
조회수: ${info.views}
길이: ${Math.round(info.dur || 0)}초
설명: ${String(info.description || '').slice(0, 800)}
자막: ${transcriptText ? transcriptText.slice(0, 4000) : '(없음)'}
시간별 자막:
${timed || '(없음)'}

JSON:
{"points":["제품 장점이나 영상 구성 포인트 4~6개"],"hooks":["초반 후킹 방법 3~5개"],"keywords":["키워드: 이 영상에서 그 단어가 하는 역할"],"timeline":[{"t":"0:00","text":"구간 요약"}],"titles":["벤치마크용 제목 5개"],"ideas":["같은 소재로 만들 쇼츠 아이디어 4개"]}`,
  );
}

function lensScript(ctx) {
  const mode = ctx.mode === 'structure'
    ? '3단 구조(몸통형)로 쓰세요. 1) 문제 제기 2) 제품 시연과 근거 3) 구매 유도. 각 단은 2~4문장.'
    : '원본 쇼츠를 그대로 베끼지 말고, 같은 후킹과 리듬으로 25~40초 분량의 짧은 문장들로 다시 쓰세요. 읽는 속도는 살짝 빠르고, 한 줄이 한 장면입니다.';
  return json(
    SYSTEM,
    `${mode}
제목: ${ctx.title}
채널: ${ctx.channel}
분석 요약: ${ctx.summary || ''}
자막: ${ctx.transcript ? String(ctx.transcript).slice(0, 3000) : '(없음)'}
추가 지시: ${ctx.prompt || '(없음)'}
JSON: {"text":"완성 대본. 줄바꿈으로 문장을 구분"}`,
  );
}

function lensIdeas(topic) {
  return json(
    SYSTEM,
    `다음 소재로 쇼핑 쇼츠 아이디어와 제목을 제안하세요.
소재: ${topic}
JSON: {"ideas":["아이디어 5개"],"titles":["제목 5개"]}`,
  );
}

module.exports = { hasAI, provider, json, transcribe, analyzeVideo, analyzeStyle, script, labelScenes, captionBand, judgeSource, translateZh, relatedZh, coupangQuery, coupangSame, matchClips, matchScenes, fixSubtitles, uploadTexts, lensReport, lensScript, lensIdeas };
