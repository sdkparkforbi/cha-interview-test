/**
 * 면담봇 채팅 라우트 (RAG + Gemma4)
 * POST /api/interview-chat
 */

const express  = require('express');
const router   = express.Router();
const { retrieve } = require('../utils/cha-rag');

const GEMMA_URL   = 'http://127.0.0.1:11435/api/chat';  // Ollama 네이티브
const GEMMA_MODEL = process.env.EXAONE_MODEL || 'gemma4:latest';

// 이모지/픽토그램 제거 (TTS가 이상하게 읽는 문제 방지)
function stripEmoji(s) {
  if (!s) return s;
  return s
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')   // 픽토그램·이모지 블록
    .replace(/[\u{2600}-\u{27BF}]/gu, '')     // 기타 심볼
    .replace(/[\u{1F000}-\u{1F2FF}]/gu, '')   // 마작·도미노 등
    .replace(/[\u{2700}-\u{27BF}]/gu, '')     // 딩벳
    .replace(/[\u{FE0F}]/gu, '')              // variation selector
    .replace(/\s+/g, ' ')
    .trim();
}

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
- 아래 참고 자료에서 사용자 질문과 관련 있는 내용만 골라 답변에 활용합니다
- 참고 자료에 없는 내용은 추측하지 말고 "교수님께 직접 여쭤보시는 걸 추천드려요"라고 안내합니다
- 사용자 질문과 무관한 참고 자료 항목은 무시합니다

## 출력 규칙 (절대 준수)
- 이모지, 이모티콘, 픽토그램(예: 😊 😄 ✨ 🙂 등) 절대 사용 금지. TTS가 이상하게 읽습니다.
- 따옴표·물결표·말줄임표 같은 장식 기호도 최소화
- 투자 권유나 구체적 진로 보장 발언 금지

## 출력 형식 (반드시 준수)
다른 텍스트 없이 아래 JSON 객체만 출력하세요:
{"reply":"2~4문장 한국어 답변(해요체, 이모지 없음)","ttsReply":"아바타 발화용(숫자→한글, 약어→발음, 이모지 없음)"}

## 참고 자료 (RAG 검색 결과)
${context}`;
}

router.post('/interview-chat', async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  try {
    // 1. RAG 검색 (top-5, minScore 기본값 0.25)
    const hits = await retrieve(message, 5);
    console.log('[interview-chat] Q:', message, '→ hits:', hits.length, hits.map(h => `${h.id}(${h.score.toFixed(2)})`).join(','));

    // 2. 프롬프트 빌드
    const systemPrompt = buildSystemPrompt(hits);
    console.log('[interview-chat] systemPrompt length:', systemPrompt.length);

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

    // 후처리: 이모지/픽토그램 제거 (모델이 무시하고 넣는 경우 대비)
    parsed.reply    = stripEmoji(parsed.reply);
    parsed.ttsReply = stripEmoji(parsed.ttsReply);

    return res.status(200).json(parsed);

  } catch (e) {
    console.error('[interview-chat]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
