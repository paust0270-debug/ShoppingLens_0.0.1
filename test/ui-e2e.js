const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const tmp = path.join(os.tmpdir(), 'sl-ui-e2e');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.cpSync(path.join(app.getPath('appData'), 'ShoppingLens', 'bin'), path.join(tmp, 'bin'), { recursive: true });
app.setPath('userData', tmp);
require('../main');

const NAME = 'UI전체실험';
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
const results = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

app.whenReady().then(async () => {
  const ffmpeg = path.join(tmp, 'bin', 'ffmpeg.exe');
  const clip = path.join(tmp, 'clip.mp4');
  const src = 'C:/Users/{C/Documents/ShoppingLens/새 프로젝트/videos/src1_mvp0lj5n.mp4';
  const made = fs.existsSync(src)
    ? spawnSync(ffmpeg, ['-y', '-ss', '1', '-t', '4', '-i', src, '-vf', 'scale=720:1280,setsar=1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', clip], { encoding: 'utf8' })
    : spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip], { encoding: 'utf8' });
  if (made.status !== 0 || !fs.existsSync(clip)) {
    console.log('CLIP FAIL', (made.stderr || '').slice(-400));
    app.quit();
    return;
  }

  await new Promise((r) => setTimeout(r, 900));
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    console.log('FAIL 창이 열리지 않음');
    app.quit();
    return;
  }
  win.setPosition(-3000, 0);
  const errors = [];
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' && !/GPU|cache|Autofill/i.test(e.message)) errors.push(e.message);
  });
  try { await win.webContents.capturePage(); } catch {}

  async function check(name, fn) {
    const before = errors.length;
    try {
      const detail = await fn();
      const extra = errors.slice(before);
      if (extra.length) throw new Error(extra[0]);
      results.push({ name, ok: true, detail: detail == null ? '' : String(detail) });
      log('PASS', name, detail == null ? '' : String(detail).slice(0, 160));
    } catch (e) {
      results.push({ name, ok: false, detail: e.message });
      log('FAIL', name, e.message.slice(0, 220));
    }
  }

  async function js(code, timeout = 20000) {
    const timer = new Promise((_, rej) => setTimeout(() => rej(new Error('페이지 응답 시간 초과')), timeout));
    const wrapped = `(async () => {\n${code}\n})()`;
    return Promise.race([win.webContents.executeJavaScript(wrapped, true), timer]);
  }

  const waitIdle = `async function waitIdle(ms){const t=Date.now();while(state.busy&&Date.now()-t<ms)await new Promise(r=>setTimeout(r,200));if(state.busy)throw new Error('작업이 끝나지 않음: '+(state.status&&state.status.text));}`;
  const click = `${waitIdle}
    function click(sel){const el=document.querySelector(sel);if(!el)throw new Error('버튼 없음 '+sel);if(el.disabled)throw new Error('비활성 '+sel+' '+el.textContent.trim());el.click();}`;
  const missing = `function missing(){const bad=[];document.querySelectorAll('[data-act]').forEach(el=>{if(typeof actions[el.dataset.act]!=='function')bad.push(el.dataset.act)});return [...new Set(bad)];}`;

  try {
    await js(`return new Promise((res)=>{const t=Date.now();const i=setInterval(()=>{if(!state.trendsLoading||Date.now()-t>25000){clearInterval(i);res(state.trends.length+':'+(state.trendsError||state.trendSource||''));}},200)})`);

    await check('화면별 버튼이 전부 연결되어 있는지', async () => {
      const views = ['trend', 'lens', 'work', 'blast', 'projects', 'tools', 'settings'];
      const bad = [];
      for (const v of views) {
        const r = await js(`${missing};state.view='${v}';state.modal=null;render();return JSON.stringify({v:'${v}',bad:missing(),title:document.querySelector('h2,h3')?.textContent||''})`);
        const o = JSON.parse(r);
        if (o.bad.length) bad.push(v + '=' + o.bad.join(','));
      }
      for (const tab of [1, 2, 3, 4, 5, 6, 7]) {
        const r = await js(`${missing};state.view='work';state.workTab=${tab};state.modal=null;render();return JSON.stringify(missing())`);
        const b = JSON.parse(r);
        if (b.length) bad.push('work' + tab + '=' + b.join(','));
      }
      must(!bad.length, bad.join(' | '));
      return '7개 화면, 작업실 7단계';
    });

    await check('트렌드 목록', async () => {
      const r = await js(`return ({n:state.trends.length, err:state.trendsError, src:state.trendSource})`);
      must(!r.err, r.err);
      must(r.n >= 5, r.n + '개');
      return `${r.src} ${r.n}개`;
    });

    await check('프로젝트에 영상 올리고 장면 분석', async () => {
      const r = await js(`${click}
        state.view='work'; state.workTab=1; state.p=newProject(${JSON.stringify(NAME)});
        state.p.videos=[{url:'local', title:'테스트 영상', platform:'youtube', done:true, file:${JSON.stringify(clip)}, hasAudio:true, dur:4, emoji:'🎬', hue:20}];
        render();
        document.querySelector('[data-act="analyzeSources"]').click();
        await waitIdle(60000);
        const v=state.p.videos[0];
        if(!v.scenes||!v.scenes.length) throw new Error('장면 없음 '+(state.status&&state.status.text));
        return ({n:v.scenes.length, label:v.scenes[0].label, next:!!document.querySelector('[data-act="workTab"][data-val="2"]')})
      `, 70000);
      must(r.n >= 1 && r.next, JSON.stringify(r));
      return `${r.n}장면, 다음 단계 버튼 있음`;
    });

    await check('대본 생성과 문장 추가', async () => {
      const r = await js(`${click}
        click('[data-act="workTab"][data-val="2"]');
        state.p.product={name:'세탁 꿀템'};
        click('[data-act="genScript"]');
        await waitIdle(30000);
        const made=state.p.lines.length;
        click('[data-act="addLine"]');
        const inputs=document.querySelectorAll('[data-line]');
        if(inputs.length!==made+1) throw new Error('문장 칸 '+inputs.length);
        click('[data-act="removeLine"]');
        return ({made, now:state.p.lines.filter(Boolean).length})
      `);
      must(r.made >= 5 && r.now >= 5, JSON.stringify(r));
      return `${r.made}문장`;
    });

    await check('윈도우 음성 생성', async () => {
      const r = await js(`${click}
        state.p.lines=state.p.lines.filter(Boolean).slice(0,2);
        state.p.tts.provider='sapi';
        render();
        click('[data-act="genVoice"]');
        await waitIdle(90000);
        if(!state.p.ttsReady) throw new Error(state.status&&state.status.text);
        return ({n:state.p.audio.length, dur:+state.p.audio.reduce((a,x)=>a+x.dur,0).toFixed(1)})
      `, 100000);
      must(r.n === 2 && r.dur > 0.5, JSON.stringify(r));
      return `${r.n}개 ${r.dur}초`;
    });

    await check('장면 매칭과 클립 교체, 미리보기', async () => {
      const r = await js(`${click}
        click('[data-act="workTab"][data-val="3"]');
        click('[data-act="matchScenes"]');
        await waitIdle(30000);
        click('[data-act="pickScene"]');
        const clip=document.querySelector('[data-act="assignClip"]');
        if(!clip) throw new Error('클립 없음');
        clip.click();
        click('[data-act="previewScenes"]');
        const shown=document.querySelector('#ss-img')?.style.backgroundImage||'';
        const sub=document.querySelector('#ss-sub')?.textContent||'';
        click('[data-act="closeModal"]');
        return ({scenes:state.p.scenes.length, bg:shown.slice(0,32), sub})
      `);
      must(r.scenes === 2 && r.bg.includes('url'), JSON.stringify(r));
      return `${r.scenes}장면 미리보기`;
    });

    await check('자막 분할과 고치기', async () => {
      const r = await js(`${click}
        click('[data-act="workTab"][data-val="4"]');
        click('[data-act="splitSubs"]');
        const before=state.p.subtitles[0].text;
        click('[data-act="fixSubs"]');
        await waitIdle(20000);
        const input=document.querySelector('[data-sub="0"]');
        input.value='화면에서 바뀐 자막';
        input.dispatchEvent(new Event('input',{bubbles:true}));
        return ({n:state.p.subtitles.length, text:state.p.subtitles[0].text, before})
      `);
      must(r.n >= 2 && r.text === '화면에서 바뀐 자막', JSON.stringify(r));
      return `${r.n}개`;
    });

    await check('최종편집 재생, 필터, 효과, 글자, 상자', async () => {
      const r = await js(`${click}
        click('[data-act="workTab"][data-val="5"]');
        const vid=document.querySelector('#pv-video');
        if(!vid) throw new Error('영상 칸 없음');
        await new Promise((res,rej)=>{const t=Date.now();const i=setInterval(()=>{if(vid.videoWidth||vid.error||Date.now()-t>8000){clearInterval(i);res();}},100);});
        if(vid.error) throw new Error('영상 로드 실패 '+vid.error.code);
        if(!vid.videoWidth) throw new Error('첫 화면이 비어 있음');
        click('.player [data-act="play"]');
        await new Promise(r=>setTimeout(r,900));
        const moved=vid.currentTime;
        click('.player [data-act="play"]');
        click('[data-act="rightPanel"][data-val="filter"]');
        click('[data-act="setEdit"][data-key="filter"][data-val="warm"]');
        click('[data-act="setEdit"][data-key="effect"][data-val="zoom"]');
        click('[data-act="rightPanel"][data-val="template"]');
        click('[data-act="boxToggle"][data-val="topBox"]');
        const range=document.querySelector('[data-box="topBox"][data-bf="height"]');
        range.value=32; range.dispatchEvent(new Event('input',{bubbles:true}));
        const stage=document.querySelector('.preview');
        const box=stage.getBoundingClientRect();
        stage.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:box.left+box.width/2,clientY:box.top+box.height/2}));
        const size=document.querySelector('[data-model="edit.size"]');
        size.value=120; size.dispatchEvent(new Event('input',{bubbles:true}));
        return ({
          moved:+moved.toFixed(2), w:vid.videoWidth,
          filter:document.querySelector('#pv-video').style.filter,
          fx:document.querySelector('.preview').className,
          box:document.querySelector('.pv-box.top')?.style.height,
          text:document.querySelectorAll('.ov-text').length,
          font:document.querySelector('#pv-sub').style.fontSize
        })
      `, 20000);
      must(r.w > 0, JSON.stringify(r));
      must(r.moved > 0.15, '재생이 안 움직임 '+JSON.stringify(r));
      must(/sepia|contrast|saturate/.test(r.filter), '필터 '+r.filter);
      must(r.fx.includes('fx-zoom'), r.fx);
      must(r.box === '32%', '상자 '+r.box);
      must(r.text >= 1, '글자 없음');
      return `재생 ${r.moved}s, ${r.w}px, 글자 ${r.text}`;
    });

    await check('유행 템플릿이 미리보기에 붙는지', async () => {
      const r = await js(`${click}
        click('[data-act="workTab"][data-val="5"]');
        click('[data-act="rightPanel"][data-val="template"]');
        const n=document.querySelectorAll('[data-act="pickTpl"]').length;
        if(n<16) throw new Error('템플릿 '+n+'개');
        const seen=[];
        for (const i of [0,2,4,6,8,12]) {
          click('[data-act="pickTpl"][data-i="'+i+'"]');
          seen.push(document.querySelector('.preview').className);
        }
        click('[data-act="pickTpl"][data-i="2"]');
        return seen.join(' | ');
      `);
      must(/look-mint/.test(r) && /look-pill/.test(r) && /look-glass/.test(r) && /look-polaroid/.test(r) && /look-ticker/.test(r) && /phone/.test(r), r);
      return '16개, 민트·자막·유리·폴라로이드·티커·폰';
    });

    await check('편집준비와 썸네일, 시작장면, 효과음', async () => {
      const r = await js(`${click}
        click('[data-act="prepModal"]');
        if(!document.querySelector('.prep-modal')) throw new Error('편집준비 창 없음');
        click('[data-act="togglePrep"][data-val="keepAudio"]');
        click('[data-act="startPrep"]');
        await waitIdle(60000);
        click('[data-act="rightPanel"][data-val="thumb"]');
        click('[data-act="thumbSuggest"]');
        click('[data-act="finishThumb"]');
        await waitIdle(30000);
        click('[data-act="rightPanel"][data-val="template"]');
        click('[data-act="openIntro"]');
        click('[data-act="introMake"]');
        await waitIdle(30000);
        click('[data-act="rightPanel"][data-val="sfx"]');
        click('[data-act="openSfx"]');
        const make=document.querySelector('#sfx-make'); if(make) make.value='whoosh';
        state.sfxDraft.make='whoosh';
        click('[data-act="sfxMake"]');
        await waitIdle(30000);
        return ({prep:!!state.p.prepared, thumb:!!state.p.thumbnail, intro:!!state.p.edit.intro, sfx:state.p.edit.sfx.length, status:state.status&&state.status.text})
      `, 90000);
      must(r.prep && r.thumb && r.intro && r.sfx >= 1, JSON.stringify(r));
      return '준비·썸네일·인트로·효과음';
    });

    await check('영상 내보내기', async () => {
      const r = await js(`${click}
        click('[data-act="toggleExport"]');
        click('[data-act="export"]');
        await waitIdle(120000);
        if(!state.p.exported) throw new Error(state.status&&state.status.text);
        return state.p.exported
      `, 130000);
      const media = require('../services/media');
      const meta = await media.probe(r);
      must(meta.width === 1080 && meta.height === 1920 && meta.hasAudio && meta.dur > 1, JSON.stringify(meta));
      return `${meta.width}x${meta.height} ${meta.dur.toFixed(1)}초 소리 ${meta.hasAudio}`;
    });

    await check('업로드 문구, 달력, 계정 없을 때 안내', async () => {
      const r = await js(`${click}
        click('[data-act="workTab"][data-val="7"]');
        click('[data-act="uploadModal"]');
        const until=Date.now()+8000;
        while(!(state.uploadTexts&&state.uploadTexts.styles)&&Date.now()<until) await new Promise(r=>setTimeout(r,150));
        const styles=state.uploadTexts&&state.uploadTexts.styles?state.uploadTexts.styles.length:0;
        click('[data-act="applyUpload"]');
        click('[data-act="openCal"][data-val="upload"]');
        click('[data-act="calApply"]');
        click('[data-act="doUpload"]');
        await waitIdle(30000);
        const last=(state.p.upload.results||[]).at(-1);
        return ({styles, desc:state.p.upload.desc.length, when:state.p.upload.schedule, up:last&&last.text})
      `, 40000);
      must(r.styles >= 3 && r.desc > 10 && r.when && r.up, JSON.stringify(r));
      return `문구 ${r.styles}종, 업로드 안내: ${String(r.up).slice(0, 40)}`;
    });

    await check('원클릭배포 화면', async () => {
      const r = await js(`${click}
        click('[data-act="nav"][data-val="blast"]');
        const before=document.querySelector('[data-act="blastGo"]').disabled;
        click('[data-act="blastFromWork"]');
        const until=Date.now()+4000;
        while(!state.blast.file&&Date.now()<until) await new Promise(r=>setTimeout(r,100));
        state.blast.title='테스트 영상';
        state.blast.desc='설명';
        const targets=[...document.querySelectorAll('[data-act="snsToggle"]')].length;
        return ({before, file:!!state.blast.file, targets, hero:document.querySelector('.deploy-btn')?.textContent||''})
      `);
      must(r.before && r.file && /배포/.test(r.hero), JSON.stringify(r));
      return `작업실 영상 연결, 채널 스위치 ${r.targets}`;
    });

    await check('분석기 검색', async () => {
      const r = await js(`${click}
        click('[data-act="nav"][data-val="lens"]');
        state.lens.query='다이소 꿀템'; state.lens.limit=5; state.lens.period='all'; state.lens.shorts=true;
        click('[data-act="lensSearch"]');
        await waitIdle(90000);
        if(!state.lens.rows.length) throw new Error(state.status&&state.status.text);
        return ({n:state.lens.rows.length, title:state.lens.rows[0].title})
      `, 100000);
      must(r.n >= 1, JSON.stringify(r));
      return `${r.n}개 ${String(r.title).slice(0, 24)}`;
    });

    await check('저장 후 프로젝트 목록', async () => {
      const r = await js(`${click}
        click('[data-act="nav"][data-val="work"]');
        click('[data-act="saveProject"]');
        await waitIdle(10000);
        click('[data-act="nav"][data-val="projects"]');
        await new Promise(r=>setTimeout(r,500));
        return document.body.innerText.includes(${JSON.stringify(NAME)})
      `);
      must(r, '목록에 없음');
      return NAME;
    });

    await check('도구와 설정 화면', async () => {
      const r = await js(`${missing}
        state.view='tools'; render();
        const tools=document.body.innerText;
        state.view='settings'; render();
        const sel=document.querySelector('[data-setting="aiProvider"]');
        sel.value='gemini';
        const bad=[...missing(), ...(tools.includes('yt-dlp')||tools.includes('FFmpeg')||tools.includes('ffmpeg') ? [] : ['도구표시없음'])];
        return ({bad, settings:document.body.innerText.includes('Gemini')})
      `);
      must(!r.bad.length && r.settings, JSON.stringify(r));
      return '도구 설치 표시, AI 선택';
    });

    await js(`state.view='work';state.workTab=5;render();`);
    await new Promise((r) => setTimeout(r, 600));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shots, 'ui-e2e-edit.png'), img.toPNG());
  } catch (e) {
    log('ABORT', e.stack || e.message);
  }

  const failed = results.filter((r) => !r.ok);
  log(failed.length ? `실패 ${failed.length}/${results.length}` : `전부 통과 ${results.length}`);
  try { fs.rmSync(path.join(app.getPath('documents'), 'ShoppingLens', NAME), { recursive: true, force: true }); } catch {}
  app.quit();
});
