/**
 * 면담봇 채팅 라우트 (RAG + Gemma4)
 * POST /api/interview-chat
 */

const express  = require('express');
const router   = express.Router();
const { retrieve } = require('../utils/cha-rag');

const GEMMA_URL   = 'http://127.0.0.1:11435/api/chat';  // Ollama 네이티브
const GEMMA_MODEL = process.env.EXAONE_MODEL || 'gemma4:latest';

function buildSystemPrompt(ragChunks) {
  const context = ragChunks.length > 0
    ? ragChunks.map(c =>
        `[${c.section}]\nQ: ${c.question}\nA: ${c.answer}`
      ).join('\n\n')
    : '(관련 정보를 찾지 못했습니다)';

  return `당신은 차의과학대학교 경영학전공 박대근 교수의 AI 면담 어시스턴트입니다.
신입생들의 전공 선택과 진로 고민을 상담해 드립니다.

## 역할
- 따뜻하고 친근하게, 해요체로 대화합니다
- 경영학전공과 진로에 대한 질문에 성실히 답변합니다
- 아래 참고 자료를 바탕으로 답변합니다
- 모르는 내용은 "교수님께 직접 여쭤보시는 걸 추천드려요"라고 안내합니다

## 출력 형식 (반드시 준수)
다른 텍스트 없이 아래 JSON 객체만 출력하세요:
{"reply":"2~4문장 한국어 답변(해요체)","ttsReply":"아바타 발화용(숫자→한글, 약어→발음)"}
- 투자 권유나 구체적 진로 보장 발언 금지

## 참고 자료 (RAG 검색 결과)
${context}`;
}

router.post('/interview-chat', async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  try {
    // 1. RAG 검색
    const hits = await retrieve(message, 3);

    // 2. 프롬프트 빌드
    const systemPrompt = buildSystemPrompt(hits);

    // 3. Gemma4 호출
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-8),
      { role: 'user', content: message }
    ];

    const response = await fetch(GEMMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMMA_MODEL,
        messages,
        stream: false,
        think: false,
        options: { num_predict: 400, temperature: 0.7 }
      })
    });

    const data = await response.json();
    // Ollama 네이티브: data.message.content
    const raw = (data.message?.content || '').trim()
      .replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

    // JSON 블록 추출 (모델이 앞뒤에 텍스트를 붙이는 경우 대비)
    let parsed;
    const jsonMatch = raw.match(/\{[\s\S]*"reply"[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch {}
    }
    if (!parsed) parsed = { reply: raw || '죄송해요, 답변을 생성하지 못했어요.', ttsReply: raw || '죄송해요, 답변을 생성하지 못했어요.' };

    if (!parsed.ttsReply) parsed.ttsReply = parsed.reply;
    return res.status(200).json(parsed);

  } catch (e) {
    console.error('[interview-chat]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
