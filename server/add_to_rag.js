// 새 청크를 finbot RAG 데이터에 추가하는 스크립트
// 사용: node add_to_rag.js /path/to/new_chunks.jsonl

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/home/student04/finbot/server/data';
const CHUNKS_PATH = path.join(DATA_DIR, 'cha_rag_chunks.json');
const EMBEDS_PATH = path.join(DATA_DIR, 'cha_rag_embeddings.json');
const OLLAMA = 'http://127.0.0.1:11436/api/embeddings';
const MODEL = 'bge-m3';

const NEW_CHUNKS_PATH = process.argv[2];
if (!NEW_CHUNKS_PATH) {
  console.error('사용: node add_to_rag.js /path/to/new_chunks.jsonl');
  process.exit(1);
}

async function embed(text) {
  const res = await fetch(OLLAMA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });
  const data = await res.json();
  const v = data.embedding;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? v.map(x => x / norm) : v;
}

(async () => {
  const chunks = JSON.parse(fs.readFileSync(CHUNKS_PATH, 'utf-8'));
  const embeds = JSON.parse(fs.readFileSync(EMBEDS_PATH, 'utf-8'));
  console.log(`[기존] ${chunks.length} 청크, ${embeds.length} 임베딩`);

  // 백업
  const ts = Date.now();
  fs.copyFileSync(CHUNKS_PATH, CHUNKS_PATH + '.bak.' + ts);
  fs.copyFileSync(EMBEDS_PATH, EMBEDS_PATH + '.bak.' + ts);
  console.log(`[백업] .bak.${ts}`);

  const newChunks = fs.readFileSync(NEW_CHUNKS_PATH, 'utf-8')
    .trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  console.log(`[추가] ${newChunks.length} 청크`);

  // 중복 ID 체크
  const existingIds = new Set(chunks.map(c => c.id));
  const dupes = newChunks.filter(c => existingIds.has(c.id));
  if (dupes.length > 0) {
    console.error('[중복 ID]', dupes.map(c => c.id).join(', '));
    process.exit(1);
  }

  for (const c of newChunks) {
    const text = c.embedding_text || (c.question + ' ' + c.answer);
    const v = await embed(text);
    chunks.push({
      id: c.id, section: c.section, question: c.question,
      answer: c.answer, keywords: c.keywords || [],
    });
    embeds.push(v);
    console.log(`  ${c.id} [${c.section}] (dim=${v.length})`);
  }

  fs.writeFileSync(CHUNKS_PATH, JSON.stringify(chunks, null, 2));
  fs.writeFileSync(EMBEDS_PATH, JSON.stringify(embeds));
  console.log(`[완료] ${chunks.length} 청크, ${embeds.length} 임베딩`);
})();
