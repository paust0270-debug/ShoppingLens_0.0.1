const PRESETS = {};

PRESETS.lensStyles = [
  { title: '가치 비교형 - 가격이 아니라 가치로 (제품 1개)', emoji: '🏆', hue: 45,
    summary: { length: '25~40초', hook: '충격형 · 가치 비교형', speed: '살짝 빠르게 몰아가되 증거 장면에서 한 번 쉼', flow: '시연 → 비교 → 마무리', tone: '강하게 훅을 던지고 과장과 단정으로 어필', expose: '영상 시작 직후 등장 · 클로즈업 반복', cta: '댓글 유도 · 링크 확인', guide: '첫 문장에 가격 대비 가치를 단정, 빠르게 연결' } },
  { title: '제품 사용 전/후 비교 - 쓰기전 VS 쓴 후 (제품 1개)', emoji: '🔁', hue: 55,
    summary: { length: '25~40초', hook: '문제 제시형 · 불편함 공감', speed: '살짝 빠름 · 8~12문장', flow: '문제 → 사용 → 변화 → 결과', tone: '친근한 반말 · 공감', expose: '중반 사용 장면 집중', cta: '프로필 링크 안내', guide: '사용 전 불편함을 구체적으로, 사용 후 변화를 숫자로' } },
  { title: '정체 공개형 - 이 제품의 정체는? (제품 1개)', emoji: '❓', hue: 270,
    summary: { length: '25~40초', hook: '질문형 · 이게 뭘까?', speed: '살짝 빠름 · 후반에 한 번 더', flow: '궁금증 → 힌트 → 정체 공개 → 활용', tone: '호기심 자극 · 반말', expose: '정체 공개 시점에 클로즈업', cta: '댓글로 정답 유도', guide: '정체를 최대한 늦게 공개, 반전 포인트 1개' } },
  { title: 'BEST 추천 - 제품 여러 가지 (제품 2개+)', emoji: '🥇', hue: 220,
    summary: { length: '25~40초', hook: '리스트형 · TOP N', speed: '제품당 2~3문장 · 살짝 빠름', flow: '소개 → 1번 → 2번 → 3번 → 마무리', tone: '정보 전달형 존댓말', expose: '제품별 순차 노출', cta: '번호별 링크 안내', guide: '각 제품의 핵심 장점 1개만, 번호로 구분' } },
];

PRESETS.platforms = [
  { id: 'all', label: '전체' },
  { id: 'youtube', label: '유튜브' },
  { id: 'tiktok', label: '틱톡', search: (q) => `https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}` },
  { id: 'instagram', label: '인스타', search: (q) => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}` },
  { id: 'xhs', label: '샤오홍슈', search: (q) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(q)}&type=51` },
  { id: 'douyin', label: '도우인', search: (q) => `https://www.douyin.com/search/${encodeURIComponent(q)}` },
  { id: 'ali1688', label: '1688', search: (q) => `https://www.1688.com/chanpin/-.html?keywords=${encodeURIComponent(q)}` },
];

PRESETS.templates = [
  { name: '바이럴 민트', look: 'mint', color: '#7DF9FD', frame: 'bar', bg: '#0c0e12', chip: '유행' },
  { name: '노란 후킹', look: 'hook', color: '#FFE14A', frame: 'bar', bg: '#111111', chip: '유행' },
  { name: '라운드 자막', look: 'pill', color: '#ffffff', frame: 'bar', bg: '#1b1b1b', chip: '유행' },
  { name: '하단 페이드', look: 'fade', color: '#ffffff', frame: 'bar', bg: '#161616' },
  { name: '유리 카드', look: 'glass', color: '#ffffff', frame: 'bar', bg: '#243044' },
  { name: '네온 프레임', look: 'neon', color: '#7DF9FD', frame: 'bar', bg: '#07080d' },
  { name: '폴라로이드', look: 'polaroid', color: '#1d1b18', frame: 'bar', bg: '#f7f4ef' },
  { name: '시네마 바', look: 'film', color: '#f5c64a', frame: 'bar', bg: '#000000' },
  { name: '레드 티커', look: 'ticker', color: '#ffffff', frame: 'bar', bg: '#2a0b12' },
  { name: '파스텔 여백', look: 'pastel', color: '#e11d48', frame: 'bar', bg: '#fff1e6' },
  { name: '매거진', look: 'mag', color: '#1d1b18', frame: 'bar', bg: '#f4efe6' },
  { name: '가격 스티커', look: 'badge', color: '#ff5a36', frame: 'bar', bg: '#141414', chip: '쇼핑' },
  { name: '폰 라이트', look: 'phone', color: '#1d1b18', frame: 'phone', bg: '#f6f3ee', bar: '#ffffff' },
  { name: '폰 다크', look: 'phone', color: '#7DF9FD', frame: 'phone', bg: '#101114', bar: '#1c1f27' },
  { name: '폰 코랄', look: 'phone', color: '#ffffff', frame: 'phone', bg: '#2a1210', bar: '#ff5a36' },
  { name: '소프트 글로우', look: 'soft', color: '#3a2a22', frame: 'bar', bg: '#f3e4d6' },
  { name: '꿀템 상단', look: 'reel', color: '#ffffff', frame: 'bar', bg: '#111111', chip: '훅' },
];
PRESETS.effects = [
  ['none', '효과 없음'],
  ['auto', '자동 모드 (효과 랜덤 배치)'],
  ['zoom', '줌 인/아웃 (확대/축소 몰입감)'],
  ['pan', '화면 이동 (가로/세로 패닝)'],
  ['float', '유영 효과 (몽환적 플로팅)'],
  ['combo', '복합 연출 (줌+패닝 조합)'],
  ['mirror', '좌우 반전 (미러링)'],
  ['shake', '흔들림'],
  ['flash', '플래시 전환'],
];

PRESETS.filters = [['none', '원본'], ['sharp', '선명하게'], ['warm', '따뜻하게'], ['cool', '차갑게'], ['vintage', '빈티지'], ['mono', '흑백']];
PRESETS.fonts = ['Malgun Gothic', 'Gulim', 'Batang', 'Gungsuh', 'Arial Black', 'Impact'];
PRESETS.speeds = [['brisk', '살짝 빠름'], ['normal', '보통'], ['fast', '빠름'], ['faster', '매우 빠름'], ['slow', '느림']];

if (typeof module !== 'undefined' && module.exports) module.exports = PRESETS;
