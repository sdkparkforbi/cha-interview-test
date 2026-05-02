# 면담봇 개발 문서 (학습용)

> 차의과학대학교 경영학전공 박대근 교수 AI 면담봇의 **동작 원리·기술 결정·코드 구조**를 처음부터 이해할 수 있게 정리한 학습 자료.
> 이 문서를 읽으면 비슷한 음성 챗봇을 처음부터 만들 수 있어야 합니다.

---

## 목차
1. [전체 그림](#1-전체-그림)
2. [기술 스택 — 왜 이걸 골랐나](#2-기술-스택--왜-이걸-골랐나)
3. [핵심 시스템 동작 원리](#3-핵심-시스템-동작-원리)
   - 3-1. HeyGen Streaming Avatar
   - 3-2. LiveKit WebRTC
   - 3-3. RAG (bge-m3 + 코사인 유사도)
   - 3-4. Gemma4 프롬프트 엔지니어링
   - 3-5. Web Speech API (STT)
   - 3-6. JWT 인증
   - 3-7. 카카오 OAuth
   - 3-8. SOFT-INTERRUPT (ESC 키 발화 중단)
4. [데이터 흐름 4가지 시나리오](#4-데이터-흐름-4가지-시나리오)
5. [코드 구조 가이드](#5-코드-구조-가이드)
6. [인프라 매핑](#6-인프라-매핑)
7. [운영 매뉴얼](#7-운영-매뉴얼)
8. [트러블슈팅 사례집](#8-트러블슈팅-사례집)
9. [보안 / 개인정보](#9-보안--개인정보)
10. [확장 아이디어](#10-확장-아이디어)

---

## 1. 전체 그림

### 무엇을 만든 건가
- 학생이 **음성/텍스트로 박대근 교수 아바타와 대화**하면서 경영학전공·진로 상담을 받는 웹앱.
- 24시간 운영, 학교 DB에 모든 대화 자동 저장.

### 3개 호스트가 협력하는 분산 구조
```
브라우저 (학생)
   ↓                          ↑
[Vercel]  ─── /api/* ───  [Middleton]   ───── DB ─────  [학교서버]
프론트엔드+프록시          GPU + LLM + RAG               MySQL + PHP
```
- **Vercel**: 정적 파일 + 가벼운 프록시. (HeyGen API key 보호)
- **Middleton**: GPU 8장 위에 Gemma4 + bge-m3 임베딩이 돌아감. PM2로 Express 서버 운영.
- **학교 서버**: Apache + PHP + MySQL. 사용자 인증 + 대화 로그 저장.

이 분리는 의도적임:
- LLM/임베딩은 GPU 필요 → Middleton 전용
- API key·DB password 같은 비밀은 Vercel 환경변수에만 → 클라이언트엔 노출 X
- 학교 자산(DB)은 학교 서버에 → 인수인계가 자연스러움

---

## 2. 기술 스택 — 왜 이걸 골랐나

### 프론트엔드: React + Vite

| | React | 단순 HTML/JS |
|---|---|---|
| 컴포넌트 분리 | ✅ | ❌ |
| Hot Reload | ✅ (Vite) | ❌ |
| 상태 관리 | useState/useEffect | 전역 변수 |
| 빌드 최적화 | ✅ (tree-shaking) | ❌ |

> 금융상품매뉴얼 v1~v3은 단일 HTML 파일에 다 때려박혀서 3000줄짜리 `<script>` 안에서 디버깅이 너무 어려웠음. v5에서 분리하고, 면담봇은 처음부터 React로.

### LLM: **Gemma4** (Ollama)

```
http://127.0.0.1:11435  ← Gemma4 (Ollama)
http://127.0.0.1:11436  ← bge-m3 임베딩 (Ollama)
```

- **왜 Gemma4?** 한국어 품질 OK + finbot 서버에 이미 떠있음 + GPL이라 학교 자산화 가능.
- **왜 Ollama 네이티브 API 안 OpenAI-compat?** OpenAI-compat은 `response_format: json_object` + thinking mode가 충돌해서 빈 응답 발생. 네이티브 `/api/chat` + `think:false` + JSON 정규식 추출이 안정적.

### 임베딩: bge-m3
- **왜?** 한국어 강함, 1024차원, 교수님이 운영하는 RAG 시스템과 동일 모델. 청크 호환성.

### 아바타: **HeyGen v1 streaming**
- HeyGen의 신 플랫폼 LiveAvatar로 마이그레이션 시도 → **교수님 커스텀 아바타가 신 플랫폼에 안 옮겨져 있어서** 실패.
- v1 API는 deprecation notice가 뜨지만 여전히 작동. 마이그레이션 전까지 유지.
- LiveKit Cloud로 WebRTC 송출 → 브라우저에서 비디오/오디오 트랙 attach.

### STT: Web Speech API (`webkitSpeechRecognition`)
- 무료, 한국어(`ko-KR`), continuous 모드 지원.
- 단점: Chrome/Edge 전용 (Safari/Firefox 미지원). Safari 사용자에겐 채팅만.

### DB: 학교 서버 MySQL + PHP API
- finmarket-api 패턴을 그대로 복제(`interview-api/api.php`).
- **왜 학교 서버?** 면담봇은 학교 자산이 될 거라 처음부터 학교 인프라에 둠.
- PHP 5.4.45 사용 중이라 `password_hash()` 못 씀 → `crypt()` 직접 호출로 bcrypt 해시.

### 카톡 인앱 회피
- 카톡 인앱 브라우저는 **마이크/WebRTC 권한 prompt 자체가 안 뜸**.
- UA에서 `KAKAOTALK` 감지 → Android는 `intent://...#Intent;scheme=https;package=com.android.chrome;end` / iOS는 `googlechromes://`로 강제 전환.

---

## 3. 핵심 시스템 동작 원리

### 3-1. HeyGen Streaming Avatar

**3개 API 호출이 한 묶음**:
```
1. POST /v1/streaming.create_token         → JWT (서버 측 호출, key 노출 X)
2. POST /v1/streaming.new                  → session_id + LiveKit URL + access_token
   { avatar_id, voice: { voice_id }, language: 'ko', version: 'v2' }
3. POST /v1/streaming.start                → 아바타 활성
   { session_id }
```

이후:
```
POST /v1/streaming.task        → 아바타에게 텍스트 발화 명령
   { session_id, text, task_type: 'repeat' }   // repeat = 그대로 읽음
POST /v1/streaming.interrupt   → 발화 중단
POST /v1/streaming.stop        → 세션 종료
```

LiveKit 연결은 1번 호출 후 받은 URL/token으로:
```javascript
const room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true })
await room.connect(url, access_token)

room.on(RoomEvent.TrackSubscribed, (track) => {
  // video/audio 트랙이 들어오면 <video> 엘리먼트에 attach
  if (track.kind === 'video' || track.kind === 'audio') {
    track.attach(videoEl)
  }
})

room.on(RoomEvent.DataReceived, (payload) => {
  // 'avatar_start_talking', 'avatar_stop_talking' 같은 메타 이벤트
  const msg = JSON.parse(new TextDecoder().decode(payload))
  if (msg.type === 'avatar_start_talking') setStatus('speaking')
})
```

**왜 audio 트랙도 attach 해야 하나?** Video만 attach하면 입은 움직이는데 소리가 안 남. 둘 다 같은 `<video>` 엘리먼트에 attach해야 함.

### 3-2. LiveKit WebRTC

LiveKit은 WebRTC SFU(Selective Forwarding Unit). HeyGen이 SFU 클라이언트 토큰을 우리에게 발급해 줌. 우리는 그 토큰으로 LiveKit Cloud에 join → HeyGen이 같은 room에 publish하는 트랙을 subscribe.

이게 왜 좋은가:
- **WebRTC P2P**보다 안정적 (NAT 통과 문제 X)
- **서버 부담 X** — 우리가 SFU 인프라 안 들고 있어도 됨
- **DataChannel**로 메타 이벤트 송수신 (avatar_start_talking 등)

### 3-3. RAG (bge-m3 + 코사인 유사도)

#### 사전 준비 (한 번만)
```
1. 청크 작성 (rag_chunks.jsonl, 37개)
2. 각 청크의 embedding_text를 bge-m3로 임베딩 (1024차원 벡터)
3. 정규화 (L2 norm = 1) → 코사인 유사도를 내적으로 계산 가능
4. JSON 파일로 저장
```

#### 검색 (질문 들어올 때마다)
```javascript
async function retrieve(query, topK = 5, minScore = 0.25) {
  const qvec = await embed(query)               // 질문도 같은 모델로 임베딩
  const scored = embeds.map((evec, i) => ({
    chunk: chunks[i],
    score: dotProduct(qvec, evec)               // 정규화된 벡터의 내적 = cos similarity
  }))
  return scored
    .filter(x => x.score >= minScore)            // 최소 점수 컷
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)                              // top-K 반환
}
```

#### 왜 minScore = 0.25?
- bge-m3는 한국어 짧은 질문에서 코사인이 0.3~0.5 범위로 나오는 경향.
- 0.35로 잡으면 50% 이상이 컷됨 → RAG 컨텍스트가 빈 채 LLM이 답변 → 일반적 답변 ("어떤 점이 궁금한가요?").
- 0.25로 낮추되 LLM 시스템 프롬프트에 **"관련 없는 항목은 무시"** 지시 추가 → 매칭 풀은 풍부, LLM이 알아서 골라 씀.

#### 왜 top-K = 5?
- 상위 1개만 주면 보조 정보가 없어 답변이 빈약.
- 5개를 주면 LLM이 교차 참조하여 풍부한 답변 생성.
- 너무 많으면(>10) 컨텍스트 길이 늘어 latency 증가 + 무관한 정보로 혼란.

### 3-4. Gemma4 프롬프트 엔지니어링

```javascript
const messages = [
  { role: 'system', content: systemPrompt },    // 역할 + RAG 컨텍스트 + 출력 형식 + 금지사항
  ...history.slice(-8),                         // 최근 8턴 (cost vs context 절충)
  { role: 'user', content: message }
]
```

**시스템 프롬프트 4가지 핵심**:
1. **역할** — "박대근 교수의 AI 면담 어시스턴트" + 해요체
2. **RAG 컨텍스트** — top-5 청크를 `[섹션] Q: ... A: ...` 포맷으로 주입
3. **JSON 출력 강제** — `{"reply":"...","ttsReply":"..."}` 형식만
4. **금지사항** — 이모지/장식 기호 (TTS가 잘못 읽음), 추측 답변 (RAG에 없으면 "교수님께 직접 여쭤보세요")

**왜 reply / ttsReply 분리?**
- `reply`: 채팅창에 표시 (한글 그대로)
- `ttsReply`: 아바타가 발화 (숫자→한글, 약어→발음으로 변환). 예: "AI" → "에이아이", "20명" → "스무 명"
- TTS가 영어/숫자를 어색하게 읽기 때문.

**Ollama 호출 옵션**:
```javascript
{
  model: 'gemma4:latest',
  messages,
  stream: false,
  think: false,                    // thinking mode 끔 (켜면 빈 응답 가끔)
  options: {
    num_predict: 400,              // 답변 길이 제한
    temperature: 0.7
  }
}
```

**JSON 추출 (모델이 가끔 앞뒤에 텍스트 붙임)**:
```javascript
const raw = data.message.content.trim()
  .replace(/^```json\s*/i, '').replace(/```\s*$/, '')

const jsonMatch = raw.match(/\{[\s\S]*"reply"[\s\S]*\}/)
const parsed = JSON.parse(jsonMatch[0])
```

**후처리 — 이모지 strip**:
```javascript
function stripEmoji(s) {
  return s.replace(/[\u{1F300}-\u{1FAFF}]/gu, '')   // 픽토그램·이모지
          .replace(/[\u{2600}-\u{27BF}]/gu, '')     // 기타 심볼
          .replace(/[\u{FE0F}]/gu, '')              // variation selector
          .trim()
}
```
모델이 시스템 프롬프트의 "이모지 금지" 무시하는 경우 대비. `😊` → TTS가 "옷"으로 발음하는 사고 방지.

### 3-5. Web Speech API (STT)

```javascript
const SR = window.SpeechRecognition || window.webkitSpeechRecognition
const rec = new SR()
rec.lang            = 'ko-KR'
rec.interimResults  = true       // 중간 결과 받음 (interim)
rec.continuous      = true       // 자동 종료 X
rec.maxAlternatives = 1

rec.onresult = (event) => {
  let interim = '', final = ''
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const t = event.results[i][0].transcript
    if (event.results[i].isFinal) final += t
    else interim += t
  }

  if (final.trim()) {
    sendMessage(final.trim())   // 확정 결과 → 즉시 전송
  } else if (interim) {
    // 중간 결과 → 2초 무음 후 전송 (사용자가 멈추면 전송)
    silenceTimer = setTimeout(() => sendMessage(interim.trim()), 2000)
  }
}

rec.onend = () => {
  // 자동 종료되면 다시 시작 (continuous mode로도 종종 끝남)
  if (autoListen) setTimeout(() => rec.start(), 600)
}
```

**중요한 함정**:
1. **마이크 권한** — `rec.start()`는 반드시 **사용자 클릭 핸들러 안에서** 호출해야 권한 prompt가 뜸. 첫 사용자 클릭("아바타 시작")을 활용.
2. **`onend` 자동 재시작** — `continuous: true`여도 브라우저가 종종 종료시킴. `onend`에서 다시 `start()` 호출.
3. **중간 결과 전송** — final만 기다리면 사용자가 망설일 때 무한 대기. interim + 2초 timeout이 트레이드오프.

### 3-6. JWT 인증

```
[클라이언트]                    [PHP API]
  email + password              ─→  email_login
                                     ↓
                                pwVerify(pw, hash)  // crypt() 기반 bcrypt
                                     ↓
                                createJWT(user.id)
                                {
                                  header:  base64({alg:'HS256'}),
                                  payload: base64({user_id, exp}),
                                  sig:     base64(hmac_sha256(header.payload, SECRET))
                                }
                                ←
  ← token, user
  localStorage 저장

  // 이후 요청마다 token 동봉
  → POST?action=save_chat
    { token, session_id, role, message }
                                ─→ verifyJWT(token)
                                   sig 비교 + exp 체크
                                   → user_id 추출
                                   → INSERT chat_logs (user_id, ...)
```

**왜 JWT?** 서버에 세션 저장 안 해도 됨 (stateless). PHP API가 무상태.

**보안 주의**:
- `JWT_SECRET`은 PHP 파일 안에 평문 (server-side만 노출). git에는 올라가면 안 됨 — 우리는 `.env` 파일 따로 두지 않고 PHP에 직접 박았는데, 운영팀 인수인계 시 환경변수로 옮기는 게 권장.
- `password_hash` PHP 5.5+ 함수가 학교 서버(5.4.45)에 없어서 `crypt()` + `openssl_random_pseudo_bytes()`로 자체 bcrypt 함수 작성 (PHP 5.4 호환).

### 3-7. 카카오 OAuth

```
[브라우저]                                 [Kakao]                  [PHP API]
Kakao.Auth.login()
  └─ 카카오 로그인 팝업 (사용자 동의)  ─→  redirect → access_token
Kakao.API.request('/v2/user/me')          ─→  사용자 정보 (id, nickname, email)
  ↓
kakaoLogin(kakao_id, nickname, email)     ─────────────────────────→  action=kakao_login
                                                                       ↓
                                                                    SELECT * FROM users
                                                                    WHERE kakao_id = ?
                                                                       ↓
                                                                    있으면 UPDATE / 없으면 INSERT
                                                                       ↓
                                                                    createJWT()
                                          ←─────────────────────────  { token, user }
```

**JS 키 재사용 전략**: OAC(`/ui/index.html`)가 이미 등록한 카카오 앱 키 (`fc0a1313d895b1956f3830e5bf14307b`)를 그대로 사용. 새 앱 등록·승인 절차 생략. 도메인은 카카오 디벨로퍼 콘솔에 추가만 하면 됨.

### 3-8. SOFT-INTERRUPT (ESC 키 발화 중단)

OpenAvatarChat의 규성 패턴 차용:

```javascript
useEffect(() => {
  const handleGlobalKeydown = (e) => {
    if (e.key !== 'Escape' && e.code !== 'Escape') return
    if (!isSpeakingRef.current) return       // 발화 중일 때만
    e.preventDefault()
    e.stopPropagation()
    // textarea/input 포커스 중에도 작동 (다음 입력 방해 방지)
    const target = e.target
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
      target.blur()
    }
    interruptAvatar()                         // POST /v1/streaming.interrupt
  }

  // window + document 양쪽에 capture phase 등록 (브라우저별 누락 방어)
  window.addEventListener('keydown', handleGlobalKeydown, true)
  document.addEventListener('keydown', handleGlobalKeydown, true)
  return () => {
    window.removeEventListener('keydown', handleGlobalKeydown, true)
    document.removeEventListener('keydown', handleGlobalKeydown, true)
  }
}, [interruptAvatar])
```

**왜 echo 기반 자동 interrupt 대신 ESC?**
- 헤드폰 미사용 시 아바타 음성이 마이크로 다시 들어옴 → STT가 사용자 발화로 오인 → 자기 자신 interrupt → 발화가 시작하자마자 끊김.
- ESC는 명시적 액션이라 false trigger 0%.

**향후 음성 VAD interrupt 추가 시** (RMS 기반):
- 마이크 스트림에 `AnalyserNode` attach → RMS 측정
- 봇 발화 중(`avatar_start_talking` ~ `avatar_stop_talking`) 활성
- RMS > 임계값(0.05)이 N 프레임 연속이면 trigger
- OAC `patchVoiceInterrupt` 패턴 참고 (`/c/dev/Server_LLM/docs/oac_index_with_kakao.html`)

---

## 4. 데이터 흐름 4가지 시나리오

### 4-1. 첫 접속
```
1. 브라우저: index.html 로드
   ├─ 카톡 인앱 감지 → Chrome으로 강제 전환 (즉시 실행)
   └─ Kakao.init() (DOMContentLoaded)
2. App.jsx mount
   ├─ getUser() → localStorage에 user 있으면 setUser
   └─ verifyToken() → 서버에 token 검증
       ├─ 성공: setUser, 모달 닫음
       └─ 실패: clearAuth, 모달 자동 띄움
3. 사용자 액션:
   ├─ 카카오 로그인 → Kakao.Auth → /v2/user/me → action=kakao_login → JWT
   ├─ 이메일 가입/로그인 → action=email_signup/login → JWT
   └─ 게스트 → onClose만, user=null 유지
```

### 4-2. 아바타 시작
```
1. "아바타 시작" 클릭 (사용자 클릭 컨텍스트 — 마이크 권한 요청 가능)
2. Vercel /api/heygen-token → HeyGen JWT
3. Vercel /api/heygen-proxy(streaming.new) → session
4. new Room() → connect(url, access_token)
   ├─ TrackSubscribed 핸들러: video/audio 트랙 attach
   └─ DataReceived 핸들러: avatar_start/stop_talking 메타 이벤트
5. Vercel /api/heygen-proxy(streaming.start) → 아바타 활성
6. newSessionId() = "sess_171xxx_yyy" (이번 대화 식별자)
7. 인사말:
   ├─ setMessages([{role:'assistant', text: greeting}])  → 채팅 표시
   ├─ saveChat(sid, 'assistant', greeting) → 학교 DB 저장
   └─ setTimeout(800ms) → callProxy('streaming.task', {text: greetingTts}) → 아바타 발화
8. SpeechRecognition.start() → 마이크 권한 prompt → 자동 ON
```

### 4-3. 사용자 질문 (음성 또는 텍스트)
```
[음성 인식 final 또는 채팅 Enter]
  ↓
sendMessage(text)
  ├─ setMessages: 사용자 메시지 추가, 어시스턴트 typing(...)
  ├─ historyRef: history 배열에 push
  └─ saveChat(sid, 'user', text)  → 학교 DB
  ↓
fetch('/api/chat', { message, history: history.slice(-8) })
  ↓ Vercel
fetch('https://middleton.p-e.kr/finbot/api/interview-chat', ...)
  ↓ Middleton
1. retrieve(message, 5, 0.25)
   ├─ embed(message) → 1024차원 벡터
   ├─ chunks 37개와 코사인 유사도 계산
   └─ score >= 0.25, top-5 반환
2. buildSystemPrompt(hits) → 컨텍스트 주입
3. fetch(Ollama /api/chat)
   ├─ messages: [system, ...history, user]
   └─ {model, stream:false, think:false, options: {num_predict:400, temperature:0.7}}
4. JSON 추출 (정규식 + try/catch)
5. stripEmoji(reply, ttsReply)
6. 응답 {reply, ttsReply}
  ↓
App.jsx
  ├─ setMessages: 어시스턴트 메시지 채움 (typing → reply)
  ├─ saveChat(sid, 'assistant', reply) → 학교 DB
  └─ callProxy('streaming.task', {text: ttsReply}) → 아바타 발화
```

### 4-4. 발화 중단 (ESC)
```
ESC keydown (window/document capture phase)
  ↓
handleGlobalKeydown
  ├─ ESC 맞음 ✓
  ├─ status === 'speaking' ✓
  ├─ preventDefault + stopPropagation
  ├─ textarea/input 포커스면 blur
  └─ interruptAvatar()
       ├─ callProxy('streaming.interrupt', {session_id})
       └─ setStatus('connected')
  ↓
LiveKit DataReceived: avatar_stop_talking
  ↓
useEffect: !isProcessing && autoListen → startListening (마이크 자동 ON)
```

---

## 5. 코드 구조 가이드

### 프론트엔드 (`cha-interview-bot/`)

```
index.html
  ├─ <meta viewport> + <title>
  ├─ <script>(IIFE) 카톡 인앱 → Chrome 전환  ← 가장 먼저 실행
  ├─ <script src="livekit-client.umd.min.js">
  └─ <script src="kakao.min.js"> + Kakao.init()

src/
  main.jsx                  ← React DOM 마운트만
  App.jsx                   ← 메인 상태 관리 + HeyGen + STT + 메시지 라우팅
  App.module.css            ← flex layout (모바일 column)
  index.css                 ← 전역 변수 (--gold, --text 등)

  components/
    AvatarPanel.jsx/css     ← 비디오 + 시작/종료 버튼 + 상태 배지
    ChatPanel.jsx/css       ← 메시지 리스트 + 입력창 + 마이크 버튼
    AuthModal.jsx/css       ← 카카오/이메일/게스트 로그인 (v5 패턴)

  lib/
    api.js                  ← 학교 PHP API 클라이언트 + Kakao SDK 래핑

api/                        ← Vercel Serverless Functions
  heygen-token.js           ← HEYGEN_API_KEY로 JWT 발급
  heygen-proxy.js           ← /v1/streaming.* 프록시 (key 보호)
  chat.js                   ← Middleton interview-chat으로 단순 프록시
```

### Middleton (`/home/student04/finbot/server/`)

```
index.js                    ← Express 부트스트랩 + CORS + 라우트 등록
routes/
  interview-chat.js         ← RAG 검색 + Gemma4 호출 + JSON 추출 + 이모지 strip
utils/
  cha-rag.js                ← 임베딩(Ollama bge-m3) + 코사인 유사도 검색
data/
  cha_rag_chunks.json       ← 37 청크 (메타: id, section, question, answer, keywords)
  cha_rag_embeddings.json   ← 37 × 1024 정규화 벡터
```

### 학교 서버 (`/var/www/html/interview-api/`)

```
api.php                     ← 액션 기반 라우팅 + JWT + bcrypt(crypt) + PDO MySQL
                              actions: health, kakao_login, email_signup,
                                       email_login, verify, save_chat, list_chats
```

### 핵심 함수 위치

| 동작 | 어디에 |
|---|---|
| HeyGen 세션 시작 | `App.jsx → startAvatar()` |
| HeyGen 세션 종료 | `App.jsx → stopAvatar()` |
| 메시지 전송 + 발화 | `App.jsx → sendMessage()` |
| 발화 중단 | `App.jsx → interruptAvatar()` |
| ESC 핸들러 | `App.jsx → useEffect` |
| STT 초기화 | `App.jsx → initRecognition()` |
| RAG 검색 | `cha-rag.js → retrieve()` |
| Gemma4 호출 + JSON 추출 | `interview-chat.js → router.post()` |
| 이모지 제거 | `interview-chat.js → stripEmoji()` |
| 카카오 로그인 흐름 | `api.js → startKakaoLogin()` |
| JWT 검증 | `api.php → verifyJWT()` |

---

## 6. 인프라 매핑

| 계층 | 위치 | 호스트 | 포트/경로 | 인증 |
|---|---|---|---|---|
| 프론트엔드 | Vercel | `cha-interview-bot.vercel.app` | 443 | — |
| Vercel API | Vercel | 위 + `/api/*` | 443 | env `HEYGEN_API_KEY` |
| LLM 서버 | Middleton GPU | `1.223.219.123:7822` SSH | PM2 `finbot-server` (9000) | `student04 / chacha2025` |
| nginx | Middleton | `middleton.p-e.kr/finbot/*` | 443 | — |
| Gemma4 | Middleton | Ollama | `127.0.0.1:11435` | — (loopback) |
| bge-m3 | Middleton | Ollama | `127.0.0.1:11436` | — (loopback) |
| DB 서버 | 학교 | `aiforalab.com` (`106.247.236.2:10022` SSH) | MySQL 3306 + Apache 80/443 | `user2 / user2!!` |
| PHP API | 학교 | `/var/www/html/interview-api/` | `https://aiforalab.com/interview-api/api.php` | JWT (HS256) |
| HeyGen | HeyGen Cloud | `api.heygen.com/v1/*` | 443 | API Key (Vercel env) |
| LiveKit | HeyGen → LiveKit Cloud | 동적 URL | WSS | 동적 access_token |
| 카카오 | Kakao Developers | `kapi.kakao.com` | 443 | JS Key (`fc0a13...`) |

---

## 7. 운영 매뉴얼

### 면담봇 재배포
```bash
cd C:\dev\cha-interview-bot
npm run build           # dist/ 갱신
git add -A && git commit -m "..." && git push origin master
# → Vercel 자동 배포 (1~2분)
```

### Middleton 서버 (LLM/RAG) 재시작
```bash
ssh -p 7822 student04@1.223.219.123
export NVM_DIR=/home/student04/.nvm && . /home/student04/.nvm/nvm.sh
pm2 restart finbot-server
pm2 logs finbot-server --lines 50
```

⚠️ 주의: PM2 restart 시 `cha-rag.js`의 모듈-스코프 캐시(`_chunks`, `_embeds`)가 reset되어 새 RAG 데이터가 반영됨. RAG 파일만 바꾼 경우에도 PM2 restart 필요.

### RAG 청크 추가/수정
```bash
# 1. 로컬에서 새 청크 jsonl 작성
# 형식: {"id":"ch-XXX", "section":"...", "question":"...", "answer":"...",
#        "keywords":[...], "embedding_text":"질문: ... 답변: ..."}

# 2. 서버에 업로드
pscp -P 7822 new_chunks.jsonl student04@1.223.219.123:/tmp/

# 3. add_to_rag.js 실행 (자동 백업됨)
ssh student04@... "node ./server/scripts/add_to_rag.js /tmp/new_chunks.jsonl"

# 4. PM2 restart
pm2 restart finbot-server
```

### 학교 DB 조회
```bash
ssh -p 10022 user2@106.247.236.2
mysql -u user2 -puser2!! cha_interview_db

# 사용자 목록
SELECT id, name, email, kakao_id, visit_count, last_login FROM users;

# 최근 50개 메시지
SELECT user_id, session_id, role, LEFT(message, 80), created_at
FROM chat_logs ORDER BY created_at DESC LIMIT 50;

# 특정 사용자의 전체 대화
SELECT session_id, role, message, created_at
FROM chat_logs WHERE user_id = 1
ORDER BY created_at;

# 자주 묻는 질문 분석 (간단 word count)
SELECT message, COUNT(*) FROM chat_logs WHERE role='user' GROUP BY message ORDER BY COUNT(*) DESC LIMIT 20;
```

### 학교 PHP API 수정
```bash
# 로컬에서 수정 후
pscp -P 10022 server/api.php user2@106.247.236.2:/tmp/
ssh -p 10022 user2@... "echo 'user2!!' | sudo -S cp /tmp/api.php /var/www/html/interview-api/api.php"
```

### Vercel 환경변수 변경
- Vercel Dashboard → cha-interview-bot 프로젝트 → Settings → Environment Variables
- 변경 후 자동 재배포 트리거 (또는 Deployments에서 redeploy)

---

## 8. 트러블슈팅 사례집

### 8-1. HeyGen 비디오가 안 뜸 (status는 "연결됨")

**원인**: 3가지 동시 문제
1. `streaming.new` 페이로드에 `avatar_name` 사용 (구 키, 신 API는 `avatar_id`)
2. `streaming.start`에 `sdp` 포함 (v1 LiveKit 모드는 session_id만 필요)
3. video 트랙만 attach, audio 트랙은 무시

**진단법**: LiveKit `TrackSubscribed` 이벤트가 firing하는지 console.log. 했지만 video tag opacity가 0. → setVideoReady 안 불림.

**해결**:
```javascript
{ avatar_id: AVATAR_ID, ..., language: 'ko', version: 'v2', video_encoding: 'H264' }
callProxy('streaming.start', { session_id })   // sdp 제거
room.on(RoomEvent.TrackSubscribed, (track) => {
  if ((track.kind === 'video' || track.kind === 'audio') && videoRef.current) {
    track.attach(videoRef.current)
    if (track.kind === 'video') setVideoReady(true)
  }
})
```

### 8-2. RAG 매칭 결과가 다 무관함 (혹은 빈 컨텍스트)

**진단 단계**:
1. PHP API curl 테스트 → 답변이 일반적
2. Middleton에서 직접 retrieve() 호출 → 정상 매칭됨
3. PM2 로그 확인 → `Q: ��������������?` (한글 깨짐!)
4. JSON 파일로 호출 → 정상

**원인**: Git Bash에서 `curl -d '{"message":"한국어"}'`로 호출 시 인코딩이 깨짐. **실제 브라우저는 fetch API로 UTF-8 보존**되므로 production에선 문제 없음. 테스트 방법의 한계.

**보너스 발견**: `minScore = 0.35`가 너무 빡빡해서 정상 한글 질문도 50% 컷됨. 0.25로 낮추고 top-K 3 → 5로 늘림.

### 8-3. PHP 500 Internal Server Error (회원가입)

**원인**: 학교 서버 PHP 5.4.45. `password_hash()`는 5.5+ 함수.

**해결**: PHP 5.4 호환 bcrypt 자체 구현
```php
function pwHash($password) {
    $bytes = openssl_random_pseudo_bytes(16);
    $b64 = strtr(rtrim(base64_encode($bytes), '='), '+', '.');
    $salt = '$2y$10$' . substr($b64, 0, 22);
    return crypt($password, $salt);    // PHP 5.4도 bcrypt 지원
}
function pwVerify($password, $hash) {
    return hash_equals($hash, crypt($password, $hash));
}
```

### 8-4. 이모지가 TTS에서 "옷"으로 발음됨

**원인**: `😊` 이모지를 HeyGen TTS가 한글로 잘못 음역.

**해결 2단**:
1. 시스템 프롬프트: "이모지/픽토그램 절대 사용 금지"
2. 응답 후처리: 픽토그램 전체 유니코드 블록 strip (`\u{1F300}-\u{1FAFF}` 등)

### 8-5. 카톡 인앱에서 마이크/WebRTC 안 됨

**원인**: 카톡 in-app은 미디어 권한 prompt를 막음.

**해결**: UA 감지 → Chrome으로 강제 전환
```javascript
if (/KAKAOTALK/i.test(navigator.userAgent)) {
  if (/Android/i.test(ua)) {
    location.href = 'intent://' + url.replace(/https?:\/\//, '') +
      '#Intent;scheme=https;package=com.android.chrome;end'
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    location.href = 'googlechromes://' + url.replace(/https?:\/\//, '')
    setTimeout(() => location.href = url, 1000)   // 실패 fallback
  }
}
```
패턴 출처: `cha-biz-ai-v11/public/index.html`.

### 8-6. 음성 echo로 자기 발화 자동 interrupt

**원인**: HeyGen 아바타 음성이 스피커로 나가 → 마이크가 다시 받음 → STT가 사용자 발화로 오인 → 자동 `streaming.interrupt` → 발화가 시작하자마자 끊김.

**해결**:
1. STT `onresult`의 echo 기반 자동 interrupt 코드 제거
2. **ESC 키 명시적 interrupt** 도입 (OAC 패턴 그대로)

향후 음성 VAD interrupt 추가 시 RMS 기반(헤드폰 권장 가이드 필수).

### 8-7. iOS 모바일 100vh가 화면 밖으로 잘림

**원인**: iOS Safari의 `100vh`는 주소창 높이까지 포함. 실제 보이는 영역은 더 작음.

**해결**: `100dvh` (dynamic viewport height) 사용
```css
.app {
  height: 100vh;     /* fallback */
  height: 100dvh;    /* 모던 브라우저는 이게 적용 */
}
```

추가로 iOS 홈 인디케이터 영역:
```css
.inputArea {
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
}
```

---

## 9. 보안 / 개인정보

### 수집 항목
- 이름 (이메일 가입 시) 또는 카카오 닉네임
- 이메일 (이메일 가입 시 또는 카카오 동의 시)
- 카카오 ID (해시 같은 정수, 카카오 로그인 시)
- 비밀번호 — bcrypt 단방향 해시 (평문 미저장)
- 대화 메시지 + RAG 매칭 결과

### 동의 절차
- AuthModal에 동의 체크박스 3개:
  - 카카오 정보 제공 (필수)
  - 개인정보 수집 (필수, 수집항목·목적·보유기간 명시)
  - 마케팅 (선택, 현재 DB 컬럼 없음 — 추가 시 ALTER 필요)
- 필수 동의 없으면 카카오/이메일 로그인 버튼 비활성

### 토큰 관리
- JWT HS256, 7일 유효
- localStorage에 token + user 저장
- 첫 방문 시 verifyToken으로 서버에 검증, 실패 시 자동 clearAuth

### CORS 제한
- PHP API `allowed_origins` 배열에 `cha-interview-bot.vercel.app` + 로컬 개발 도메인만
- Middleton finbot도 CORS에 위 도메인 등록

### 익명 사용
- 토큰 없는 사용자도 `chat_logs`에 `user_id NULL`로 저장 (서비스 통계 용)
- 게스트 모드는 로그인 없이도 봇 사용 가능

### 보안 권장 (TODO)
- `JWT_SECRET`을 PHP 파일 → 환경변수로 옮기기
- DB 비밀번호도 환경변수
- HTTPS 강제 리다이렉트 확인
- Rate limiting (현재 없음 — 학교 내부 사용이라 우선순위 낮음)

---

## 10. 확장 아이디어

### 단기 (1주일 안)
- **음성 VAD interrupt** — OAC `patchVoiceInterrupt` 패턴 차용. 헤드폰 권장 가이드 같이.
- **OG 메타태그** — 카톡 미리보기 썸네일. nginx `sub_filter`로 OAC 응답에 주입.
- **카카오 동의 후 사용자 정보 더 받기** — 학번·전공 같은 항목 추가 (선택 동의)
- **관리자 대시보드** — `list_chats` 확장. 최근 질문 통계, 자주 묻는 질문 클러스터링.

### 중기 (1달 안)
- **STS (Speech-to-Speech) 모드** — 채팅 단계 건너뛰고 음성 → 음성 직접 변환. 응답 latency 단축.
- **자체 voice 다양화** — 박대근 교수 실제 음성으로 voice cloning (Humelo DIVE 같은 KR TTS).
- **RAG 자동 갱신 파이프라인** — 학과 공지 페이지 크롤링 → 새 청크 자동 임베딩 → 추가.
- **다국어 지원** — 외국인 학생용 (글로벌비즈니스AI 전공 108명). bge-m3는 다국어 임베딩 강함.

### 장기 (3달 이상)
- **다른 학과로 확장** — 의예/약대/간호 등 학과별 봇 인스턴스. 같은 인프라 위에서 RAG만 교체.
- **학생 프로파일링** — 누적 대화에서 관심사 분석 → 맞춤 진로 추천.
- **교수 음성 인터뷰 새 콘텐츠 자동 RAG화** — 영상 → STT → 청크화 → 임베딩 → 추가 (자동화).

---

_v1.0 — 2026-05-02_
_관련 문서: `docs/DEVLOG.md` (시간순 개발 일지)_
