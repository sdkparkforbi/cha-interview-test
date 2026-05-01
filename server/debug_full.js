// interview-chat.js와 똑같이 호출 시뮬레이션
const { retrieve } = require('/home/student04/finbot/server/utils/cha-rag');

(async () => {
  const message = '제넨텍이 뭐예요?';
  console.log('Q:', message);

  const hits = await retrieve(message, 5);  // production과 동일
  console.log('hits.length =', hits.length);
  hits.forEach(h => console.log('  ', h.score.toFixed(3), h.id, h.section));

  const context = hits.length > 0
    ? hits.map(c => `[${c.section}]\nQ: ${c.question}\nA: ${c.answer}`).join('\n\n')
    : '(관련 정보를 찾지 못했습니다)';

  console.log('\n--- CONTEXT (first 500 chars) ---');
  console.log(context.slice(0, 500));
  console.log('---');
  console.log('context length:', context.length);
})();
