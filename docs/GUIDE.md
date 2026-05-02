# 면담봇 개발 문서 (학습용)

> **차의과학대학교 미래융합대학 박대근 교수 AI 면담봇** — 동작 원리·코드·인프라를 처음부터 끝까지 이해할 수 있게 정리한 학습 자료입니다.
> 이 문서를 읽으면 같은 구조의 음성 챗봇을 직접 만들 수 있어야 합니다.
>
> 🌐 운영 URL: https://cha-interview-bot.vercel.app
> 📦 GitHub: https://github.com/sungbongju/cha-interview-bot
> 📝 시간순 일지: [DEVLOG.md](./DEVLOG.md)

---

## 목차
1. [이 봇은 무엇인가](#1-이-봇은-무엇인가)
2. [한눈에 보는 아키텍처](#2-한눈에-보는-아키텍처)
3. [기술 스택 — 무엇을 왜](#3-기술-스택--무엇을-왜)
4. [핵심 시스템 9개 — 동작 원리](#4-핵심-시스템-9개--동작-원리)
   - 4-1. 카톡 인앱 회피
   - 4-2. 학교 DB · 인증 (JWT + bcrypt)
   - 4-3. 카카오 OAuth
   - 4-4. HeyGen Streaming Avatar
   - 4-5. LiveKit WebRTC
   - 4-6. RAG (bge-m3 + 코사인 유사도)
   - 4-7. Gemma4 프롬프트 엔지니어링
   - 4-8. Web Speech API STT + Echo 3중 가드
   - 4-9. SOFT-INTERRUPT (ESC 키)
5. [사용자 시나리오 5개](#5-사용자-시나리오-5개)
6. [코드 구조 + 핵심 파일 가이드](#6-코드-구조--핵심-파일-가이드)
7. [인프라 매핑](#7-인프라-매핑)
8. [운영 매뉴얼](#8-운영-매뉴얼)
9. [트러블슈팅 사례집 (8건)](#9-트러블슈팅-사례집-8건)
10. [보안 / 개인정보](#10-보안--개인정보)
11. [확장 아이디어](#11-확장-아이디어)

---

## 1. 이 봇은 무엇인가

### 사용자 관점
1. 학생이 https://cha-interview-bot.vercel.app 접속
2. 카톡에서 클릭한 거면 자동으로 Chrome/Safari로 전환
3. 로그인 모달 자동 (카카오 / 이메일 / 게스트)
4. "아바타 시작" → 박대근 교수 영상 + 인사말 음성
5. 마이크 권한 자동 요청 → 허용 시 음성 대화 가능 (채팅 입력도 OK)
6. 질문 → Gemma4가 RAG로 풍부한 답변 → 아바타가 발화
7. 답변 도중 끊고 싶으면 ESC
8. 끝낼 때 "대화 종료" 버튼

### 기술적으로 본 본질
- **음성 인터페이스가 붙은 RAG 챗봇**
- LLM(Gemma4) + 임베딩(bge-m3) → 9개 전공 82청크에서 검색
- 답변을 HeyGen 아바타가 LiveKit WebRTC로 송출
- 모든 대화는 학교 MySQL에 저장 (학생 분석용)

---

## 2. 한눈에 보는 아키텍처

```
┌─────────────────────── 학생 브라우저 ───────────────────────┐
│  React (Vite) + LiveKit Client + Kakao SDK                │
│  ├─ AvatarPanel: HeyGen 영상 + 시작/종료 버튼              │
│  ├─ ChatPanel: 메시지 + 텍스트 입력 + 마이크 + 로그인 버튼  │
│  ├─ AuthModal: 카카오/이메일/게스트                       │
│  └─ App.jsx: 상태 관리·STT·세션·인터럽트                  │
└────────────────────────┬───────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   /api/heygen-*    /api/chat        직접 호출
        ↓                ↓                ↓
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│ Vercel       │ │ Middleton    │ │ 학교 서버 (PHP)  │
│ Serverless   │ │ (PM2 finbot) │ │ aiforalab.com    │
│              │ │              │ │                  │
│ HeyGen API   │ │ RAG + Gemma4 │ │ users·chat_logs  │
│ key 보호     │ │ Ollama 11435 │ │ JWT + bcrypt     │
│              │ │ bge-m3 11436 │ │                  │
└──────┬───────┘ └──────────────┘ └──────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│ HeyGen Cloud → LiveKit Cloud (WebRTC)│
└──────────────────────────────────────┘
```

### 분산의 의도
| 호스트 | 역할 | 왜 거기 |
|---|---|---|
| **Vercel** | 정적 + serverless | 정적 호스팅 무료 + GitHub push 자동 배포 + API key 환경변수 보호 |
| **Middleton** | LLM + 임베딩 | GPU 8장 보유 (RTX 3090 ×8). Ollama 모델 운영. PM2로 finbot Express 서버 |
| **학교 서버** | DB + 인증 | 학교 운영팀 인수인계 자연스러움 + 기존 finmarket-api 인프라 재활용 |

---

## 3. 기술 스택 — 무엇을 왜

| 레이어 | 선택 | 왜 |
|---|---|---|
| **프레임워크** | React + Vite | 컴포넌트 분리·hot reload. 단일 HTML 파일의 유지보수 지옥 회피 |
| **호스팅** | Vercel | 정적 + Serverless Function 동시 지원. GitHub master push만으로 자동 배포 |
| **LLM** | Gemma4 (Ollama) | finbot 서버에 이미 운영 중, 한국어 OK, 학교 자산화 가능 |
| **임베딩** | bge-m3 | 1024차원, 한국어 강함, 교수님 RAG 시스템과 동일 모델 |
| **아바타** | HeyGen v1 streaming | 교수님 커스텀 아바타가 신 LiveAvatar 플랫폼에 미마이그레이션 → v1 잔류 |
| **TTS Voice** | HeyGen 내장 (`15d1280...`) | 금융상품매뉴얼 v1 검증된 한국어 voice |
| **STT** | Web Speech API | 무료, ko-KR, 추가 의존성 없음 (Chrome/Edge) |
| **DB** | MySQL (학교 서버) | 기존 finmarket-api 인프라 재활용 |
| **인증** | JWT (HS256) + bcrypt | 무상태(stateless), PHP 5.4 호환 위해 `crypt()` 사용 |
| **카카오 SDK** | OAC와 동일 JS Key | 새 앱 등록·승인 절차 생략 |
| **카톡 인앱 회피** | `KAKAOTALK` UA 감지 → intent/openExternal | cha-biz-ai-v11에서 검증된 패턴 |
| **인터럽트** | ESC 키 | OAC 규성 SOFT-INTERRUPT 패턴. echo 자동 트리거 회피 |

---

## 4. 핵심 시스템 9개 — 동작 원리

### 4-1. 카톡 인앱 회피

**문제**: 카톡 인앱 브라우저는 마이크/WebRTC 권한 prompt 자체를 막음.

**해결**: `index.html` 최상단 IIFE로 UA 감지 → 외부 브라우저 강제 전환.

```javascript
// index.html
(function(){
  var ua = navigator.userAgent || '';
  if (/KAKAOTALK/i.test(ua)) {
    var currentUrl = location.href;

    // Android: Chrome으로 intent
    if (/Android/i.test(ua)) {
      location.href = 'intent://' + currentUrl.replace(/https?:\/\//, '') +
        '#Intent;scheme=https;package=com.android.chrome;end';
      return;
    }

    // iOS: 카톡 자체 외부 브라우저 스킴 (시스템 기본 = Safari)
    if (/iPhone|iPad|iPod/i.test(ua)) {
      location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(currentUrl);
      return;
    }
  }
})();
```

핵심:
- **IIFE로 head에서 즉시 실행** — React 로드 전에
- **Android intent**: Chrome 패키지 명시
- **iOS**: `kakaotalk://web/openExternal`이 가장 안정적 (이전 `googlechromes://`보다 호환성 ↑)

### 4-2. 학교 DB · 인증 (JWT + bcrypt)

**DB 스키마** (`cha_interview_db`):
```sql
users (
  id, kakao_id, email, password_hash, name,
  visit_count, last_login, created_at
)

chat_logs (
  id, user_id NULL, session_id, role ENUM('user','assistant'),
  message TEXT, rag_hits TEXT, created_at
)
```

**JWT 생성/검증** (PHP 5.4 호환):
```php
function createJWT($userId, $secret) {
  $header  = base64_encode(json_encode(['typ'=>'JWT','alg'=>'HS256']));
  $payload = base64_encode(json_encode(['user_id'=>$userId, 'exp'=>time()+86400*7]));
  $sig     = base64_encode(hash_hmac('sha256', "$header.$payload", $secret, true));
  return "$header.$payload.$sig";
}

function verifyJWT($token, $secret) {
  $parts = explode('.', $token);
  if (count($parts) !== 3) return null;
  $sig = base64_encode(hash_hmac('sha256', $parts[0].'.'.$parts[1], $secret, true));
  if ($sig !== $parts[2]) return null;
  $payload = json_decode(base64_decode($parts[1]), true);
  if (!$payload || $payload['exp'] < time()) return null;
  return $payload;
}
```

**bcrypt** (PHP 5.4에는 `password_hash()` 없음 → `crypt()` 직접):
```php
function pwHash($password) {
  $bytes = openssl_random_pseudo_bytes(16);
  $b64 = strtr(rtrim(base64_encode($bytes), '='), '+', '.');
  $salt = '$2y$10$' . substr($b64, 0, 22);
  return crypt($password, $salt);   // PHP 5.4도 bcrypt 지원
}
function pwVerify($password, $hash) {
  return hash_equals($hash, crypt($password, $hash));
}
```

**API 액션 (`/interview-api/api.php?action=...`)**
```
health         - 헬스체크
email_signup   - 이메일 가입 (bcrypt 저장)
email_login    - 이메일 로그인 → JWT
kakao_login    - 카카오 ID/닉네임/이메일 받아 가입·로그인
verify         - JWT 검증 → user 정보
save_chat      - 메시지 저장 (인증/익명 둘 다)
list_chats     - 본인 대화 이력 (JWT 필요)
```

### 4-3. 카카오 OAuth

**SDK init** (`index.html`):
```html
<script src="https://developers.kakao.com/sdk/js/kakao.min.js"></script>
<script>
  window.addEventListener('DOMContentLoaded', function () {
    if (window.Kakao && !window.Kakao.isInitialized()) {
      window.Kakao.init('fc0a1313d895b1956f3830e5bf14307b');
    }
  });
</script>
```

**로그인 흐름** (`api.js → startKakaoLogin`):
```
1. Kakao.Auth.login()                       → 카카오 팝업, 사용자 동의
2. Kakao.API.request('/v2/user/me')         → kakaoId, nickname, email
3. POST /api.php?action=kakao_login         → 학교 DB에 가입·갱신
4. JWT 받아 localStorage 저장
```

**카카오 도메인 등록 필요** (Kakao Developers 콘솔):
- 플랫폼 → Web → 사이트 도메인 → `https://cha-interview-bot.vercel.app`
- 카카오 로그인 활성 ON
- Redirect URI 도 같은 도메인
- 동의 항목: 닉네임·이메일

### 4-4. HeyGen Streaming Avatar

**3개 API 묶음**:
```
1. POST /v1/streaming.create_token           → JWT (서버 측)
2. POST /v1/streaming.new                    → session + LiveKit URL/token
   { avatar_id, voice: { voice_id, rate, emotion },
     language: 'ko', version: 'v2', video_encoding: 'H264' }
3. POST /v1/streaming.start                  → 활성
   { session_id }   ← v1은 sdp 안 넣음 (LiveKit 모드)
```

**이후 명령**:
```
streaming.task        → 발화 명령 ({ session_id, text, task_type: 'repeat' })
streaming.interrupt   → 발화 중단
streaming.stop        → 세션 종료
```

⚠️ 함정:
- `avatar_name` (구 키) 쓰면 영상 안 나옴 → **`avatar_id` 사용**
- `streaming.start`에 `sdp` 넣으면 안 됨 (v1 LiveKit 모드는 session_id만)
- audio 트랙도 attach 해야 소리 나옴 (video만 attach하면 무음)

### 4-5. LiveKit WebRTC

LiveKit은 WebRTC SFU. HeyGen이 LiveKit Cloud에 publish하고 우리가 subscribe.

```javascript
const room = new window.LivekitClient.Room({
  adaptiveStream: true,
  dynacast: true
});

// 트랙 attach
room.on(RoomEvent.TrackSubscribed, (track) => {
  if ((track.kind === 'video' || track.kind === 'audio') && videoRef.current) {
    track.attach(videoRef.current);
    if (track.kind === 'video') setVideoReady(true);
  }
});

// 메타 이벤트 (DataChannel)
room.on(RoomEvent.DataReceived, (payload) => {
  const msg = JSON.parse(new TextDecoder().decode(payload));
  if (msg.type === 'avatar_start_talking') setStatus('speaking');
  if (msg.type === 'avatar_stop_talking')  setStatus('connected');
});

await room.connect(url, access_token);
```

### 4-6. RAG (bge-m3 + 코사인 유사도)

**사전 준비** (`add_to_rag.js`):
```
1. rag_chunks.jsonl 작성 (사람이 직접)
2. 각 청크의 embedding_text를 bge-m3로 임베딩 (1024차원)
3. 정규화 (L2 norm = 1) → 코사인 = 내적
4. cha_rag_chunks.json + cha_rag_embeddings.json 저장
```

**검색** (`utils/cha-rag.js`):
```javascript
async function retrieve(query, topK = 5, minScore = 0.25) {
  const qvec = await embed(query);   // bge-m3 임베딩 + 정규화

  const scored = embeds.map((evec, i) => ({
    chunk: chunks[i],
    score: dotProduct(qvec, evec)    // 정규화된 벡터의 내적 = cos similarity
  }));

  return scored
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(x => ({ ...x.chunk, score: x.score }));
}
```

**파라미터 결정 근거**:
- `minScore = 0.25` — bge-m3는 한국어 짧은 질문에서 0.3~0.6 범위. 0.35는 50% 컷 → 너무 빡빡
- `topK = 5` — 상위 1개만 주면 답변 빈약, 5개 주면 LLM이 교차 참조해 풍부한 답변
- "관련 없는 항목은 무시" 시스템 프롬프트로 LLM이 알아서 골라쓰게 함

**현재 청크 분포 (총 82개)**:
| 섹션 | 청크 |
|---|---|
| 경영학전공 (오프닝~클로징) | 21 |
| 경영학 추가 (YouTube + 소개페이지) | 16 |
| 시스템생명과학 (정재균) | 5 |
| 심리학 (김지현) | 5 |
| 미술치료 (박윤미) | 4 |
| 스포츠의학 (정성률) | 4 |
| 디지털보건의료 (한세미) | 4 |
| 미디어커뮤니케이션학 (김정환) | 4 |
| 소프트웨어융합 (이상민) | 4 |
| 바이오식의약학 (홍수린) | 4 |
| AI의료데이터학 (이상민) | 5 |
| 세포유전자재생의학 (송지환) | 6 |

→ "디지털보건의료랑 경영학 시너지?" 같은 융합 질문에 두 청크 다 매칭되어 자연스러운 답변 가능.

### 4-7. Gemma4 프롬프트 엔지니어링

**호출 (`routes/interview-chat.js`)**:
```javascript
const messages = [
  { role: 'system', content: systemPrompt },   // 역할 + RAG + 출력 형식 + 금지
  ...history.slice(-8),                         // 최근 8턴
  { role: 'user', content: message }
];

const response = await fetch('http://127.0.0.1:11435/api/chat', {
  body: JSON.stringify({
    model: 'gemma4:latest',
    messages,
    stream: false,
    think: false,                              // thinking 끔 (켜면 빈 응답)
    options: { num_predict: 400, temperature: 0.7 }
  })
});
```

**시스템 프롬프트 4 핵심**:
1. **역할** — "박대근 교수의 AI 면담 어시스턴트, 해요체"
2. **RAG 컨텍스트** — top-5 청크를 `[섹션] Q: ... A: ...` 포맷
3. **JSON 강제** — `{"reply":"...", "ttsReply":"..."}`
4. **금지** — 이모지/장식 기호, 추측 답변, 무관 자료 사용

**왜 reply / ttsReply 분리?**
- `reply`: 채팅창 표시 (한글 그대로)
- `ttsReply`: 아바타 발화용 (숫자→한글, 약어→발음). 예: "AI" → "에이아이", "20명" → "스무 명"

**JSON 추출 (모델이 앞뒤에 텍스트 붙이는 경우)**:
```javascript
const raw = data.message.content.trim()
  .replace(/^```json\s*/i, '').replace(/```\s*$/, '');

const jsonMatch = raw.match(/\{[\s\S]*"reply"[\s\S]*\}/);
const parsed = JSON.parse(jsonMatch[0]);
```

**이모지 strip (모델이 무시하고 넣는 경우 후처리)**:
```javascript
function stripEmoji(s) {
  return s.replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
          .replace(/[\u{2600}-\u{27BF}]/gu, '')
          .replace(/[\u{FE0F}]/gu, '')
          .trim();
}
parsed.reply    = stripEmoji(parsed.reply);
parsed.ttsReply = stripEmoji(parsed.ttsReply);
```
이거 안 하면 `😊` → TTS가 "옷"이라고 발음하는 사고 발생.

### 4-8. Web Speech API STT + Echo 3중 가드

**기본 STT**:
```javascript
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const rec = new SR();
rec.lang = 'ko-KR';
rec.interimResults = true;
rec.continuous = true;

rec.onresult = (event) => {
  let interim = '', final = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const t = event.results[i][0].transcript;
    if (event.results[i].isFinal) final += t;
    else interim += t;
  }

  // ─── echo 가드 (1차): 봇 발화 중 / LLM 처리 중이면 결과 무시 ───
  if (isSpeakingRef.current || isProcessingRef.current) return;

  if (final.trim()) sendMessage(final.trim());
  else if (interim) {
    silenceTimer = setTimeout(() => sendMessage(interim.trim()), 2000);
  }
};

rec.onend = () => {
  if (autoListen && !isSpeakingRef.current && !isProcessingRef.current) {
    setTimeout(() => rec.start(), 600);
  }
};
```

**Echo 무한루프 문제**:
헤드폰 미사용 시 HeyGen 음성 → 마이크 → STT가 final 인식 → 봇 답변이 새 질문으로 처리 → 무한루프.

**3중 가드로 차단**:

```
[봇 발화 시작 status='speaking']
    │
    ↓
1차: useEffect → recognition.abort() + stop() (즉시 종료)
    │
[혹시 abort 전 final이 들어오면]
    ↓
2차: rec.onresult → isSpeakingRef || isProcessingRef → return
    │
[혹시 sendMessage까지 도달하면]
    ↓
3차: sendMessage 진입 → isSpeakingRef → return + console.warn
```

```javascript
// 1차 가드 — useEffect로 status 감시
useEffect(() => {
  if (status === 'speaking') {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch {}
      try { recognitionRef.current.stop() } catch {}
    }
  } else if (status === 'connected' && autoListenRef.current && !isListeningRef.current && !isProcessingRef.current) {
    const t = setTimeout(() => startListening(), 1000);  // 트랙 잔향 회피
    return () => clearTimeout(t);
  }
}, [status, startListening]);

// 3차 가드 — sendMessage 진입
const sendMessage = useCallback(async (userText) => {
  if (!userText.trim() || isProcessingRef.current) return;
  if (isSpeakingRef.current) {
    console.warn('[echo guard] sendMessage suppressed during avatar speaking');
    return;
  }
  // ...
}, []);
```

### 4-9. SOFT-INTERRUPT (ESC 키)

OpenAvatarChat의 규성 패턴 차용. 음성 echo 자동 interrupt는 false trigger 위험이 커서 **명시적 ESC 키만** 사용.

```javascript
useEffect(() => {
  const handleGlobalKeydown = (e) => {
    if (e.key !== 'Escape' && e.code !== 'Escape') return;
    if (!isSpeakingRef.current) return;          // 발화 중일 때만
    e.preventDefault();
    e.stopPropagation();
    // textarea/input 포커스 중에도 작동 (다음 입력 방해 방지)
    if (e.target?.tagName === 'TEXTAREA' || e.target?.tagName === 'INPUT') {
      e.target.blur();
    }
    interruptAvatar();    // POST /v1/streaming.interrupt
  };

  // window + document 양쪽 capture phase (브라우저별 누락 방어)
  window.addEventListener('keydown', handleGlobalKeydown, true);
  document.addEventListener('keydown', handleGlobalKeydown, true);
  return () => {
    window.removeEventListener('keydown', handleGlobalKeydown, true);
    document.removeEventListener('keydown', handleGlobalKeydown, true);
  };
}, [interruptAvatar]);
```

---

## 5. 사용자 시나리오 5개

### 시나리오 1. 첫 접속
```
1. 카톡에서 링크 클릭 → IIFE가 KAKAOTALK 감지 → Chrome/Safari 자동 열림
2. index.html 로드 → Kakao.init() (DOMContentLoaded)
3. App.jsx mount
   ├─ getUser() → localStorage 확인
   └─ verifyToken() → 서버에 검증
       ├─ 성공: setUser, 모달 안 띄움
       └─ 실패/없음: 모달 자동 띄움
4. 사용자가 카카오/이메일/게스트 선택
   → JWT 받아 localStorage 저장
   → 모달 닫힘
```

### 시나리오 2. 아바타 시작 + 인사말
```
1. "아바타 시작" 클릭 (사용자 클릭 컨텍스트 = 마이크 권한 요청 가능)
2. /api/heygen-token → JWT
3. /api/heygen-proxy(streaming.new) → session
4. new Room().connect(url, access_token)
   ├─ TrackSubscribed: video+audio attach
   └─ DataReceived: avatar_start/stop_talking 메타 이벤트
5. /api/heygen-proxy(streaming.start) → 활성
6. newSessionId() = "sess_171xxx_yyy"
7. 인사말 표시 + saveChat(sid, 'assistant', greeting)
8. setTimeout 800ms → callProxy('streaming.task', greetingTts) → 발화
9. SpeechRecognition.start() → 마이크 권한 prompt → 자동 ON
```

### 시나리오 3. 사용자 질문 (음성 또는 채팅)
```
[STT final 또는 채팅 Enter]
    ↓ sendMessage(text)
    ├─ 메시지 표시 + saveChat(sid, 'user', text)
    └─ /api/chat → Middleton interview-chat
        ├─ retrieve(text, 5, 0.25)
        │   ├─ bge-m3 임베딩
        │   ├─ 82청크와 코사인
        │   └─ top-5 (≥0.25)
        ├─ Gemma4: system + history + user → JSON {reply, ttsReply}
        └─ 이모지 strip
    ↓
    ├─ 채팅에 표시 + saveChat(sid, 'assistant', reply)
    └─ callProxy('streaming.task', ttsReply) → HeyGen 발화
        ↓
        LiveKit DataReceived: avatar_start_talking → status='speaking'
        ↓ (echo 가드 발동: STT abort)
        avatar_stop_talking → status='connected'
        ↓ (1초 후 STT 재개)
```

### 시나리오 4. ESC 발화 중단
```
[봇 발화 중]
    ↓ ESC 키 down
    handleGlobalKeydown (window/document capture)
    ├─ ESC 맞음 ✓
    ├─ status === 'speaking' ✓
    ├─ preventDefault + stopPropagation
    ├─ textarea/input 포커스면 blur
    └─ interruptAvatar()
        ├─ callProxy('streaming.interrupt', {session_id})
        └─ setStatus('connected')
    ↓
    LiveKit avatar_stop_talking → 마이크 자동 ON
```

### 시나리오 5. 대화 종료
```
"대화 종료" 버튼 클릭 → confirm
    ↓ stopAvatar()
    ├─ STT abort + autoListen=false + recognition=null
    ├─ callProxy('streaming.stop', {session_id})
    ├─ room.disconnect()
    ├─ sessionRef = null, sessionIdRef = null, history = []
    └─ setMessages([]) + setStatus('idle')
    ↓
    AvatarPanel: "아바타 시작" 버튼 다시 노출
    ChatPanel: 입력창 비활성 + placeholder "먼저 [아바타 시작] 버튼을 눌러주세요"
```

---

## 6. 코드 구조 + 핵심 파일 가이드

### 프론트엔드 (`cha-interview-bot/`)
```
index.html                    ← Kakao SDK + 카톡 인앱 회피 IIFE + LiveKit + OG meta
src/
  main.jsx                    ← React DOM 마운트
  App.jsx                     ← 메인 (state · HeyGen · STT · 세션 · ESC)
  App.module.css              ← flex layout (모바일 column)
  index.css                   ← 전역 변수
  components/
    AvatarPanel.jsx/css       ← 비디오 + 시작/종료 버튼 + 상태 배지
    ChatPanel.jsx/css         ← 메시지 + 입력 + 마이크 + 로그인 버튼
    AuthModal.jsx/css         ← 카카오/이메일/게스트 (v5 패턴 + 동의)
  lib/
    api.js                    ← 학교 API 클라이언트 + Kakao SDK 래핑

api/                          ← Vercel Serverless Functions
  heygen-token.js             ← HEYGEN_API_KEY로 JWT 발급
  heygen-proxy.js             ← /v1/streaming.* 프록시 (key 보호)
  chat.js                     ← Middleton으로 단순 프록시
```

### Middleton (`/home/student04/finbot/server/`)
```
index.js                      ← Express + CORS + 라우트 등록
routes/
  interview-chat.js           ← RAG + Gemma4 + JSON 추출 + 이모지 strip
utils/
  cha-rag.js                  ← bge-m3 임베딩 + 코사인 검색
data/
  cha_rag_chunks.json         ← 82 청크 (id, section, question, answer, keywords)
  cha_rag_embeddings.json     ← 82 × 1024 정규화 벡터
```

### 학교 서버 (`/var/www/html/interview-api/`)
```
api.php                       ← PHP 5.4 호환, 액션 라우팅
                                actions: health, kakao_login, email_signup,
                                         email_login, verify, save_chat, list_chats
```

### 핵심 함수 — 어디 있는지

| 동작 | 파일 | 함수 |
|---|---|---|
| HeyGen 시작 | `App.jsx` | `startAvatar()` |
| HeyGen 종료 | `App.jsx` | `stopAvatar()` |
| 메시지 전송 | `App.jsx` | `sendMessage()` |
| 발화 중단 | `App.jsx` | `interruptAvatar()` |
| ESC 핸들러 | `App.jsx` | `useEffect` |
| Echo 가드 | `App.jsx` | `useEffect([status])` + `rec.onresult` + `sendMessage` |
| STT 초기화 | `App.jsx` | `initRecognition()` |
| RAG 검색 | `utils/cha-rag.js` | `retrieve()` |
| Gemma4 호출 | `routes/interview-chat.js` | `router.post()` |
| 이모지 제거 | `routes/interview-chat.js` | `stripEmoji()` |
| 카카오 로그인 | `lib/api.js` | `startKakaoLogin()` |
| JWT 검증 | `api.php` | `verifyJWT()` |
| bcrypt 해시 | `api.php` | `pwHash()` / `pwVerify()` |

---

## 7. 인프라 매핑

| 계층 | 위치 | 호스트 | 포트/경로 | 인증 |
|---|---|---|---|---|
| 프론트엔드 | Vercel | `cha-interview-bot.vercel.app` | 443 | — |
| Vercel API | Vercel | `/api/*` | 443 | env `HEYGEN_API_KEY` |
| LLM 서버 | Middleton GPU | `1.223.219.123:7822` | PM2 `finbot-server` (9000) | `student04 / chacha2025` |
| nginx | Middleton | `middleton.p-e.kr/finbot/*` | 443 | — |
| Gemma4 | Middleton Ollama | `127.0.0.1:11435` | — (loopback) | — |
| bge-m3 | Middleton Ollama | `127.0.0.1:11436` | — (loopback) | — |
| DB 서버 | 학교 | `aiforalab.com` (`106.247.236.2:10022`) | MySQL 3306 + Apache 80/443 | `user2 / user2!!` |
| PHP API | 학교 | `/var/www/html/interview-api/` | `aiforalab.com/interview-api/api.php` | JWT (HS256) |
| HeyGen | HeyGen Cloud | `api.heygen.com/v1/*` | 443 | API Key (Vercel env) |
| LiveKit | HeyGen → LiveKit | 동적 URL | WSS | 동적 access_token |
| 카카오 | Kakao Developers | `kapi.kakao.com` | 443 | JS Key `fc0a13...` |

---

## 8. 운영 매뉴얼

### 면담봇 재배포
```bash
cd C:\dev\cha-interview-bot
npm run build
git add -A && git commit -m "..." && git push origin master
# → Vercel 자동 배포 (1~2분)
```

### Middleton 서버 재시작
```bash
ssh -p 7822 student04@1.223.219.123
export NVM_DIR=/home/student04/.nvm && . /home/student04/.nvm/nvm.sh
pm2 restart finbot-server
pm2 logs finbot-server --lines 50
```

⚠️ **PM2 restart는 필수**: `cha-rag.js`의 모듈-스코프 캐시(`_chunks`, `_embeds`)가 reset돼야 새 RAG 데이터 반영됨.

### RAG 청크 추가
```bash
# 1. 로컬에서 jsonl 작성
# 형식: {"id":"ch-XXX", "section":"...", "question":"...", "answer":"...",
#        "keywords":[...], "embedding_text":"질문: ... 답변: ..."}

# 2. 서버 업로드
pscp -P 7822 new_chunks.jsonl student04@1.223.219.123:/tmp/

# 3. 임베딩 + 추가 (자동 백업됨 .bak.타임스탬프)
ssh student04@... "node /tmp/add_to_rag.js /tmp/new_chunks.jsonl"

# 4. PM2 restart
pm2 restart finbot-server
```

### 학교 DB 조회
```bash
ssh -p 10022 user2@106.247.236.2
mysql -u user2 -puser2!! cha_interview_db

# 사용자
SELECT id, name, email, kakao_id, visit_count, last_login FROM users;

# 최근 메시지
SELECT user_id, session_id, role, LEFT(message, 80), created_at
FROM chat_logs ORDER BY created_at DESC LIMIT 50;

# 특정 세션 전체
SELECT role, message FROM chat_logs WHERE session_id = 'sess_xxx' ORDER BY created_at;
```

### 학교 PHP API 수정
```bash
pscp -P 10022 server/api.php user2@106.247.236.2:/tmp/
ssh -p 10022 user2@... "echo 'user2!!' | sudo -S cp /tmp/api.php /var/www/html/interview-api/api.php"
```

---

## 9. 트러블슈팅 사례집 (8건)

### 9-1. HeyGen 비디오 안 뜸 (status='연결됨'인데)
**원인 3가지 동시**:
- `streaming.new`에 `avatar_name` (구 키)
- `streaming.start`에 `sdp` 포함 (v1은 session_id만)
- video 트랙만 attach

**해결**: `avatar_id` 사용 + sdp 제거 + audio 트랙도 attach

### 9-2. RAG 매칭 결과가 다 무관함
**진단**: PM2 로그에 `Q: ��������������?` (한글 깨짐)
**원인**: Git Bash `curl -d` inline 한국어 인코딩 깨짐. 실제 브라우저는 fetch UTF-8 정상.
**보너스**: `minScore=0.35` → 너무 빡빡 → 0.25로 낮추고 top-K 3 → 5

### 9-3. PHP 500 Internal Server Error (회원가입)
**원인**: PHP 5.4.45 → `password_hash()` 5.5+ 함수
**해결**: `crypt()` + `openssl_random_pseudo_bytes()`로 bcrypt 자체 구현

### 9-4. 이모지가 TTS에서 "옷"으로 발음됨
**원인**: `😊` 이모지를 HeyGen TTS가 한글로 음역
**해결**: 시스템 프롬프트 "이모지 금지" + 응답 후처리 strip

### 9-5. 카톡 인앱에서 마이크 안 됨
**해결**: UA 감지 → Android는 `intent://` Chrome / iOS는 `kakaotalk://web/openExternal`

### 9-6. 음성 echo로 자기 발화 자동 interrupt
**원인**: HeyGen 음성 → 마이크 → STT가 사용자 발화로 오인 → 자동 interrupt
**해결**: STT의 echo 기반 자동 interrupt 코드 제거 + ESC 키 명시적 인터럽트

### 9-7. 답변이 다시 새 질문이 되는 무한루프 (교수님 피드백)
**원인**: STT echo로 봇 답변 텍스트가 새 질문으로 들어감
**해결**: 3중 가드 (status useEffect + onresult 가드 + sendMessage 가드)

### 9-8. iOS 모바일 100vh가 화면 밖으로 잘림
**원인**: iOS Safari `100vh`는 주소창 포함
**해결**: `100dvh` (dynamic viewport height) + `env(safe-area-inset-bottom)`

---

## 10. 보안 / 개인정보

### 수집 항목
- 이름 (이메일 가입 시) 또는 카카오 닉네임
- 이메일 (가입 또는 카카오 동의 시)
- 카카오 ID (해시 정수)
- 비밀번호 — bcrypt 단방향 해시
- 대화 메시지 + RAG 매칭 결과

### 동의 (AuthModal)
- 카카오 정보 제공 (필수)
- 개인정보 수집 (필수)
- 마케팅 (선택)
- 필수 동의 없으면 로그인 버튼 비활성

### 토큰
- JWT HS256, 7일 유효
- localStorage 저장
- 첫 방문 시 verifyToken으로 검증, 실패 시 자동 clearAuth

### CORS
- PHP API `allowed_origins`: `cha-interview-bot.vercel.app` + 로컬 개발
- Middleton finbot도 동일 origin 등록

### 익명 사용
- 토큰 없이도 `chat_logs`에 `user_id NULL`로 저장
- 게스트 모드는 채팅 가능

### 보안 권장 (TODO)
- `JWT_SECRET` 환경변수로 이전
- DB 비밀번호도 환경변수
- Rate limiting (현재 없음)

---

## 11. 확장 아이디어

### 단기 (1주)
- **음성 VAD interrupt** — OAC `patchVoiceInterrupt` (RMS 임계값) 차용. 헤드폰 권장 가이드 같이.
- **OG 썸네일 이미지** — `public/og-thumbnail.png` (1200×630) 추가
- **카카오 추가 동의 항목** — 학번·전공 같은 항목 (선택)
- **관리자 대시보드** — `list_chats` 확장 (자주 묻는 질문 클러스터링)

### 중기 (1달)
- **STS 모드** — 채팅 단계 건너뛰고 음성 → 음성 직접 변환 (latency ↓)
- **자체 voice 다양화** — 박대근 교수 실제 음성으로 voice cloning
- **RAG 자동 갱신** — 학과 공지 페이지 크롤링 → 자동 임베딩
- **다국어** — 외국인 학생용 (글로벌비즈니스AI 108명). bge-m3 다국어 강함

### 장기 (3달+)
- **다른 학과로 확장** — 의예/약대/간호 등. 같은 인프라 + RAG만 교체
- **학생 프로파일링** — 누적 대화 분석 → 맞춤 진로 추천
- **교수 영상 자동 RAG화** — 영상 → STT → 청크화 → 임베딩 자동 파이프라인

---

_v1.1 — 2026-05-02_
_관련 문서: [DEVLOG.md](./DEVLOG.md) (시간순 개발 일지)_
