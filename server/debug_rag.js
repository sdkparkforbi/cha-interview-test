const { retrieve } = require('/home/student04/finbot/server/utils/cha-rag');

(async () => {
  const queries = [
    '제넨텍이 뭐예요?',
    '수학 못해도 괜찮을까요?',
    '교수님 누구세요',
    '학과 소개 좀 해주세요',
    '복수전공',
  ];
  for (const q of queries) {
    const hits = await retrieve(q, 5, 0);  // 모든 점수 봄
    console.log('=== Q:', q, '===');
    hits.forEach(h => console.log('  ', h.score.toFixed(4), h.id, '['+h.section+']', h.question.slice(0, 30)));
  }
})();
