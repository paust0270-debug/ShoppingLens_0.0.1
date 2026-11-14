const fs = require('fs');
const path = require('path');
const { run } = require('./run');
const tools = require('./tools');

const ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const SP = {
  today: 'CAMSBggCEAEYAQ%3D%3D',
  week: 'CAMSBggDEAEYAQ%3D%3D',
  month: 'CAMSBggEEAEYAQ%3D%3D',
  popular: 'CAMSBBABGAE%3D',
  short: 'EgQQARgB',
};
const PERIOD_DAYS = { today: 1, week: 7, month: 30, year: 365 };
const LENS_SP = { views: 'CAM%3D', date: 'CAI%3D', channel: 'EgIQAg%3D%3D' };

function ytdlp(args, opts = {}) {
  tools.ensureReady();
  return run(tools.paths().ytdlp, ['--no-warnings', '--encoding', 'utf-8', ...args], { env: ENV, ...opts });
}

async function videoCall(fn) {
  try {
    return await fn();
  } catch (e) {
    if (/not available|unavailable|private video|has been removed|sign in to confirm|members-only|age-restricted|login required/i.test(e.message)) {
      throw new Error('이 영상은 비공개이거나 삭제되어 이용할 수 없습니다.');
    }
    throw e;
  }
}

const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

async function searchYoutube(query, { limit = 40, filter = 'short' } = {}) {
  const target = query.startsWith('#')
    ? `https://www.youtube.com/hashtag/${encodeURIComponent(query.slice(1).replace(/\s+/g, ''))}/shorts`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${SP[filter] || SP.short}`;
  const { out } = await ytdlp(['--flat-playlist', '-J', '--playlist-end', String(limit), target]);
  const data = JSON.parse(out);
  return (data.entries || [])
    .filter((e) => e && e.id && String(e.id).length === 11)
    .map((e) => ({
      id: e.id,
      url: `https://www.youtube.com/watch?v=${e.id}`,
      title: e.title || '(제목 없음)',
      shorts: String(e.url || '').includes('/shorts/'),
      views: e.view_count || 0,
      dur: e.duration || 0,
      channel: e.channel || e.uploader || '',
      subs: e.channel_follower_count || 0,
      img: ytThumb(e.id),
      platform: 'youtube',
      date: '',
    }));
}

function isoDur(s) {
  const m = String(s).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

async function searchYoutubeApi(key, query, period, limit = 50, opt = {}) {
  const params = new URLSearchParams({
    part: 'snippet', type: 'video', videoDuration: opt.shorts === false ? 'any' : 'short', order: opt.order || 'viewCount', regionCode: opt.region || 'KR',
    relevanceLanguage: 'ko', maxResults: String(Math.min(limit, 50)), q: query, key,
  });
  if (period) params.set('publishedAfter', new Date(Date.now() - PERIOD_DAYS[period] * 864e5).toISOString());
  const s = await (await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)).json();
  if (s.error) throw new Error(`YouTube API 오류: ${s.error.message}`);
  const ids = s.items.map((i) => i.id.videoId).filter(Boolean);
  if (!ids.length) return [];
  const v = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}&key=${key}`)).json();
  const chIds = [...new Set(v.items.map((i) => i.snippet.channelId))];
  const c = await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${chIds.join(',')}&key=${key}`)).json();
  const subs = Object.fromEntries((c.items || []).map((i) => [i.id, +i.statistics.subscriberCount || 0]));
  return v.items.map((i) => ({
    id: i.id,
    url: `https://www.youtube.com/watch?v=${i.id}`,
    title: i.snippet.title,
    views: +i.statistics.viewCount || 0,
    likes: +i.statistics.likeCount || 0,
    comments: +i.statistics.commentCount || 0,
    dur: isoDur(i.contentDetails.duration),
    channel: i.snippet.channelTitle,
    subs: subs[i.snippet.channelId] || 0,
    img: ytThumb(i.id),
    platform: 'youtube',
    date: i.snippet.publishedAt.replace('T', ' ').slice(0, 16),
  }));
}

async function info(url) {
  const { out } = await videoCall(() => ytdlp(['-J', '--skip-download', '--no-playlist', url]));
  const d = JSON.parse(out);
  const date = d.upload_date ? `${d.upload_date.slice(0, 4)}-${d.upload_date.slice(4, 6)}-${d.upload_date.slice(6, 8)}` : '';
  return {
    id: d.id, url: d.webpage_url || url, title: d.title || '', description: d.description || '', dur: d.duration || 0,
    views: d.view_count || 0, likes: d.like_count || 0, comments: d.comment_count || 0,
    channel: d.channel || d.uploader || '', subs: d.channel_follower_count || 0, date, img: d.thumbnail || '',
    platform: (d.extractor_key || '').toLowerCase(),
  };
}

async function searchLens(query, { limit = 30, sort = 'views', shorts = false } = {}) {
  const filter = shorts ? (sort === 'date' ? 'month' : 'popular') : null;
  const sp = filter ? (SP[filter] || SP.short) : (LENS_SP[sort] || LENS_SP.views);
  const target = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${sp}`;
  const { out } = await ytdlp(['--flat-playlist', '-J', '--playlist-end', String(limit), target]);
  const data = JSON.parse(out);
  return (data.entries || [])
    .filter((e) => e && e.id && String(e.id).length === 11)
    .map((e) => ({
      id: e.id,
      url: `https://www.youtube.com/watch?v=${e.id}`,
      title: e.title || '(제목 없음)',
      shorts: shorts || String(e.url || '').includes('/shorts/'),
      views: e.view_count || 0,
      dur: e.duration || 0,
      channel: e.channel || e.uploader || '',
      subs: e.channel_follower_count || 0,
      likes: e.like_count || 0,
      comments: e.comment_count || 0,
      img: ytThumb(e.id),
      platform: 'youtube',
      date: '',
    }));
}

async function searchChannels(query, limit = 12) {
  const target = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${LENS_SP.channel}`;
  const { out } = await ytdlp(['--flat-playlist', '-J', '--playlist-end', String(limit), target]);
  const data = JSON.parse(out);
  return (data.entries || [])
    .filter((e) => e && (e.channel_id || e.ie_key === 'YoutubeTab' || String(e.url || e.channel_url || '').includes('youtube.com')))
    .map((e) => {
      const id = e.channel_id || e.id;
      const url = e.channel_url || e.url || (String(id).startsWith('UC') ? `https://www.youtube.com/channel/${id}` : '');
      return {
        id,
        url,
        name: e.channel || e.title || e.uploader || '',
        subs: e.channel_follower_count || 0,
        videos: e.playlist_count || 0,
        img: (e.thumbnails && e.thumbnails[0] && e.thumbnails[0].url) || '',
      };
    })
    .filter((c) => c.url && c.name);
}

async function channelVideos(url, limit = 20) {
  const base = String(url || '').replace(/\/(videos|shorts|streams)\/?$/, '').replace(/\/$/, '');
  const pages = [`${base}/videos`, `${base}/shorts`, base];
  let lastErr;
  for (const page of pages) {
    try {
      const { out } = await ytdlp(['--flat-playlist', '-J', '--playlist-end', String(limit), page]);
      const data = JSON.parse(out);
      const vids = (data.entries || [])
        .filter((e) => e && e.id && String(e.id).length === 11)
        .map((e) => ({
          id: e.id,
          url: `https://www.youtube.com/watch?v=${e.id}`,
          title: e.title || '(제목 없음)',
          views: e.view_count || 0,
          dur: e.duration || 0,
          channel: e.channel || data.channel || data.title || '',
          subs: e.channel_follower_count || data.channel_follower_count || 0,
          img: ytThumb(e.id),
          platform: 'youtube',
          date: '',
          shorts: (e.duration || 0) > 0 && e.duration <= 60,
        }));
      if (vids.length) return vids;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

function parseVtt(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/<[^>]+>/g, '').trim();
    if (!l || l.includes('-->') || /^(WEBVTT|Kind:|Language:|NOTE)/.test(l) || /^\d+$/.test(l)) continue;
    if (lines[lines.length - 1] !== l) lines.push(l);
  }
  return lines.join(' ');
}

async function transcript(url, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith('sub.')) fs.rmSync(path.join(dir, f));
  try {
    await ytdlp(['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'ko.*,ko,en.*,en', '--sub-format', 'vtt', '--no-playlist', '-o', path.join(dir, 'sub.%(ext)s'), url]);
  } catch {
    return '';
  }
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('sub.') && f.endsWith('.vtt'));
  files.sort((a, b) => (b.includes('.ko') ? 1 : 0) - (a.includes('.ko') ? 1 : 0));
  return files.length ? parseVtt(fs.readFileSync(path.join(dir, files[0]), 'utf8')) : '';
}

async function cookieArgs(url) {
  if (!/xiaohongshu|xhslink|rednote|douyin|tiktok|instagram|taobao|tmall|1688|alicdn/.test(url)) return [];
  try {
    const file = await require('./socialSearch').cookieFile();
    if (file) return ['--cookies', file];
  } catch {}
  return ['--cookies-from-browser', 'chrome'];
}

function detectPlatform(url) {
  if (/xiaohongshu|xhslink|rednote/i.test(url)) return 'xhs';
  if (/douyin/i.test(url)) return 'douyin';
  if (/taobao|tmall/i.test(url)) return 'taobao';
  if (/1688/i.test(url)) return 'ali1688';
  if (/tiktok/i.test(url)) return 'tiktok';
  return '';
}

async function download(url, dir, base, onProgress) {
  fs.mkdirSync(dir, { recursive: true });
  const plat = detectPlatform(url);
  const socialPlatforms = ['xhs', 'douyin', 'taobao', 'ali1688'];
  if (socialPlatforms.includes(plat)) {
    try {
      const social = require('./socialSearch');
      const hit = await social.grabSocialVideo(url, plat);
      const href = typeof hit === 'string' ? hit : (hit && hit.url);
      if (href) {
        const dest = path.join(dir, `${base}.mp4`);
        if (/\.m3u8(\?|$)/i.test(href)) {
          const { run: runCmd } = require('./run');
          const refHeader = `Referer: ${social.refererFor(href, plat)}\r\n`;
          await runCmd(tools.paths().ffmpeg, ['-y', '-headers', refHeader, '-i', href, '-c', 'copy', dest]);
          if (fs.existsSync(dest)) return dest;
        } else {
          return social.fetchSocialFile(href, dest, plat);
        }
      }
    } catch (e) {
      if (/CANCELLED|XHS_LOGIN/.test(String(e.message))) throw e;
    }
  }
  const cookies = await cookieArgs(url);
  try {
    const { out } = await videoCall(() => ytdlp(
      [
        ...cookies,
        '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
        '--merge-output-format', 'mp4', '--ffmpeg-location', tools.dir(), '--no-playlist',
        '--newline', '--progress', '--print', 'after_move:filepath', '-o', path.join(dir, `${base}.%(ext)s`), url,
      ],
      {
        onLine: (l) => {
          const m = l.match(/\[download\]\s+([\d.]+)%/);
          if (m && onProgress) onProgress(Number(m[1]) / 100);
        },
      },
    ));
    const file = out.trim().split(/\r?\n/).filter(Boolean).pop();
    if (!file || !fs.existsSync(file)) throw new Error('다운로드한 파일을 찾지 못했습니다.');
    return file;
  } catch (e) {
    if (!socialPlatforms.includes(plat)) throw e;
    const social = require('./socialSearch');
    const again = await social.grabSocialVideo(url, plat);
    const href = typeof again === 'string' ? again : (again && again.url);
    if (!href) throw e;
    const dest = path.join(dir, `${base}.mp4`);
    if (/\.m3u8(\?|$)/i.test(href)) {
      const { run: runCmd } = require('./run');
      const refHeader = `Referer: ${social.refererFor(href, plat)}\r\n`;
      await runCmd(tools.paths().ffmpeg, ['-y', '-headers', refHeader, '-i', href, '-c', 'copy', dest]);
      if (!fs.existsSync(dest)) throw e;
      return dest;
    }
    return social.fetchSocialFile(href, dest, plat);
  }
}

async function downloadAudio(url, dir, base) {
  fs.mkdirSync(dir, { recursive: true });
  const { out } = await videoCall(() => ytdlp(['-x', '--audio-format', 'mp3', '--ffmpeg-location', tools.dir(), '--no-playlist', '--print', 'after_move:filepath', '-o', path.join(dir, `${base}.%(ext)s`), url]));
  return out.trim().split(/\r?\n/).filter(Boolean).pop();
}

function readCues(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('sub.') && f.endsWith('.vtt'));
  if (!files.length) return [];
  files.sort((a, b) => (b.includes('.ko') ? 1 : 0) - (a.includes('.ko') ? 1 : 0));
  const text = fs.readFileSync(path.join(dir, files[0]), 'utf8');
  const cues = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const m = block.match(/(\d+):(\d+):([\d.]+)\s+-->/);
    if (!m) continue;
    const line = block.split(/\r?\n/).slice(1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!line) continue;
    const t = +m[1] * 3600 + +m[2] * 60 + +m[3];
    if (cues[cues.length - 1]?.text === line) continue;
    cues.push({ t, text: line });
  }
  return cues;
}

module.exports = { searchYoutube, searchYoutubeApi, searchLens, searchChannels, channelVideos, info, transcript, readCues, download, downloadAudio };
