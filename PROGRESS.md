# ShoppingLens 0.0.1 — 개발 진행 상황

## Phase 3: 쿠팡 URL → 해외 영상 원클릭 생성

### 완료된 작업

#### 1. Chrome CDP 연결 (chromeDriver.js)
- `subst Z:` 가상 드라이브로 Chrome의 기본 프로필 디렉토리 제한 우회
- `--remote-debugging-port=9223`으로 실제 Chrome 프로필(로그인 유지) + CDP 디버깅
- `CdpTab` 클래스: WebSocket 기반 CDP 탭 제어 (connect/send/eval/navigate/close)
- `openTab(url)`: Chrome 자동 시작 + 탭 생성 + CDP 연결
- `killAllChrome()`: 비동기 프로세스 종료 + 검증 루프

#### 2. 소셜 플랫폼 텍스트 검색 (socialSearch.js)
- `searchSocial(platform, pageUrl, label)`: 플랫폼별 텍스트 검색
- `SCRAPE` 스크립트: DOM에서 플랫폼 URL 패턴 매칭으로 상품/영상 링크 추출
- 지원 플랫폼 URL 패턴:
  - TikTok: `tiktok.com/@.../video/...`
  - XHS: `xiaohongshu.com/explore/...`, `rednote.com/search_result/...`
  - Douyin: `douyin.com/video/...`
  - Taobao: `item.taobao.com/item.htm?id=...`, `detail.tmall.com/item.htm?id=...`
  - 1688: `detail.1688.com/offer/....html`, `dj.1688.com/ci_bb?...`
- 검색 결과 확인:
  - TikTok: ✓ 12개
  - Taobao: ✓ 24개
  - 1688: ✓ 1개 (텍스트 검색 한계)
  - XHS: ✓ 17개
  - Douyin: ✗ 로그인 필요 (수동 로그인 후 사용 가능)

#### 3. 이미지 검색 구현 (socialSearch.js — 신규)
**파일: `services/socialSearch.js`**

`searchByImage(platform, imageUrl, label)` 함수 추가:
- 지원: `taobao`, `ali1688`
- 동작 흐름:
  1. `downloadImage(imageUrl)`: 쿠팡 상품 이미지를 임시 파일로 다운로드
  2. `chromeDriver.openTab(cfg.url)`: 플랫폼 이미지 검색 페이지 열기
  3. CDP `DOM.getDocument` → `DOM.querySelector` → `DOM.setFileInputFiles`: 파일 입력란에 이미지 업로드
  4. 결과 대기 + 스크롤 + `IMG_SCRAPE`로 상품 링크 수집
  5. 결과를 `searchSocial`과 동일한 형식으로 반환

이미지 검색 페이지:
- Taobao: `https://s.taobao.com/search?tab=pic`, `input[type="file"]`
- 1688: `https://air.1688.com/kapp/1688-search/pc-image-search/`, `#img-search-upload`

`IMG_SCRAPE` 스크립트: Taobao/1688 전용 상품 링크 패턴 매칭

**파일: `services/api.js`**

`searchByImage` API 엔드포인트 추가 (line ~349):
```javascript
searchByImage: async (progress, platform, imageUrl) => {
  const label = { taobao: '타오바오', ali1688: '1688' }[platform] || platform;
  progress({ text: `${label} 이미지 검색 중` });
  return social.searchByImage(platform, imageUrl, label);
},
```

**파일: `src/app.js`**

`coupangOneClick()` 함수 수정 (line ~2853):
- `taobao`, `ali1688` 플랫폼은 `api('searchByImage', plat, info.img)` 사용
- 나머지 플랫폼(`xhs`, `douyin`, `tiktok`)은 기존 `api('searchSocial', plat, zh || keyword)` 유지
```javascript
const IMAGE_SEARCH_PLATFORMS = ['taobao', 'ali1688'];
const useImageSearch = IMAGE_SEARCH_PLATFORMS.includes(plat) && info.img;
const r = useImageSearch
  ? await api('searchByImage', plat, info.img)
  : await api('searchSocial', plat, zh || keyword);
```

### 테스트 결과 (2026-11-07)

1. **타오바오 이미지 검색 ✓**
   - `test-imgsearch.js`로 토네이도 화로대 장면 업로드 → **상품 30개** (`item.taobao.com/item.htm?id=...` 유지)
   - 기존 버그: URL에서 `?id=`를 잘라 모든 상품이 `item.htm`으로 뭉개짐 → 수정 완료
   - 파일 업로드 후 결과 페이지 `tab=pic&localImgKey=...`

2. **1688 이미지 검색 △**
   - 이미지 검색 페이지는 열림. 헤더 **검색**을 누르면 키워드 검색으로 이탈해서, 1688은 업로드 후 클릭하지 않음
   - 화로대 장면은 매칭 상품 0개 (빈 결과). 상품 사진이 더 선명하면 나올 수 있음

3. **coupangOneClick 파이프라인**
   - 쿠팡 URL → 이미지/텍스트 검색 → 사람 필터 → 다운로드 → 대본/음성/자막/렌더까지 코드는 연결됨
   - 실제 쿠팡 URL 한 번 붙여서 E2E 확인이 남음

4. **Chrome**: 이미 켜져 있으면 기존 창을 죽이지 않고 DebugProfile 복사본 + CDP 9223 사용

테스트: `npx electron test-imgsearch.js <이미지경로 또는 쿠팡URL>`

### 아키텍처 요약

```
[Electron 앱 (port 9222)]
  ├── main.js — IPC handler, api 라우팅
  ├── preload.js — contextBridge
  ├── src/app.js — 프론트엔드 (coupangOneClick 등)
  └── services/
      ├── api.js — API 엔드포인트 정의
      ├── chromeDriver.js — Chrome CDP 제어 (port 9223, subst Z:)
      ├── socialSearch.js — searchSocial + searchByImage
      ├── coupang.js — 쿠팡 스크래핑
      └── chromeCookies.js — 쿠키 관리

[Chrome (port 9223)]
  └── 실제 사용자 프로필 (subst Z: → User Data)
      ├── TikTok ✓ 로그인
      ├── XHS ✓ 로그인
      ├── Taobao ✓ 로그인
      ├── 1688 ✓ 로그인
      └── Douyin ✗ 로그인 필요
```

### 핵심 기술 메모

- **Chrome CDP 보안 제한**: Chrome은 기본 User Data 디렉토리에서 `--remote-debugging-port`를 거부함. `subst Z: "실제경로"` 가상 드라이브로 우회
- **CDP `/json/new`는 PUT 메서드** 필요 (GET 아님): `cdpPut()` 함수 사용
- **Chrome 프로필**: "main PARK" (Default) 사용, `--profile-directory=Default`
- **1688 상품 URL 패턴**: `dj.1688.com/ci_bb?` 형식 (기존 `detail.1688.com/offer/` 외에 추가)
- **이미지 업로드 CDP**: `DOM.setFileInputFiles` 메서드로 `<input type="file">`에 파일 설정
- **AI 제공자**: Gemini (`ai: "gemini"`)

### 쿠팡 URL 원클릭 흐름 (2026-11-07)

예: `.../vp/products/6542739738?...&q=싱크대 칸막이`

1. 쿠팡에서 **상품 이미지** + URL의 **검색어(싱크대 칸막이)** 추출
2. 검색어를 **중국어**로 번역
3. **샤오홍슈**: 중국어 텍스트로 같은 제품 영상 검색
4. **타오바오·1688**: 쿠팡 이미지로 같은/비슷한 상품을 찾고, 그 상품 페이지에서 **영상**을 가져와 쇼츠 제작

테스트: 싱크대 칸막이 쿠팡 페이지 → 타오바오 이미지 검색 30개(水槽挡水板 등 동일 제품군). 상품 페이지 영상 추출은 후보를 여러 개 확인.

### 다음 단계

1. 앱에서 해당 쿠팡 URL 붙여 전체 원클릭 실행
2. 타오바오 상품 중 영상 있는 페이지 비율 확인
3. 1688 이미지 검색을 선명한 상품 컷으로 재시도
