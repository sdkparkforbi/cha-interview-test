# 차의과학대학교 경영학전공 면담봇 — 개발일지

> **프로젝트**: 박대근 교수님 AI 면담 어시스턴트
> **목적**: 미래융합대학 신입생·재학생의 전공 선택 및 진로 상담을 24시간 제공하는 음성·텍스트 챗봇
> **개발 기간**: 2026-05-01 ~ 진행 중
> **운영 도메인**: https://cha-interview-bot.vercel.app
> **저장소**: https://github.com/sungbongju/cha-interview-bot

---

## 1. 한눈에 보기

```
[학생 브라우저]
  │
  ├─ React UI (Vite, Vercel hosting)
  │   ├─ 시작 시 로그인 모달 (카카오 / 이메일 / 게스트)
  │   ├─ 박대근 교수 아바타 영상 (HeyGen → LiveKit WebRTC)
  │   ├─ 채팅 메시지 + 텍스트 입력 + 음성 입력(Web Speech API)
  │   └─ 카톡 인앱 → Chrome 자동 전환 (마이크/WebRTC 권한 위함)
  │
  ↓ /api/chat
[Vercel Serverless Function (API 프록시)]
  │
  ↓ POST https://middleton.p-e.kr/finbot/api/interview-chat
[Middleton GPU 서버 (Express PM2)]
  │
  ├─ bge-m3 임베딩 → 37개 RAG 청크 코사인 유사도 검색 (top-5, ≥0.25)
  ├─ Gemma4 (Ollama 11435) — system + RAG context + history
  └─ JSON {reply, ttsReply} 반환 (이모지 strip)
  │
  ↓ 답변
[Vercel] → [브라우저] : 채팅 표시 + HeyGen streaming.task → 아바타 발화

[학생 브라우저]
  └─ 모든 메시지를 학교 PHP API로 fire-and-forget 저장
      → https://aiforalab.com/interview-api/api.php?action=save_chat
      → cha_interview_db (MySQL)
```

---

## 2. 인프라 / 리소스 매핑

| 계층 | 위치 | 호스트 | 용도 | 비고 |
|---|---|---|---|---|
| 프론트엔드 | Vercel | `cha-interview-bot.vercel.app` | React 정적 빌드 (Vite) | GitHub master 푸시 시 자동 배포 |
| 프록시 API | Vercel | `cha-interview-bot.vercel.app/api/*` | HeyGen 토큰/프록시 + LLM 프록시 | 환경변수 `HEYGEN_API_KEY` 필요 |
| LLM + RAG | Middleton | `1.223.219.123:7822` SSH | Gemma4 + bge-m3 임베딩 | PM2 `finbot-server` (port 9000) |
| LLM 모델 | Middleton | Ollama `127.0.0.1:11435` | `gemma4:latest` | `EXAONE_MODEL` env 재사용 |
| 임베딩 모델 | Middleton | Ollama `127.0.0.1:11436` | `bge-m3` (1024-dim) | RAG용 |
| nginx | Middleton | `middleton.p-e.kr/finbot/*` | finbot Express 프록시 | 기존 설정 그대로 사용 |
| DB | 학교 서버 | `aiforalab.com` (`106.247.236.2`) | MySQL `cha_interview_db` | 사용자·대화 로그 |
| PHP API | 학교 서버 | `/var/www/html/interview-api/api.php` | 인증·로그 저장 (Apache 2.4 + PHP 5.4.45) | `user2` 권한 |
| 아바타 | HeyGen | `api.heygen.com/v1/streaming.*` | 박대근 교수 커스텀 아바타 | LiveKit WebRTC 송출 |
| 카카오 SDK | Kakao Developer | `developers.kakao.com` | 소셜 로그인 | JS Key 재사용 (OAC와 동일) |

---

## 3. 데이터 흐름 (시퀀스)

### 3-1. 첫 접속
```
1. 브라우저: index.html 로드
   ├─ KAKAOTALK UA 감지 → Chrome intent로 강제 전환 (모바일)
   └─ Kakao.init('fc0a13...') (DOMContentLoaded)
2. App.jsx: localStorage 토큰 → /api.php?action=verify
   ├─ 성공 → user state, 모달 안 띄움
   └─ 실패/없음 → AuthModal 자동 띄움 (카카오/이메일/게스트)
3. 사용자 액션: 카카오 로그인 또는 이메일 로그인 또는 게스트
   └─ 학교 DB에 user 등록·갱신, JWT 토큰 받아 localStorage 저장
```

### 3-2. 아바타 시작
```
1. "아바타 시작" 클릭
2. /api/heygen-token → HeyGen JWT 발급
3. /api/heygen-proxy (streaming.new)
   ├─ avatar_id: e2eb35c947644f09820aa3a4f9c15488 (교수님 아바타)
   ├─ voice_id: 15d128072e194dc399d2898967941897
   └─ language: ko, version: v2, encoding: H264
4. LiveKit room.connect(url, access_token) → 비디오·오디오 트랙 attach
5. /api/heygen-proxy (streaming.start) → 아바타 활성
6. newSessionId() → "sess_171xxx_yyy" (학교 DB용)
7. 인사말 발화 + 채팅에 표시 + saveChat (DB)
8. SpeechRecognition 자동 시작 (사용자 클릭 컨텍스트라 권한 prompt 자동)
```

### 3-3. 사용자 질문 (텍스트 또는 음성)
```
1. STT final 결과 또는 채팅 Enter → sendMessage(text)
2. saveChat(sid, 'user', text)  → 학교 DB
3. /api/chat → Middleton /finbot/api/interview-chat
   ├─ retrieve(text, 5)  — bge-m3 임베딩 + 37 청크 코사인, top-5 (minScore 0.25)
   ├─ Gemma4: system(프롬프트 + RAG context) + history(8) + user
   └─ JSON {reply, ttsReply} 추출 + 이모지 strip
4. 채팅에 표시 + saveChat(sid, 'assistant', reply) → DB
5. /api/heygen-proxy (streaming.task, ttsReply) → 아바타 발화
6. LiveKit DataChannel 'avatar_start_talking' → status='speaking'
7. 'avatar_stop_talking' → status='connected', 마이크 자동 재시작
```

---

## 4. RAG 구성

### 데이터셋 (37 청크)

| 출처 | 청크 수 | 비고 |
|---|---|---|
| 박대근 교수 유튜브 인터뷰 (구조화 Q&A) | 21 | ch-001 ~ ch-021. 학과 소개·교수진·진로·창업·학생 등 |
| YouTube 추가 콘텐츠 | 7 | ch-022 ~ ch-028. 경영학 본질·트라이앵글·미디어연계·차병원실습·제넨텍·주식투자 |
| 경영학 소개페이지 봇 (`cha-biz-ai-v11`) | 9 | ch-029 ~ ch-037. 교육목표·커리큘럼 4단계·복수전공 6가지·자격증·졸업인증·실전프로그램·FAQ |

### 데이터 위치 (Middleton)
```
/home/student04/finbot/server/data/
├── cha_rag_chunks.json      (37 청크, 36KB)
└── cha_rag_embeddings.json  (37 × 1024 정규화 벡터, 786KB)
```

### 검색 파라미터
- 모델: `bge-m3` (Ollama @ 11436)
- 거리: 코사인 유사도 (벡터 정규화 → 내적)
- top-K: 5
- minScore: 0.25 (한국어 짧은 질문 통과를 위해 낮춤)
- LLM이 시스템 프롬프트로 "관련 없는 자료는 무시"하도록 지시

### 매칭 품질 검증 (실측)
| 질문 | 매칭 청크 | score |
|---|---|---|
| "제넨텍이 뭐예요?" | ch-027 (생명과학 융합) | 0.539 |
| "수학 못해도 괜찮을까요?" | ch-035 (FAQ) | 0.649 |
| "교수님 누구세요" | ch-007 (교수진) | 0.565 |
| "학과 소개 좀 해주세요" | ch-002 (학과소개) | 0.648 |
| "복수전공" | ch-031 (복수전공) | 0.681 |

---

## 5. 데이터베이스 스키마 (학교 서버)

### `cha_interview_db.users`
```sql
id              INT PK AUTO_INCREMENT
kakao_id        VARCHAR(64) UNIQUE   -- 카카오 로그인 사용자
email           VARCHAR(255) UNIQUE  -- 이메일 로그인 사용자
password_hash   VARCHAR(255)         -- bcrypt (PHP 5.4 호환 crypt() 사용)
name            VARCHAR(100) NOT NULL
visit_count     INT DEFAULT 1
last_login      DATETIME
created_at      DATETIME DEFAULT NOW()
```

### `cha_interview_db.chat_logs`
```sql
id          INT PK AUTO_INCREMENT
user_id     INT NULL  → users.id (FK ON DELETE SET NULL)  -- NULL이면 익명
session_id  VARCHAR(64) NOT NULL  -- 클라이언트 발급 (sess_타임스탬프_랜덤)
role        ENUM('user','assistant') NOT NULL
message     TEXT NOT NULL
rag_hits    TEXT  -- 매칭된 청크 ID + score (JSON, 옵션)
created_at  DATETIME DEFAULT NOW()
INDEX (user_id, session_id, created_at)
```

### PHP API 엔드포인트 (`https://aiforalab.com/interview-api/api.php`)
| action | 메서드 | 설명 |
|---|---|---|
| `health` | GET/POST | 헬스체크 |
| `email_signup` | POST | 이메일 회원가입 (bcrypt 저장) |
| `email_login` | POST | 이메일 로그인 → JWT |
| `kakao_login` | POST | 카카오 ID/닉네임 받아 가입·로그인 |
| `verify` | POST | JWT 검증 → 사용자 정보 |
| `save_chat` | POST | 메시지 저장 (인증/익명 둘 다) |
| `list_chats` | POST | 본인 대화 이력 조회 (JWT 필요) |

JWT: HS256, secret `cha_interview_jwt_secret_2026`, 7일 유효.

---

## 6. 코드 구조

### 프론트엔드 (`cha-interview-bot/`)
```
index.html                 ← Kakao SDK + 카톡 인앱 회피 + LiveKit
src/
  main.jsx
  App.jsx                  ← 메인: 상태/라우팅/HeyGen/STT/세션
  App.module.css           ← 모바일 반응형 (flex-column)
  components/
    AvatarPanel.jsx/css    ← 영상 + 시작 버튼 + 상태 배지
    ChatPanel.jsx/css      ← 메시지/입력/마이크/로그인 버튼
    AuthModal.jsx/css      ← v5 패턴 로그인 모달
  lib/
    api.js                 ← 학교 PHP API 클라이언트 (이메일/카카오/save_chat)
api/
  heygen-token.js          ← Vercel: HeyGen JWT 프록시
  heygen-proxy.js          ← Vercel: streaming.* 프록시
  chat.js                  ← Vercel: Middleton interview-chat 프록시
```

### 서버 (Middleton — `/home/student04/finbot/server/`)
```
routes/interview-chat.js   ← RAG + Gemma4 호출, 이모지 strip
utils/cha-rag.js           ← 임베딩·코사인 검색
data/cha_rag_chunks.json   ← 37 청크
data/cha_rag_embeddings.json
```

### 서버 (학교 — `/var/www/html/interview-api/`)
```
api.php                    ← PHP 5.4 호환, JWT + bcrypt(crypt) + PDO MySQL
```

---

## 7. 기술 의사결정 로그

| 결정 | 선택 | 이유 |
|---|---|---|
| 프론트엔드 프레임워크 | React (Vite) | 컴포넌트 분리·hot reload·금융상품매뉴얼 v1~v3 HTML 단일파일의 유지보수 어려움 회피 |
| 호스팅 | Vercel | 정적 + serverless 둘 다 가능, GitHub 자동 배포 |
| LLM | **Gemma4** (Ollama) | 기존 finbot이 같은 모델 운영 중, Korean 품질 OK, RAG 컨텍스트 처리 안정 |
| 임베딩 | bge-m3 | 1024차원, 한국어 강함, 교수님 RAG 시스템 동일 모델 |
| 아바타 | **HeyGen v1 streaming** | LiveAvatar 마이그레이션 시도 → 교수님 커스텀 아바타가 신 플랫폼에 없어서 v1 잔류 (deprecation notice는 표시되지만 작동) |
| Voice | `15d128072e194dc399d2898967941897` | 금융상품매뉴얼 v1과 동일, 한국어 자연스러움 검증됨 |
| STT | Web Speech API | 무료, 한국어 지원, 추가 의존성 없음 |
| DB 위치 | **학교 서버 (aiforalab.com)** | 기존 finmarket-api 인프라 그대로, 인수인계 자연스러움 |
| 인증 | JWT + bcrypt (crypt 호환) | PHP 5.4의 password_hash 미지원으로 crypt() 직접 사용 |
| 카카오 SDK | OAC와 동일 JS 키 (`fc0a13...`) | 등록·승인 절차 생략 |

---

## 8. 개발 타임라인 (커밋 단위)

### Day 1 — 2026-05-01
| 시각 | 커밋 | 내용 / 트러블슈팅 |
|---|---|---|
| 22:33 | `a94b242` | 초기 세팅. HeyGen 아바타 + GPT/Gemma4 |
| 23:02 | `a948772` | Middleton OpenAI-compat endpoint로 Gemma4 호출 시도 |
| 23:04 | `ac405c5` | GPT 분기 제거, Gemma4 단일화 |
| 23:07 | `242ddf4` | Vercel `outputDirectory` 빌드 설정 |
| 23:11 | `b5a4036` | React + Vite 전환, sleek 다크 디자인 |
| 23:35 | `212524d` | **RAG + Gemma4 라우트 (`/finbot/api/interview-chat`)** 신설. Middleton에 cha-rag.js 추가, 데이터 finbot/data로 복사 |
| 23:41 | `e9fa123` | 사용자 보고 에러 `Cannot read 'url'` → null check |
| 23:50 | `66e49f9` | "Voice not found" 에러 → LiveAvatar API로 마이그레이션 시도 |
| 23:53 | `628907d` | 교수님 아바타 ID로 변경 → "Avatar not found" (LiveAvatar에 미마이그레이션) |
| 23:59 | `ff28ddc` | Rika 공개 아바타로 우회 |

### Day 2 — 2026-05-02
| 시각 | 커밋 | 내용 |
|---|---|---|
| 00:01 | `164c133` | **HeyGen v1으로 롤백** ("v1 아직 동작" 사용자 확인) + voice ID 교체 |
| 00:06 | `7b94bd9` | `avatar_id` 파라미터명 + sdp 제거 + audio 트랙 attach 수정 → 교수님 아바타 영상 정상 표시 |
| 00:33 | `226035e` | RAG 청크 21 → **37개** 확장 (YouTube + 소개페이지 봇) + 이모지 strip |
| 00:46 | `9ecfb35` | **STT 추가** (Web Speech API + 마이크 버튼) |
| 00:48 | `213b7fa` | 시작 시 마이크 자동 활성화 (사용자 클릭 컨텍스트) |
| 10:26 | `3a58446` | **인사말 자동 발화** |
| 10:52 | `7d0714d` | **학교 DB 통합**: PHP API + 이메일 인증 + 자동 로그 저장 |
| 11:07 | `5874325` | **카톡 인앱 → Chrome 자동 전환** (Android intent / iOS googlechromes) |
| 11:20 | `8591762` | 모바일 반응형 (flex-column, 100dvh, safe-area) |
| 11:30 | `1d14e17` | 첫 접속 시 자동 로그인 모달 |
| 11:32 | `cb5648c` | **AuthModal v5 패턴 리디자인** (카카오 + 동의 + 이메일 + 게스트) |

---

## 9. 주요 트러블슈팅

### 9-1. HeyGen 비디오가 안 뜸
**증상**: "연결됨"인데 영상이 빈 placeholder.
**원인**: `streaming.new`에 `avatar_name` 사용 (구 키), `streaming.start`에 `sdp` 포함 (v1은 session_id만), 비디오 트랙은 attach했지만 audio 트랙은 무시.
**해결**: `avatar_id`로 교체, `sdp` 제거, `track.kind === 'audio'`도 attach.

### 9-2. RAG 매칭이 모두 빈 컨텍스트
**증상**: 모든 질문에 "어떤 부분이 궁금하신가요?" 같은 일반 답변.
**디버깅 과정**:
1. 직접 retrieve() 호출 → 정상 매칭됨 (제넨텍 → ch-027 0.539)
2. production curl → 빈 결과
3. PM2 로그 확인 → `Q: ��������������?` (한글 깨짐)
4. JSON 파일로 호출 → 정상 작동
**원인**: git bash가 inline `-d '{...한국어...}'`를 인코딩 깨뜨림 (실제 브라우저 fetch는 UTF-8 보존되어 정상).
**보너스**: `minScore`도 0.35 → **0.25** 로 낮추고 top-K를 3 → 5로 늘려 매칭 풀 확보.

### 9-3. PHP 500 Internal Server Error
**증상**: 회원가입 호출 시 빈 응답 + 500.
**원인**: 학교 서버 PHP 5.4.45 (2013년 버전). `password_hash()`는 5.5+ 필요.
**해결**: `crypt()` + `openssl_random_pseudo_bytes()`로 bcrypt 호환 함수 자체 구현.

### 9-4. Gemma4가 빈 JSON 반환 (이전 세션)
**원인**: `response_format: {type: 'json_object'}` + thinking mode 충돌.
**해결**: Ollama 네이티브 `/api/chat` 사용, `think: false`, JSON 블록 정규식 추출.

### 9-5. 이모지가 TTS에서 "옷"으로 발음됨
**원인**: `😊` 이모지를 HeyGen TTS가 한국어로 잘못 음역.
**해결**: 시스템 프롬프트에 "이모지 금지" + 응답 후처리에서 픽토그램 전체 유니코드 블록 strip.

### 9-6. 카톡 인앱 브라우저에서 마이크/WebRTC 실패
**원인**: 카톡 in-app은 미디어 권한이 까다로움.
**해결**: `cha-biz-ai-v11`에 있던 패턴 발견·이식. UA에 `KAKAOTALK` 감지 → Android는 `intent://` Chrome, iOS는 `googlechromes://`.

---

## 10. 운영 / 유지보수 가이드

### 면담봇 재배포
```bash
# 로컬에서
cd C:\dev\cha-interview-bot
npm run build
git add -A && git commit -m "..."
git push origin master
# → Vercel 자동 배포 (1~2분)
```

### Middleton 서버 재시작
```bash
ssh -p 7822 student04@1.223.219.123
export NVM_DIR=/home/student04/.nvm && . /home/student04/.nvm/nvm.sh
pm2 restart finbot-server
pm2 logs finbot-server --lines 50
```

### RAG 청크 추가
```bash
# 1. 로컬에서 새 청크 jsonl 작성
# 2. 업로드
pscp -P 7822 new_chunks.jsonl student04@1.223.219.123:/tmp/
# 3. 임베딩 + 추가 (자동 백업됨 .bak.타임스탬프)
ssh student04@... "node /home/student04/finbot/server/scripts/add_to_rag.js /tmp/new_chunks.jsonl"
# 4. PM2 restart (모듈 캐시 재로드)
pm2 restart finbot-server
```

### 학교 DB 조회
```bash
ssh -p 10022 user2@106.247.236.2
mysql -u user2 -puser2!! cha_interview_db
> SELECT id, name, email, visit_count FROM users;
> SELECT user_id, session_id, role, LEFT(message, 60), created_at
  FROM chat_logs ORDER BY created_at DESC LIMIT 50;
```

### 학교 PHP API 수정
```bash
# 로컬에서 수정 후
pscp -P 10022 server/api.php user2@106.247.236.2:/tmp/
ssh -p 10022 user2@... "echo 'user2!!' | sudo -S cp /tmp/api.php /var/www/html/interview-api/api.php"
```

---

## 11. 미해결 / 향후 계획

### 핵심 누락 (P1)
- [ ] **종료/재시작 버튼** — 새로고침 외에 세션 끝낼 방법 없음
- [ ] **Interrupt echo 방지** — 헤드폰 안 쓰면 자기 발화 끊김. 키워드 매칭("잠깐/그만") 필요
- [ ] **자막 표시** — 발화 중 텍스트 동시 노출 (접근성)

### 운영 (P2)
- [ ] OG 메타태그 추가 (`middleton.p-e.kr/ui/index.html` 카톡 미리보기 복구) — nginx `sub_filter` 또는 정적 파일 직접 수정
- [ ] 카카오 디벨로퍼 콘솔에 `cha-interview-bot.vercel.app` 도메인 등록 확인
- [ ] 마케팅 동의 항목 DB 컬럼 추가 (`users.marketing_consent BOOLEAN`)
- [ ] 관리자 대시보드 (대화 통계, 자주 묻는 질문 분석)

### 확장 (P3)
- [ ] 다른 봇들에도 카톡 인앱 회피 적용 (금융상품매뉴얼 외 페이지들)
- [ ] STS 모드 추가 (음성 → 음성 직접 변환)
- [ ] 자체 음성 합성으로 voice 다양화
- [ ] RAG 콘텐츠 자동 업데이트 파이프라인 (학과 공지 크롤링 등)

---

## 12. 보안 / 개인정보

- **개인정보 수집**: 이름·이메일·카카오 닉네임 (동의 체크박스 필수)
- **저장 위치**: 학교 서버 MySQL (`cha_interview_db`)
- **비밀번호**: bcrypt 단방향 해시 (평문 미저장)
- **JWT**: HS256, 7일 유효, secret 서버 측 보관
- **CORS**: `cha-interview-bot.vercel.app` + 로컬 개발 도메인만 허용
- **익명 이용**: 토큰 없는 채팅도 `chat_logs`에 저장(user_id NULL)
- **마이크 권한**: 사용자 클릭 액션 후에만 요청 (브라우저 정책)

---

## 13. 참고 / 자료

- **HeyGen Streaming API**: https://docs.liveavatar.com (마이그레이션 가이드)
- **LiveKit Client SDK**: WebRTC 송수신
- **Ollama Native API**: `POST /api/chat` (`think:false`, `stream:false`)
- **bge-m3**: 한국어 임베딩 모델 (1024차원)
- **금융상품매뉴얼 v5** (`cha-Financial-Markets-v5`): UI/STT/카카오 로그인 패턴 참고
- **OAC (OpenAvatarChat)**: Middleton 다른 아바타 시스템, 동일 카카오 키 사용

---

_최종 갱신: 2026-05-02_
_작성: Claude (Anthropic) + 사용자 협업_
