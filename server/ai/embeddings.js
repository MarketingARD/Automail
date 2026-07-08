// Embeddings pour la base RAG.
// 1) Si @xenova/transformers est installé (dépendance optionnelle), on utilise
//    un modèle multilingue local (multilingual-e5-small) — aucune clé requise.
// 2) Sinon, repli sur un embedding par feature-hashing (bag-of-words) : moins
//    fin sémantiquement mais déterministe, instantané et suffisant pour
//    retrouver des fils de discussion par vocabulaire partagé.

const DIM = 384;
let pipelinePromise = null;
let localModelFailed = false;

async function localPipeline() {
  if (localModelFailed) return null;
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        const { pipeline, env } = await import('@xenova/transformers');
        env.allowLocalModels = true;
        return await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
          quantized: true,
        });
      } catch (err) {
        console.warn('[rag] modèle local indisponible, repli hashing:', err.message);
        localModelFailed = true;
        return null;
      }
    })();
  }
  return pipelinePromise;
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .match(/[a-z0-9]{2,}/g) || [];
}

// FNV-1a 32 bits — stable entre exécutions.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashEmbed(text) {
  const vec = new Float32Array(DIM);
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const h = fnv1a(tok);
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[h % DIM] += sign;
    // bigrammes pour un peu de contexte
    if (i > 0) {
      const h2 = fnv1a(tokens[i - 1] + '_' + tok);
      vec[h2 % DIM] += ((h2 & 1) === 0 ? 1 : -1) * 0.5;
    }
  }
  return normalize(vec);
}

function normalize(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/** Retourne { vector: Float32Array, model: string }. `kind`: 'passage' | 'query' (préfixes e5). */
export async function embed(text, kind = 'passage') {
  const pipe = await localPipeline();
  if (pipe) {
    try {
      const out = await pipe(`${kind}: ${text.slice(0, 2000)}`, { pooling: 'mean', normalize: true });
      return { vector: new Float32Array(out.data), model: 'multilingual-e5-small' };
    } catch (err) {
      console.warn('[rag] embedding local échoué, repli hashing:', err.message);
    }
  }
  return { vector: hashEmbed(text), model: 'hash-v1' };
}

export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // vecteurs déjà normalisés
}

export function vecToBlob(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function blobToVec(blob) {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}
