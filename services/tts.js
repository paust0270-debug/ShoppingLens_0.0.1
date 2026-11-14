const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const { run, checkCancel, trackFetch, releaseFetch } = require('./run');

const SPEED = { slow: 0.85, normal: 1.0, brisk: 1.24, fast: 1.32, faster: 1.42 };
const SAPI_RATE = { slow: -2, normal: 0, brisk: 3, fast: 4, faster: 6 };
const q = (s) => String(s).replace(/'/g, "''");
const OPENAI_VOICES = [
  ['marin', 'Marin (추천)', false],
  ['cedar', 'Cedar (추천)', false],
  ['coral', 'Coral', true],
  ['nova', 'Nova', true],
  ['shimmer', 'Shimmer', true],
  ['sage', 'Sage', true],
  ['alloy', 'Alloy', true],
  ['ash', 'Ash', true],
  ['ballad', 'Ballad', false],
  ['echo', 'Echo', true],
  ['fable', 'Fable', true],
  ['onyx', 'Onyx', true],
  ['verse', 'Verse', false],
];
const TTS1_VOICES = new Set(OPENAI_VOICES.filter((v) => v[2]).map((v) => v[0]));

function openaiSpeechModel(model) {
  return model === 'tts-1' || model === 'tts-1-hd' || model === 'gpt-4o-mini-tts' ? model : 'gpt-4o-mini-tts';
}

const GEMINI_VOICES = [
  ['Kore', 'Kore (단호, 추천)'],
  ['Zephyr', 'Zephyr (밝음)'],
  ['Leda', 'Leda (젊음)'],
  ['Aoede', 'Aoede (산뜻)'],
  ['Sulafat', 'Sulafat (따뜻)'],
  ['Achird', 'Achird (친근)'],
  ['Puck', 'Puck (경쾌)'],
  ['Charon', 'Charon (설명)'],
  ['Fenrir', 'Fenrir (들뜸)'],
  ['Algieba', 'Algieba (부드러움)'],
  ['Gacrux', 'Gacrux (성숙)'],
  ['Schedar', 'Schedar (고름)'],
];
const GEMINI_VOICE_IDS = new Set(GEMINI_VOICES.map((v) => v[0]));
const GEMINI_STYLE = {
  slow: 'speaking slowly, clear',
  normal: 'cheerful and clear',
  brisk: 'speaking quickly, bright and crisp, very short pauses, energetic shopping short narration',
  fast: 'speaking very quickly, tight pauses, energetic',
  faster: 'speaking as fast as still clear, almost no pause, high energy',
};

function geminiSpeechModel(model) {
  return model === 'gemini-3.8-flash-tts' || model === 'gemini-3.8-flash-lite-tts' ? model : 'gemini-3.8-flash-lite-tts';
}

function otherGeminiModel(model) {
  return model === 'gemini-3.8-flash-tts' ? 'gemini-3.8-flash-lite-tts' : 'gemini-3.8-flash-tts';
}

function sleepCancel(ms) {
  return new Promise((resolve, reject) => {
    const step = 400;
    let left = ms;
    const tick = () => {
      try {
        checkCancel();
      } catch (e) {
        reject(e);
        return;
      }
      if (left <= 0) {
        resolve();
        return;
      }
      const n = Math.min(step, left);
      left -= n;
      setTimeout(tick, n);
    };
    tick();
  });
}

async function geminiRequest(apiKey, model, voice, text, speedKey) {
  checkCancel();
  const ctrl = trackFetch();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [{
          type: 'user_input',
          content: [{
            type: 'text',
            text,
            annotations: [{ type: 'speech_metadata', style: GEMINI_STYLE[speedKey] || GEMINI_STYLE.normal }],
          }],
        }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice }] },
      }),
    });
    const body = await res.json().catch(() => ({}));
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    return { res, body, retryAfter };
  } catch (e) {
    if (ctrl.signal.aborted) {
      checkCancel();
      throw new Error('Gemini 음성 응답 시간 초과');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    releaseFetch(ctrl);
  }
}

function pcmToWav(pcm, rate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function geminiAudioBuffer(body) {
  const chunks = [];
  for (const step of body.steps || []) {
    for (const part of step.content || []) {
      if (part?.data && (part.type === 'audio' || String(part.mime_type || part.mimeType || '').startsWith('audio'))) chunks.push(part.data);
    }
  }
  const b64 = chunks.at(-1) || body.output_audio?.data;
  if (!b64) throw new Error('Gemini 음성 응답에 오디오가 없습니다.');
  const buf = Buffer.from(b64, 'base64');
  return buf.length >= 4 && buf.toString('ascii', 0, 4) === 'RIFF' ? buf : pcmToWav(buf);
}

async function voices(provider) {
  const s = settings.get();
  if (provider === 'gemini') {
    if (!s.gemini) throw new Error('Gemini API 키를 설정에서 입력하세요.');
    return GEMINI_VOICES.map(([id, name]) => ({ id, name }));
  }
  if (provider === 'openai') {
    if (!s.openai) throw new Error('OpenAI API 키를 설정에서 입력하세요.');
    return OPENAI_VOICES.map(([id, name, classic]) => ({ id, name, classic }));
  }
  if (provider === 'eleven') {
    if (!s.elevenlabs) throw new Error('ElevenLabs API 키를 설정에서 입력하세요.');
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': s.elevenlabs } });
    const body = await res.json();
    if (!res.ok) throw new Error(`ElevenLabs 오류: ${body.detail?.message || res.status}`);
    return body.voices.map((v) => ({ id: v.voice_id, name: `${v.name}${v.labels?.gender ? ` (${v.labels.gender})` : ''}`, preview: v.preview_url }));
  }
  if (provider === 'typecast') {
    if (!s.typecast) throw new Error('Typecast API 키를 설정에서 입력하세요.');
    const res = await fetch('https://api.typecast.ai/v1/voices', { headers: { 'X-API-KEY': s.typecast } });
    const body = await res.json();
    if (!res.ok) throw new Error(`Typecast 오류: ${body.message || res.status}`);
    const list = Array.isArray(body) ? body : body.voices || body.result || [];
    return list.map((v) => ({
      id: v.voice_id || v.id,
      name: v.voice_name || v.name,
      model: v.model,
      emotions: v.emotions || [],
      lang: v.language || v.lang || v.language_code || '',
      gender: v.gender || '',
    })).filter((v) => v.id);
  }
  const { out } = await run('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture }",
  ]);
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [name, culture] = l.split('|');
      return { id: name.trim(), name: `${name.trim()} (${(culture || '').trim()})`, ko: /ko/i.test(culture || '') };
    })
    .sort((a, b) => Number(b.ko) - Number(a.ko));
}

function pickKoVoice(list) {
  const rows = (list || []).filter((v) => v?.id);
  if (!rows.length) return null;
  const score = (v) => {
    const blob = `${v.name || ''} ${v.lang || ''} ${v.gender || ''}`;
    let n = 0;
    if (/ko|kor|한국/i.test(blob)) n += 6;
    if (/female|여|woman/i.test(blob)) n += 2;
    if (/밝|명랑|cheer|bright|쇼핑|내레/i.test(blob)) n += 1;
    return n;
  };
  return [...rows].sort((a, b) => score(b) - score(a))[0];
}

async function credits(provider) {
  const s = settings.get();
  if (provider === 'eleven' && s.elevenlabs) {
    const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': s.elevenlabs } });
    if (!res.ok) return null;
    const b = await res.json();
    return { used: b.character_count, limit: b.character_limit };
  }
  return null;
}

async function synth(text, opt, outBase) {
  const s = settings.get();
  const speed = SPEED[opt.speed] || 1;
  if (opt.provider === 'gemini') {
    if (!s.gemini) throw new Error('Gemini API 키가 없습니다. 설정에서 입력하세요.');
    const preferred = geminiSpeechModel(opt.model);
    const voice = GEMINI_VOICE_IDS.has(opt.voice) ? opt.voice : 'Kore';
    const order = [preferred, otherGeminiModel(preferred)];
    let lastMsg = 'Gemini 음성 한도를 넘었습니다.';
    for (let round = 0; round < 4; round++) {
      let waitSec = 0;
      for (const model of order) {
        const { res, body, retryAfter } = await geminiRequest(s.gemini, model, voice, text, opt.speed);
        if (res.ok) {
          const out = outBase + '.wav';
          fs.writeFileSync(out, geminiAudioBuffer(body));
          if (Math.abs(speed - 1) <= 0.02) return out;
          const sped = outBase + '_spd.wav';
          await require('./media').scaleAudio(out, sped, speed);
          return sped;
        }
        const msg = body.error?.message || JSON.stringify(body).slice(0, 200);
        const busy = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504 || /high demand|UNAVAILABLE|overloaded/i.test(msg);
        if (!busy) throw new Error(`Gemini 음성 오류 (${res.status}): ${msg}`);
        lastMsg = msg;
        waitSec = Math.max(waitSec, retryAfter || 20);
      }
      const wait = Math.min(Math.max(waitSec, 5), 40);
      if (opt.onWait) opt.onWait(wait);
      await sleepCancel(wait * 1000);
    }
    throw new Error(`Gemini 음성 한도: ${String(lastMsg).slice(0, 180)}`);
  }
  if (opt.provider === 'openai') {
    if (!s.openai) throw new Error('OpenAI API 키가 없습니다. 설정에서 입력하세요.');
    const model = openaiSpeechModel(opt.model);
    let voice = opt.voice || 'marin';
    if (model !== 'gpt-4o-mini-tts' && !TTS1_VOICES.has(voice)) voice = 'nova';
    const body = {
      model,
      input: text,
      voice,
      response_format: 'mp3',
      speed: Math.min(4, Math.max(0.25, speed)),
    };
    if (model === 'gpt-4o-mini-tts') body.instructions = '한국어 쇼핑 쇼츠 내레이션. 밝고 또박또박, 자연스러운 구어체로 읽으세요.';
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.openai}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI 음성 오류 (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const out = outBase + '.mp3';
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    return out;
  }
  if (opt.provider === 'eleven') {
    if (!s.elevenlabs) throw new Error('ElevenLabs API 키가 없습니다.');
    if (!opt.voice) throw new Error('목소리를 선택하세요.');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${opt.voice}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': s.elevenlabs, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: opt.model || 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: Math.min(1.2, Math.max(0.7, speed)) },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs 오류 (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const out = outBase + '.mp3';
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    return out;
  }
  if (opt.provider === 'typecast') {
    if (!s.typecast) throw new Error('Typecast API 키가 없습니다. 설정에서 입력하세요.');
    let voice = opt.voice;
    if (!voice) {
      const picked = pickKoVoice(await voices('typecast'));
      voice = picked?.id || '';
    }
    if (!voice) throw new Error('Typecast 한국어 목소리를 찾지 못했습니다.');
    const res = await fetch('https://api.typecast.ai/v1/text-to-speech', {
      method: 'POST',
      headers: { 'X-API-KEY': s.typecast, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice_id: voice,
        text,
        model: opt.model || 'ssfm-v21',
        language: 'kor',
        prompt: { emotion_preset: opt.emotion || 'normal', emotion_intensity: 1 },
        output: { audio_format: 'mp3', audio_tempo: speed },
      }),
    });
    if (!res.ok) throw new Error(`Typecast 오류 (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const out = outBase + '.mp3';
    const buf = Buffer.from(await res.arrayBuffer());
    const look = buf.slice(0, 8).toString('utf8');
    if (look.startsWith('{')) {
      const j = JSON.parse(buf.toString('utf8'));
      const href = j.audio_download_url || j.result?.audio_url || j.url || j.audio_url;
      if (!href) throw new Error('Typecast 음성 주소를 받지 못했습니다.');
      const audio = await fetch(href);
      if (!audio.ok) throw new Error(`Typecast 음성 받기 실패 (${audio.status})`);
      fs.writeFileSync(out, Buffer.from(await audio.arrayBuffer()));
    } else {
      fs.writeFileSync(out, buf);
    }
    return out;
  }
  const txt = outBase + '.txt';
  const out = outBase + '.wav';
  fs.writeFileSync(txt, text, 'utf8');
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    opt.voice ? `$s.SelectVoice('${q(opt.voice)}')` : "$k = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'ko*' } | Select-Object -First 1; if ($k) { $s.SelectVoice($k.VoiceInfo.Name) }",
    `$s.Rate = ${SAPI_RATE[opt.speed] ?? 0}`,
    `$s.SetOutputToWaveFile('${q(out)}')`,
    `$s.Speak([IO.File]::ReadAllText('${q(txt)}', [Text.Encoding]::UTF8))`,
    '$s.Dispose()',
  ].join('; ');
  await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  fs.rmSync(txt, { force: true });
  return out;
}

module.exports = { voices, credits, synth };
