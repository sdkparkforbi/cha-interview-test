# 2026-05-04 변경 정리

이 문서는 썸네일/인사말 변경 이후부터 FTF/STS/TTT 대화 모드 추가까지의 변경사항을 정리한 것입니다.

## 기준 커밋

- `72a49eb` - Update thumbnail and greeting wording
- `26b03aa` - Hardcode Kakao JavaScript key
- `a126852` - Add FTF STS TTT conversation modes

참고: 직전 관련 작업으로 방문 환영 문구 위치 이동(`4271136`)과 방문 횟수 한글 서수화(`e3a3366`)가 먼저 반영되어 있었습니다.

## 1. Vercel 썸네일 변경

수정 파일:

- `public/og-thumbnail.png`
- `index.html`

변경 내용:

- Open Graph/Twitter 공유 썸네일 이미지를 `이규성 테스트` 배지가 들어간 이미지로 교체했습니다.
- `og:image`, `twitter:image`, `og:url`을 현재 서비스 도메인 기준으로 변경했습니다.
  - `https://cha-interview-test-two.vercel.app/og-thumbnail.png`
- 썸네일 이미지 크기 메타 값을 실제 이미지 크기에 맞춰 조정했습니다.
  - `og:image:width=2816`
  - `og:image:height=1536`

검증:

- Vercel 배포 후 썸네일 URL이 `200`으로 응답하는 것 확인
- 배포 HTML에 새 `og:image` URL이 반영된 것 확인

## 2. 첫 인사말 문구 변경

수정 파일:

- `src/App.jsx`

변경 내용:

- 첫 인사말 구조를 아래 형태로 변경했습니다.

```text
안녕하세요. 이규성님 첫번째 방문을 환영합니다.
저는 차의과학대학교 신입생 담임교수 박대근 교수의 AI 면담 어시스턴트예요.
전공 선택이나 진로에 대해 궁금한 점을 편하게 물어봐 주세요.
```

- 화면에 보이는 채팅 인사말과 아바타 TTS 인사말이 같은 구조를 쓰도록 정리했습니다.
- 방문 횟수는 숫자 표기 대신 한글 서수로 읽히게 유지했습니다.
  - `1번째` 대신 `첫번째`
  - `2번째` 대신 `두번째`
  - `11번째` 대신 `열한번째`
  - `21번째` 대신 `스물한번째`

주의:

- 100회 이상 방문은 현재 숫자 기반 fallback으로 표시됩니다.
  - 예: `100번째`

## 3. 카카오 JavaScript 키 고정

수정 파일:

- `src/main.jsx`
- `.env.example`

변경 내용:

- Vercel 환경변수 `VITE_KAKAO_JS_KEY`에 의존하지 않도록 변경했습니다.
- 카카오 JavaScript 키를 코드에서 직접 초기화하도록 되돌렸습니다.

```js
const kakaoJsKey = 'f756aef8a9d7573742de8b220ee1db1b'
```

- `.env.example`에서는 카카오 JS 키가 더 이상 필수 Vercel 환경변수처럼 보이지 않도록 정리했습니다.

주의:

- 카카오 JavaScript 키는 브라우저에 노출되는 공개 성격의 키입니다.
- 보안은 Kakao Developers의 플랫폼 도메인 제한으로 관리해야 합니다.
- 현재 서비스 도메인 `https://cha-interview-test-two.vercel.app`가 Kakao Developers에 등록되어 있어야 합니다.

## 4. FTF / STS / TTT 대화 모드 추가

수정 파일:

- `src/App.jsx`
- `src/components/AvatarPanel.jsx`
- `src/components/AvatarPanel.module.css`
- `src/components/ChatPanel.jsx`
- `src/components/ChatPanel.module.css`

추가된 모드:

- `FTF`: Face to Face
- `STS`: Speak to Speak
- `TTT`: Text to Text

현재 동작:

### FTF

- 아바타 영상 사용
- 마이크 음성 대화 사용
- 사용자 웹캠 프리뷰 표시
- 시작 버튼 문구: `화상 시작`

주의:

- 사용자 웹캠은 현재 화면 프리뷰 용도입니다.
- AI가 사용자의 얼굴이나 카메라 영상을 분석하지는 않습니다.

### STS

- 아바타 영상 영역은 숨기고 음성 대화 화면을 표시합니다.
- 마이크 음성 입력 사용
- HeyGen 음성 발화 사용
- 시작 버튼 문구: `음성 시작`

주의:

- 현재 구조상 HeyGen 세션을 사용합니다.
- 영상은 UI에서 숨기지만, 별도 순수 TTS 엔진으로 완전히 분리한 구조는 아닙니다.

### TTT

- HeyGen 아바타 세션을 시작하지 않습니다.
- 마이크 버튼을 숨깁니다.
- 음성/TTS 없이 텍스트 채팅만 사용합니다.
- 시작 버튼 문구: `텍스트 시작`

효과:

- 마이크 권한 문제나 모바일 음성 인식 문제가 있을 때 텍스트 전용 모드로 회피할 수 있습니다.
- HeyGen이 필요 없는 상담 흐름을 제공할 수 있습니다.

## 5. 모드 전환 처리

변경 내용:

- 대화 중 모드를 바꾸면 현재 대화가 초기화된다는 확인창을 띄웁니다.
- 모드 변경 시 기존 마이크, 아바타 세션, 카메라 상태를 정리하도록 처리했습니다.
- TTT 모드에서는 마이크 토글이 동작하지 않도록 막았습니다.

## 6. 검증 내역

각 단계에서 확인한 내용:

- `vite build` 성공
- GitHub `main` push 성공
- Vercel 자동 배포 성공
- 실제 배포 번들에 주요 문구 반영 확인
  - `FTF`
  - `STS`
  - `TTT`
  - `화상 시작`
  - `음성 시작`
  - `텍스트 시작`
  - `마이크와 소리 없이 채팅`

로컬 확인:

- 개발 서버 응답 확인
  - `http://127.0.0.1:5173`

제한:

- 현재 로컬 환경에 Playwright 패키지가 없어 자동 브라우저 스크린샷 검증은 실행하지 못했습니다.
- 실제 카메라/마이크 권한 동작은 배포 URL에서 브라우저 권한을 허용한 뒤 한 번 더 직접 확인하는 것이 좋습니다.

## 현재 배포 상태

- 기능 기준 최신 커밋: `a126852`
- 배포 URL: `https://cha-interview-test-two.vercel.app`
- Vercel 상태: `a126852` 배포 완료 확인
