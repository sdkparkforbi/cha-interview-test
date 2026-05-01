/**
 * CHA RAG 유틸리티 (Node.js)
 * chunks.json + embeddings.json 로드 → 코사인 유사도 검색
 * bge-m3 임베딩: Ollama localhost:11436
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR    = path.join(__dirname, '../data');
const CHUNKS_PATH = path.join(DATA_DIR, 'cha_rag_chunks.json');
const EMBEDS_PATH = path.join(DATA_DIR, 'cha_rag_embeddings.json');
const OLLAMA_URL  = 'http://127.0.0.1:11436/api/embeddings';
const EMBED_MODEL = 'bge-m3';

// 모듈 로드 시 1회 캐시
let _chunks = null;
let _embeds = null;

function load() {
  if (_chunks && _embeds) return;
  _chunks = JSON.parse(fs.readFileSync(CHUNKS_PATH, 'utf-8'));
  _embeds = JSON.parse(fs.readFileSync(EMBEDS_PATH, 'utf-8'));
}

async function embed(text) {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    signal: AbortSignal.timeout(8000)
  });
  const data = await res.json();
  const vec = data.embedding;
  // 정규화
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vec.map(v => v / norm) : vec;
}

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * 질문과 유사한 청크 top_k개 반환
 * @param {string} query
 * @param {number} topK
 * @param {number} minScore
 * @returns {Array<{id, section, question, answer, score}>}
 */
async function retrieve(query, topK = 3, minScore = 0.35) {
  load();
  const qvec = await embed(query);

  const scored = _embeds.map((evec, i) => ({
    chunk: _chunks[i],
    score: dotProduct(qvec, evec)
  }));

  return scored
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(x => ({ ...x.chunk, score: x.score }));
}

module.exports = { retrieve };
