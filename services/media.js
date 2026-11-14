const fs = require('fs');
const path = require('path');
const { run, checkCancel } = require('./run');
const tools = require('./tools');

const ff = (args, opts) => {
  tools.ensureReady();
  return run(tools.paths().ffmpeg, ['-hide_banner', ...args], opts);
};

function serviceFile(name) {
  return path.join(__dirname, name).replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

async function probe(file) {
  tools.ensureReady();
  const { out } = await run(tools.paths().ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]);
  const d = JSON.parse(out);
  const v = (d.streams || []).find((s) => s.codec_type === 'video') || {};
  return {
    dur: Number(d.format?.duration) || 0,
    hasAudio: (d.streams || []).some((s) => s.codec_type === 'audio'),
    width: v.width || 0,
    height: v.height || 0,
  };
}

function frame(file, t, out, width = 240) {
  return ff(['-y', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out]).then(() => out);
}

async function frameFromUrl(url, out, referer) {
  tools.ensureReady();
  const headers = `Referer: ${referer || 'https://www.1688.com/'}\r\nUser-Agent: Mozilla/5.0\r\n`;
  await run(tools.paths().ffmpeg, [
    '-hide_banner', '-y',
    '-headers', headers,
    '-ss', '0.5', '-i', url,
    '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', out,
  ], { timeout: 20000 });
  return out;
}

const timeOf = (l) => {
  const m = l.match(/time=(\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
};

async function parallel(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

async function detectScenes(file, outDir, prefix, onProgress) {
  fs.mkdirSync(outDir, { recursive: true });
  const { dur } = await probe(file);
  const cuts = [];
  await ff(['-i', file, '-vf', "scale=320:-2,select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], {
    onLine: (l) => {
      const m = l.match(/pts_time:([\d.]+)/);
      if (m) cuts.push(Number(m[1]));
      const t = timeOf(l);
      if (t != null && dur && onProgress) onProgress(Math.min(1, t / dur) * 0.6);
    },
  });
  const bounds = [0, ...cuts.filter((t) => t > 0.3 && t < dur - 0.3), dur];
  const merged = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const seg = [bounds[i], bounds[i + 1]];
    if (merged.length && seg[1] - seg[0] < 0.7) merged[merged.length - 1][1] = seg[1];
    else merged.push(seg);
  }
  const scenes = [];
  for (const [a, b] of merged) {
    const n = Math.max(1, Math.round((b - a) / 3));
    const step = (b - a) / n;
    for (let k = 0; k < n; k++) scenes.push({ start: a + k * step, end: a + (k + 1) * step });
  }
  const list = scenes.slice(0, 30);
  let done = 0;
  await parallel(list, 4, async (s, i) => {
    checkCancel();
    s.dur = +(s.end - s.start).toFixed(2);
    s.thumb = await frame(file, (s.start + s.end) / 2, path.join(outDir, `${prefix}_${i}.jpg`), 200);
    done++;
    if (onProgress) onProgress(0.6 + (done / list.length) * 0.4);
  });
  return list;
}

const SILENCE = { light: 0.5, normal: 0.3, strong: 0.15 };

async function toWav(input, out, silence = 'none') {
  const af = ['aresample=44100'];
  if (SILENCE[silence]) {
    af.unshift(`silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=${SILENCE[silence]}:stop_threshold=-45dB:stop_silence=0.05`);
    af.push('apad=pad_dur=0.08');
  }
  await ff(['-y', '-i', input, '-af', af.join(','), '-ac', '2', out]);
  return out;
}

function atempoChain(factor) {
  const parts = [];
  let f = Math.max(0.5, Math.min(4, Number(factor) || 1));
  while (f > 2) {
    parts.push('atempo=2');
    f /= 2;
  }
  while (f < 0.5) {
    parts.push('atempo=0.5');
    f /= 0.5;
  }
  parts.push(`atempo=${f.toFixed(4)}`);
  return parts.join(',');
}

async function scaleAudio(input, out, factor) {
  await ff(['-y', '-i', input, '-filter:a', atempoChain(factor), '-ar', '44100', '-ac', '2', out]);
  return out;
}

async function concatAudio(files, out) {
  const args = ['-y'];
  files.forEach((f) => args.push('-i', f));
  const fc = files.map((_, i) => `[${i}:a]`).join('') + `concat=n=${files.length}:v=0:a=1[a]`;
  await ff([...args, '-filter_complex', fc, '-map', '[a]', '-ar', '44100', '-ac', '2', out]);
  return out;
}

function assTime(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function assColor(hex, alpha = 0) {
  const h = String(hex || '#ffffff').replace('#', '').padEnd(6, 'f');
  return `&H${alpha.toString(16).padStart(2, '0')}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

const assText = (s) => String(s).replace(/[{}]/g, '').replace(/\n/g, '\\N');

function randomHeadStat() {
  const views = 200 + Math.floor(Math.random() * 301);
  const comments = 300 + Math.floor(Math.random() * 601);
  return `조회수 ${views}만 | 댓글 ${comments}개`;
}

function reelTitle(text) {
  const s = String(text || '일본 천재가 개발해 떼돈 번 제품').replace(/\s+/g, ' ').trim();
  if (s.includes('\n') || [...s].length <= 14) return s;
  const mid = Math.ceil([...s].length / 2);
  const cut = s.lastIndexOf(' ', mid + 2);
  return cut > 3 ? `${s.slice(0, cut)}\n${s.slice(cut + 1)}` : s;
}

function buildAss({ subs, edit, header, total }) {
  const font = edit.font || 'Malgun Gothic';
  const outline = (edit.border || edit.captionCover || edit.bg) ? 8 : 0;
  const style = (name, size, color, bold, italic, align) =>
    `Style: ${name},${font},${size},${color},&H00FFFFFF,&H00000000,&HFF000000,${bold ? -1 : 0},${italic ? -1 : 0},0,0,100,100,0,0,1,${name === 'Sub' ? outline : 0},0,${align},40,40,0,1`;
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Sub', edit.size || 85, '&H00FFFFFF', true, !!edit.italic, 5),
    style('HeadK', 62, '&H00FFFFFF', true, true, 8),
    style('HeadT', 84, assColor(header?.color || '#f5c64a'), true, false, 8),
    style('Ad', 34, '&H00FFFFFF', true, false, 9),
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const adY = header?.look === 'reel' ? 470 : 42;
  lines.push(`Dialogue: 3,${assTime(0)},${assTime(total)},Ad,,0,0,0,,{\\an9\\pos(1044,${adY})\\fs34\\bord2\\shad0}[광고]`);
  if (header?.look === 'reel' && header?.show) {
    const channel = assText(String(header.top || '꿀템나라').replace(/\s+/g, '').split('').join(' '));
    const title = assText(reelTitle(header.title));
    const stat = assText(header.stat || randomHeadStat());
    lines.push(`Dialogue: 4,${assTime(0)},${assTime(total)},HeadK,,0,0,0,,{\\an5\\pos(90,78)\\fs42\\b1\\i0\\bord0\\shad0\\c&H00FFFFFF&}≡`);
    lines.push(`Dialogue: 4,${assTime(0)},${assTime(total)},HeadK,,0,0,0,,{\\an5\\pos(540,78)\\fs46\\b1\\i0\\bord0\\shad0\\c&H00FFFFFF&}${channel}`);
    lines.push(`Dialogue: 4,${assTime(0)},${assTime(total)},HeadK,,0,0,0,,{\\an5\\pos(990,78)\\fs46\\b1\\i0\\bord0\\shad0\\c&H00FFFFFF&}⌕`);
    lines.push(`Dialogue: 4,${assTime(0)},${assTime(total)},HeadT,,0,0,0,,{\\an5\\pos(540,255)\\fs52\\b1\\i0\\bord0\\shad0\\c&H00FFFFFF&}${title}`);
    lines.push(`Dialogue: 4,${assTime(0)},${assTime(total)},HeadK,,0,0,0,,{\\an5\\pos(540,352)\\fs32\\b0\\i0\\bord0\\shad0\\c&H00D0D0D0&}${stat}`);
  } else if (header?.show) {
    const phone = header.frame === 'phone';
    const topY = phone ? 118 : (header.look === 'mint' ? 150 : 70);
    const titleY = phone ? 210 : (header.look === 'mint' ? 250 : header.look === 'hook' ? 160 : 150);
    if (header.top) lines.push(`Dialogue: 0,${assTime(0)},${assTime(total)},HeadK,,0,0,0,,{\\pos(540,${topY})}${assText(header.top)}`);
    if (header.title) lines.push(`Dialogue: 0,${assTime(0)},${assTime(total)},HeadT,,0,0,0,,{\\pos(540,${titleY})}${assText(header.title)}`);
  }
  const subY = Number.isFinite(Number(edit.subY))
    ? Math.max(120, Math.min(1800, Math.round(Number(edit.subY))))
    : ({ pill: 1360, fade: 1420, glass: 1380, ticker: 1560, soft: 1400, film: 960, polaroid: 1480, pastel: 1460, reel: 1375 }[header?.look] || 1375);
  for (const s of subs || []) {
    const y = Number.isFinite(Number(s.y)) ? Math.max(120, Math.min(1800, Math.round(Number(s.y)))) : subY;
    lines.push(`Dialogue: 1,${assTime(s.start)},${assTime(s.end)},Sub,,0,0,0,,{\\an5\\pos(540,${y})\\bord${outline}\\shad0\\blur0\\be0\\3c&H000000&\\3a&H00&\\4a&HFF&}${assText(s.text)}`);
  }
  for (const o of edit.overlays || []) {
    if (o.kind !== 'text' || !o.text) continue;
    const x = Math.round(((o.x ?? 50) / 100) * 1080);
    const y = Math.round(((o.y ?? 50) / 100) * 1920);
    const aa = Math.round((1 - (o.opacity ?? 100) / 100) * 255).toString(16).padStart(2, '0');
    const tags = [
      `\\pos(${x},${y})`, `\\an5`, `\\fs${o.size || 72}`, `\\1a&H${aa}&`, `\\c${assColor(o.color || '#ffffff')}`,
      o.bold ? '\\b1' : '\\b0', o.italic ? '\\i1' : '\\i0', o.outline ? '\\bord4' : '\\bord0',
      o.shadow ? '\\shad2\\4c&H000000&\\4a&H00&' : '\\shad0\\4a&HFF&', '\\blur0',
    ].join('');
    lines.push(`Dialogue: 2,${assTime(0)},${assTime(total)},Sub,,0,0,0,,{${tags}}${assText(o.text)}`);
  }
  return lines.join('\n');
}

const FILTERS = {
  sharp: 'unsharp=5:5:1.0',
  warm: 'colorbalance=rs=.08:gs=.02:bs=-.08',
  cool: 'colorbalance=rs=-.08:bs=.08',
  vintage: 'curves=preset=vintage',
  mono: 'hue=s=0',
};

const AUTO_EFFECTS = ['zoom', 'pan', 'float', 'combo', 'mirror'];

function segmentFilter(dur, edit, index) {
  let effect = edit.effect;
  if (effect === 'auto') effect = AUTO_EFFECTS[index % AUTO_EFFECTS.length];
  const base = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30';
  const big = 'scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,setsar=1,fps=30';
  let vf = base;
  if (effect === 'shake') vf = "scale=1140:2026:force_original_aspect_ratio=increase,crop=1140:2026,crop=1080:1920:x='30+14*sin(n*1.3)':y='53+14*cos(n*1.7)',setsar=1,fps=30";
  else if (effect === 'pan') vf = `${big},crop=1080:1920:x='270+230*sin(n/26)':y='480+380*sin(n/40)'`;
  else if (effect === 'float') vf = `${big},crop=1080:1920:x='270+64*sin(n/52)':y='480+46*cos(n/68)'`;
  else if (effect === 'zoom') vf = `${base},zoompan=z='1.04+0.16*abs(sin(PI*on/75))':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`;
  else if (effect === 'combo') vf = `${base},zoompan=z='1.1+0.1*abs(sin(PI*on/70))':d=1:x='iw/2-(iw/zoom/2)+70*sin(on/20)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`;
  if (effect === 'mirror') vf += ',hflip';
  if (FILTERS[edit.filter]) vf += ',' + FILTERS[edit.filter];
  if (edit.transition) vf += `,fade=t=in:st=0:d=0.12,fade=t=out:st=${Math.max(0, dur - 0.12).toFixed(2)}:d=0.12`;
  if (effect === 'flash') vf += ',fade=t=in:st=0:d=0.2:color=white';
  return vf;
}

function ffColor(hex, opacity = 100) {
  const h = String(hex || '#000000').replace('#', '').padEnd(6, '0');
  return `0x${h}@${Math.max(0, Math.min(1, (opacity ?? 100) / 100)).toFixed(2)}`;
}

function lookFilters(look, onCaption) {
  const pad = {
    polaroid: 'scale=940:1560:force_original_aspect_ratio=increase,crop=940:1560,pad=1080:1920:70:120:0xF7F4EF',
    pastel: 'scale=960:1640:force_original_aspect_ratio=increase,crop=960:1640,pad=1080:1920:60:100:0xFFF1E6',
    mag: 'scale=860:1920:force_original_aspect_ratio=increase,crop=860:1920,pad=1080:1920:110:0:0xF4EFE6',
  }[look];
  const boxes = {
    mint: ['drawbox=x=0:y=0:w=iw:h=420:color=black@0.92:t=fill', 'drawbox=x=0:y=420:w=iw:h=10:color=0x7DF9FD:t=fill'],
    hook: ['drawbox=x=0:y=0:w=iw:h=320:color=black@0.9:t=fill', 'drawbox=x=0:y=320:w=iw:h=8:color=0xFFE14A:t=fill'],
    pill: ['drawbox=x=80:y=1260:w=iw-160:h=170:color=black@0.78:t=fill'],
    fade: [
      'drawbox=x=0:y=ih-560:w=iw:h=140:color=black@0.16:t=fill',
      'drawbox=x=0:y=ih-420:w=iw:h=140:color=black@0.32:t=fill',
      'drawbox=x=0:y=ih-280:w=iw:h=140:color=black@0.5:t=fill',
      'drawbox=x=0:y=ih-140:w=iw:h=140:color=black@0.7:t=fill',
    ],
    glass: ['drawbox=x=70:y=1240:w=iw-140:h=240:color=white@0.22:t=fill', 'drawbox=x=70:y=1240:w=iw-140:h=240:color=white@0.85:t=3'],
    neon: ['drawbox=x=28:y=28:w=iw-56:h=ih-56:color=0x7DF9FD@0.95:t=8'],
    film: ['drawbox=x=0:y=0:w=iw:h=110:color=black:t=fill', 'drawbox=x=0:y=ih-110:w=iw:h=110:color=black:t=fill'],
    ticker: ['drawbox=x=0:y=1480:w=iw:h=110:color=0xE11D48:t=fill'],
    badge: ['drawbox=x=40:y=48:w=200:h=78:color=0xFF5A36:t=fill'],
    reel: [
      'drawbox=x=0:y=0:w=iw:h=156:color=0x2E2E2E:t=fill',
      'drawbox=x=0:y=156:w=iw:h=230:color=0x3A3A3A:t=fill',
    ],
    soft: [
      'drawbox=x=0:y=ih-480:w=iw:h=160:color=0xFFF4EC@0.28:t=fill',
      'drawbox=x=0:y=ih-320:w=iw:h=160:color=0xFFF4EC@0.48:t=fill',
      'drawbox=x=0:y=ih-160:w=iw:h=160:color=0xFFF4EC@0.66:t=fill',
    ],
  }[look] || [];
  const plate = onCaption && ['pill', 'glass', 'ticker', 'fade', 'soft'].includes(look);
  const drawn = plate ? [] : boxes;
  return pad ? [pad, ...drawn] : drawn;
}

function visualFilters(edit = {}, header) {
  const parts = [];
  if (header?.frame !== 'phone' && edit.topBox?.on && edit.topBox.zoom && edit.topBox.zoom !== 50) {
    const s = (0.85 + (edit.topBox.zoom / 100) * 0.5).toFixed(3);
    parts.push(edit.topBox.zoom >= 50
      ? `scale=iw*${s}:ih*${s},crop=1080:1920`
      : `scale=iw*${s}:ih*${s},pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`);
  }
  if (header?.frame === 'phone') {
    const framed = frameFilter(header);
    if (framed) parts.push(framed);
  } else {
    parts.push(...lookFilters(header?.look, edit.captionCover));
    if (edit.topBox?.on) {
      const h = Math.max(40, Math.round(1920 * (edit.topBox.height || 18) / 100));
      parts.push(`drawbox=x=0:y=0:w=iw:h=${h}:color=${ffColor(edit.topBox.color, edit.topBox.opacity)}:t=fill`);
    } else if (header?.show && !header?.look) {
      parts.push('drawbox=x=0:y=0:w=iw:h=250:color=black@0.85:t=fill');
    }
  }
  if (edit.bottomBox?.on) {
    const h = Math.max(40, Math.round(1920 * (edit.bottomBox.height || 22) / 100));
    parts.push(`drawbox=x=0:y=ih-${h}:w=iw:h=${h}:color=${ffColor(edit.bottomBox.color, edit.bottomBox.opacity)}:t=fill`);
  }
  for (const o of edit.overlays || []) {
    if (o.kind !== 'shape') continue;
    const w = Math.round(((o.w || 18) / 100) * 1080);
    const x = Math.max(0, Math.round(((o.x ?? 50) / 100) * 1080 - w / 2));
    const y = Math.max(0, Math.round(((o.y ?? 50) / 100) * 1920 - (o.shape === 'line' ? 4 : w / 2)));
    const h = o.shape === 'line' ? 8 : w;
    parts.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${ffColor(o.color || '#ffffff', o.opacity)}:t=${o.shape === 'circle' ? 8 : 'fill'}`);
  }
  return parts;
}

function frameFilter(header) {
  if (header?.frame !== 'phone') return header?.show ? 'drawbox=x=0:y=0:w=iw:h=250:color=black@0.85:t=fill' : null;
  const bg = String(header.bg || '#ffffff').replace('#', '0x');
  const bar = String(header.bar || header.color || '#9eb6ff').replace('#', '0x');
  return `scale=900:1460:force_original_aspect_ratio=increase,crop=900:1460,pad=1080:1920:90:340:${bg},drawbox=x=40:y=36:w=1000:h=250:color=${bar}:t=fill`;
}

async function render(workDir, payload, progress) {
  const tmp = path.join(workDir, 'render');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const { scenes, subs, edit, header, voiceFile, bgm, sfx = [], keepAudio, voiceOn, subOn, templateImage } = payload;
  const total = scenes.reduce((a, s) => a + s.dur, 0);

  for (let i = 0; i < scenes.length; i++) {
    checkCancel();
    const s = scenes[i];
    progress({ text: `장면 렌더링 중 (${i + 1}/${scenes.length})`, progress: (i / scenes.length) * 0.65 });
    await ff([
      '-y', '-ss', String(s.start), '-stream_loop', '-1', '-i', s.file,
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', String(s.dur), '-map', '0:v:0', '-map', keepAudio && s.hasAudio ? '0:a:0' : '1:a',
      '-vf', segmentFilter(s.dur, edit, i),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2', path.join(tmp, `seg_${i}.mp4`),
    ]);
  }

  progress({ text: '장면 이어 붙이는 중', progress: 0.68 });
  fs.writeFileSync(path.join(tmp, 'list.txt'), scenes.map((_, i) => `file 'seg_${i}.mp4'`).join('\n'));
  await ff(['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'video.mp4'], { cwd: tmp });

  fs.writeFileSync(path.join(tmp, 'subs.ass'), '\ufeff' + buildAss({ subs: subOn ? subs : [], edit, header, total }));

  const args = ['-y', '-i', 'video.mp4'];
  const fc = [];
  const labels = [];
  let idx = 1;
  if (voiceOn && voiceFile) {
    args.push('-i', voiceFile);
    fc.push(`[${idx}:a]volume=1.0[av]`);
    labels.push('[av]');
    idx++;
  }
  if (keepAudio || !labels.length) {
    const srcVol = keepAudio ? (voiceOn && voiceFile ? 0.35 : 1) : 0;
    fc.push(`[0:a]volume=${srcVol}[ao]`);
    labels.push('[ao]');
  }
  if (bgm?.file) {
    args.push('-stream_loop', '-1', '-i', bgm.file);
    fc.push(`[${idx}:a]volume=${bgm.volume || 0.15}[ab]`);
    labels.push('[ab]');
    idx++;
  }
  sfx.forEach((s, k) => {
    const ms = Math.round(s.time * 1000);
    args.push('-i', s.file);
    fc.push(`[${idx}:a]adelay=${ms}|${ms},volume=0.9[as${k}]`);
    labels.push(`[as${k}]`);
    idx++;
  });
  const pics = [];
  if (templateImage && fs.existsSync(templateImage)) pics.push({ file: templateImage, full: true });
  for (const o of edit.overlays || []) if (o.kind === 'image' && o.file && fs.existsSync(o.file)) pics.push(o);
  const picIndex = pics.map((p) => {
    args.push('-i', p.file);
    return idx++;
  });
  fc.push(labels.length > 1 ? `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[a]` : `${labels[0]}anull[a]`);
  const vchain = visualFilters(edit, header);
  vchain.push('ass=subs.ass');
  fc.push(`[0:v]${vchain.length ? vchain.join(',') : 'null'}[vf]`);
  let label = 'vf';
  pics.forEach((p, i) => {
    const next = `vo${i}`;
    if (p.full) {
      fc.push(`[${picIndex[i]}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=rgba[pim${i}]`);
      fc.push(`[${label}][pim${i}]overlay=0:0:format=auto[${next}]`);
    } else {
      const w = Math.round(((p.w || 30) / 100) * 1080);
      const x = Math.max(0, Math.round(((p.x ?? 50) / 100) * 1080 - w / 2));
      const y = Math.max(0, Math.round(((p.y ?? 50) / 100) * 1920 - w / 2));
      fc.push(`[${picIndex[i]}:v]scale=${w}:-1,format=rgba[pim${i}]`);
      fc.push(`[${label}][pim${i}]overlay=${x}:${y}:format=auto[${next}]`);
    }
    label = next;
  });
  fc.push(`[${label}]null[v]`);

  const outDir = path.join(workDir, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const out = path.join(outDir, `final_${stamp}.mp4`);
  progress({ text: '최종 합성 중 (자막·음성·배경음)', progress: 0.72 });
  await ff(
    [...args, '-filter_complex', fc.join(';'), '-map', '[v]', '-map', '[a]', '-t', total.toFixed(2),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out],
    {
      cwd: tmp,
      onLine: (l) => {
        const t = timeOf(l);
        if (t != null) progress({ progress: 0.72 + Math.min(1, t / total) * 0.28 });
      },
    },
  );
  return out;
}

async function removeSilence(file, out, level = 'normal') {
  const { dur, hasAudio } = await probe(file);
  if (!hasAudio) throw new Error('오디오가 없는 파일입니다.');
  const { err } = await ff(['-i', file, '-af', `silencedetect=noise=-40dB:d=${SILENCE[level] || 0.3}`, '-vn', '-f', 'null', '-']);
  const starts = [...err.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...err.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  const cuts = starts.map((s, i) => [s + 0.05, (ends[i] ?? dur) - 0.05]).filter(([a, b]) => b > a);
  if (!cuts.length) {
    fs.copyFileSync(file, out);
    return { out, removed: 0 };
  }
  const expr = cuts.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+');
  const { width } = await probe(file);
  const args = ['-y', '-i', file, '-af', `aselect='not(${expr})',asetpts=N/SR/TB`];
  if (width) args.push('-vf', `select='not(${expr})',setpts=N/FRAME_RATE/TB`);
  await ff([...args, out]);
  return { out, removed: cuts.reduce((a, [x, y]) => a + (y - x), 0) };
}

async function extractAudio(file, out) {
  await ff(['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', out]);
  return out;
}

async function composeStill(image, out, opts = {}) {
  const edit = opts.edit || {};
  const ass = path.join(path.dirname(out), 'thumb.ass');
  fs.writeFileSync(ass, '\ufeff' + buildAss({ subs: [], edit, header: opts.header, total: 1 }));
  const vf = ['scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'];
  if (opts.flip) vf.push('hflip');
  vf.push(...visualFilters(edit, opts.header));
  const assEsc = ass.replace(/\\/g, '/').replace(/:/g, '\\:');
  vf.push(`ass='${assEsc}'`);
  await ff(['-y', '-i', image, '-vf', vf.join(','), '-frames:v', '1', '-q:v', '3', out]);
  fs.rmSync(ass, { force: true });
  return out;
}

async function prependStill(video, image, frames, out) {
  const dur = (Math.max(1, frames) / 30).toFixed(3);
  const dir = path.dirname(out);
  const list = path.join(dir, 'lead-list.txt');
  const lead = path.join(dir, '_lead_clip.mp4');
  await ff(['-y', '-loop', '1', '-t', dur, '-i', image, '-f', 'lavfi', '-t', dur, '-i', 'anullsrc=r=44100:cl=stereo', '-vf', 'scale=1080:1920,setsar=1,fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', lead]);
  fs.writeFileSync(list, `file '${lead.replace(/\\/g, '/')}'\nfile '${video.replace(/\\/g, '/')}'\n`);
  await ff(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-pix_fmt', 'yuv420p', out]);
  fs.rmSync(lead, { force: true });
  fs.rmSync(list, { force: true });
  return out;
}

async function introClip(image, text, out) {
  const edit = { overlays: [{ kind: 'text', text, x: 50, y: 80, size: 68, bold: true, outline: true, shadow: true, opacity: 100, color: '#ffffff' }], topBox: { on: true, color: '#000000', height: 20, opacity: 75, zoom: 50 } };
  const ass = out + '.ass';
  fs.writeFileSync(ass, '\ufeff' + buildAss({ subs: [], edit, header: { show: false }, total: 2.4 }));
  const assEsc = ass.replace(/\\/g, '/').replace(/:/g, '\\:');
  await ff([
    '-y', '-loop', '1', '-i', image,
    '-f', 'lavfi', '-t', '2.4', '-i', 'anullsrc=r=44100:cl=stereo',
    '-vf', `scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,zoompan=z='min(1.05+0.002*on,1.2)':d=72:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,${visualFilters(edit, { show: false }).join(',')},ass='${assEsc}'`,
    '-map', '0:v', '-map', '1:a', '-t', '2.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out,
  ]);
  fs.rmSync(ass, { force: true });
  return out;
}

function pythonArgs() {
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python'),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const hits = fs.readdirSync(root)
      .filter((name) => /^Python3\d+$/i.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(root, name, 'python.exe'))
      .filter((file) => fs.existsSync(file));
    if (hits[0]) return [hits[0]];
  }
  return ['py', '-3'];
}

async function stripAudio(file, out) {
  try {
    await ff(['-y', '-i', file, '-an', '-c:v', 'copy', '-movflags', '+faststart', out]);
  } catch (e) {
    if (String(e && e.message).includes('CANCELLED')) throw e;
    await ff(['-y', '-i', file, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  }
  return out;
}

function parseRatio(text, fallback) {
  const m = String(text || '').match(/ratio\s+([\d.]+)\s+([\d.]+)/);
  if (!m) return fallback || null;
  const y = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(h) || h < 0.03) return fallback || null;
  return { y: Math.max(0, Math.min(0.9, y)), h: Math.max(0.04, Math.min(0.28, h)) };
}

async function cleanSource(file, out, band, onProgress) {
  if (band == null) return { out: await stripAudio(file, out), band: null };
  const hasHint = Number.isFinite(Number(band.y)) && Number(band.h) >= 0.04;
  const script = serviceFile('cover_caption.py');
  const extra = [];
  const y0 = hasHint ? Number(band.y) : 0.72;
  const h0 = hasHint ? Number(band.h) : 0.26;
  {
    const y = Math.max(0.78, Math.min(0.88, y0));
    let h = Math.max(0.10, Math.min(0.18, h0));
    if (y + h > 0.99) h = 0.99 - y;
    const meta = await probe(file);
    const H = meta.height || 1920;
    const yPx = Math.max(0, Math.floor((H * y) / 2) * 2);
    let hPx = Math.max(36, Math.floor((H * h) / 2) * 2);
    if (yPx + hPx > H - 4) hPx = Math.floor((H - yPx - 4) / 2) * 2;
    extra.push(String(yPx), String(hPx), '0');
  }
  let detected = hasHint ? { y: Number(band.y), h: Number(band.h) } : null;
  try {
    const { out: log } = await run(pythonArgs()[0], [...pythonArgs().slice(1), script, file, out, ...extra], {
      onLine: (l) => {
        const m = l.match(/^(\d+)\/(\d+)/);
        if (m && onProgress) onProgress(Math.min(1, Number(m[1]) / Number(m[2])));
        const ratio = parseRatio(l, null);
        if (ratio) detected = ratio;
      },
    });
    detected = parseRatio(log, detected);
  } catch (e) {
    if (String(e && e.message).includes('CANCELLED')) throw e;
    await stripAudio(file, out);
  }
  return { out, band: detected };
}

async function synthSfx(text, out, volume = 0.8) {
  const t = String(text || '');
  let src = 'anoisesrc=d=0.55:c=pink:r=44100,highpass=f=500,lowpass=f=3200,afade=t=in:st=0:d=0.05,afade=t=out:st=0.28:d=0.27';
  if (/클릭|타자|click|key|type/.test(t)) src = 'sine=f=150:d=0.09:r=44100,afade=t=out:st=0.02:d=0.07';
  else if (/팝|톡|pop/.test(t)) src = 'sine=f=680:d=0.16:r=44100,afade=t=out:st=0.03:d=0.13';
  else if (/충격|붐|hit|boom/.test(t)) src = 'sine=f=68:d=0.4:r=44100,afade=t=out:st=0.06:d=0.34';
  else if (/상승|스윽|바람|rise|whoosh/.test(t)) src = 'anoisesrc=d=0.7:c=white:r=44100,highpass=f=900,afade=t=in:st=0:d=0.4,afade=t=out:st=0.45:d=0.25';
  await ff(['-y', '-f', 'lavfi', '-i', src, '-af', `volume=${Math.max(0.05, Math.min(1, volume))}`, out]);
  return out;
}

async function hasBurnedCaption(file) {
  const script = serviceFile('cover_caption.py');
  try {
    const { out } = await run(pythonArgs()[0], [...pythonArgs().slice(1), script, file, '--probe']);
    return /caption yes/.test(out);
  } catch (e) {
    if (String(e && e.message).includes('CANCELLED')) throw e;
    return false;
  }
}

async function hasStillCaption(file) {
  const script = serviceFile('cover_caption.py');
  try {
    const { out } = await run(pythonArgs()[0], [...pythonArgs().slice(1), script, file, '--probe-image']);
    return /caption yes/.test(out);
  } catch (e) {
    if (String(e && e.message).includes('CANCELLED')) throw e;
    return false;
  }
}

async function zhStills(files) {
  const list = (files || []).filter((f) => f && fs.existsSync(f));
  if (!list.length) return [];
  const script = serviceFile('cover_caption.py');
  try {
    const { out } = await run(pythonArgs()[0], [...pythonArgs().slice(1), script, '--probe-zh', ...list]);
    const lines = out.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^zh (yes|no)$/.test(line));
    if (lines.length !== list.length) return [];
    return list.filter((_, i) => lines[i] === 'zh yes');
  } catch (e) {
    if (String(e && e.message).includes('CANCELLED')) throw e;
    return [];
  }
}

module.exports = { probe, frame, frameFromUrl, detectScenes, toWav, scaleAudio, concatAudio, render, removeSilence, extractAudio, buildAss, composeStill, prependStill, introClip, synthSfx, cleanSource, hasBurnedCaption, hasStillCaption, zhStills };
