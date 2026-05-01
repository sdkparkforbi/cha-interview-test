// 면담봇 LLM 핸들러
// model 파라미터: 'gpt' (기본) | 'gemma' (관리자)

const TRANSCRIPT = `
[박대근 교수 경영학전공 소개 인터뷰 전사]

경영학은 기업을 다루는 학문입니다. 기업을 만들고, 생존하게 하고, 성장하게 하면서, 사회에 책임을 지게 하는 것을 연구합니다.

경영학 전공 분야: 마케팅(상품·고객 관리), 인사관리·조직행동론, 재무·회계, 전략·기획.

기업에서 일하려면 기업에서 통하는 언어가 필요한데, 경영학이 그 언어를 가르쳐 줍니다.

차의과학대학교 경영학의 특징: 바이오헬스케어 산업 특성화 대학으로, 디지털 보건의료·AI 의료데이터·경영학의 트라이앵글 융합이 핵심입니다.
- 디지털 보건의료: 헬스케어 산업 이해
- AI 의료데이터: 데이터 분석 방법론
- 경영학: 경영 문제와 기획 능력

미디어커뮤니케이션학과도 잘 어울립니다. 마케팅의 소비자 소통, PR·IR·컨슈머릴레이션 등이 경영학과 직접 연결됩니다.

창업 연계: 학교 라이즈(RISE) 사업을 통해 창업 자금 지원이 가능합니다.

차병원 그룹 연계: 차병원 그룹 임직원을 멘토로 경영 사례 개발, 현장 견학 등 실무 교육을 진행합니다.

복수전공 추천: 생명과학+경영학 조합을 강력히 권장. 제넨텍(1976년 허버트 보이어+로버트 스완슨)처럼 이공계+경영 융합 인재 양성이 목표입니다.

경영학 공부 시작법: 주식 투자. 기업에 대한 호기심이 경영학의 출발점입니다.

취업 분야: 헬스케어 산업(차병원 그룹 등), 바이오·제약·AI 기업, 창업 등.
`.trim();

function buildSystemPrompt() {
  return `당신은 차의과학대학교 경영학전공 박대근 교수의 AI 면담 어시스턴트입니다.
신입생들의 전공 선택과 진로 고민을 상담해 드립니다.

## 역할
- 따뜻하고 친근하게, 해요체로 대화합니다
- 경영학전공과 진로에 대한 질문에 성실히 답변합니다
- 아래 교수님 인터뷰 내용을 기반으로 답변합니다
- 모르는 내용은 "교수님께 직접 여쭤보시는 걸 추천드려요"라고 안내합니다

## 답변 규칙
- 2~4문장으로 간결하게 (아바타가 음성으로 읽습니다)
- 투자 권유나 구체적 진로 보장 발언 금지
- 반드시 JSON으로만 응답: { "reply": "...", "ttsReply": "..." }
- ttsReply: 숫자는 한글로, 영어 약어는 한글 발음으로 변환

## 교수님 인터뷰 내용 (RAG 컨텍스트)
${TRANSCRIPT}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).end();

  const { message, history = [], model = 'gpt', adminPassword } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  // Gemma 모드는 관리자 비밀번호 필요
  const useGemma = model === 'gemma' && adminPassword === process.env.ADMIN_PASSWORD;

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    let parsed;

    if (useGemma) {
      // Gemma4 via Middleton Express
      const MIDDLETON_URL = process.env.MIDDLETON_API_URL;
      const MIDDLETON_KEY = process.env.MIDDLETON_API_KEY;
      if (!MIDDLETON_URL || !MIDDLETON_KEY) {
        return res.status(500).json({ error: 'Middleton not configured' });
      }
      const response = await fetch(`${MIDDLETON_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': MIDDLETON_KEY },
        body: JSON.stringify({ message, history, systemPrompt: buildSystemPrompt() })
      });
      parsed = await response.json();
    } else {
      // GPT-4o-mini (기본)
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

      const messages = [
        { role: 'system', content: buildSystemPrompt() },
        ...history.slice(-8),
        { role: 'user', content: message }
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          max_tokens: 300,
          temperature: 0.7,
          response_format: { type: 'json_object' }
        })
      });
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      try { parsed = JSON.parse(content); }
      catch { parsed = { reply: content, ttsReply: content }; }
    }

    if (!parsed.ttsReply) parsed.ttsReply = parsed.reply;
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
