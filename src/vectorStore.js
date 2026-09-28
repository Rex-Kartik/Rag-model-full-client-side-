import { pipeline, env } from '@xenova/transformers';

// Skip local check to download models directly from HuggingFace
env.allowLocalModels = false;
// Use WebAssembly (which is the default)
env.backends.onnx.wasm.numThreads = 1;

let extractorInstance = null;

export const initExtractor = async (onProgress) => {
  if (!extractorInstance) {
    extractorInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: onProgress
    });
  }
  return extractorInstance;
};

export const generateEmbedding = async (text) => {
  const extractor = await initExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
};

export const cosineSimilarity = (vecA, vecB) => {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const chunkText = (text, maxChars = 512, overlap = 64) => {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = i + maxChars;
    if (end >= text.length) {
      chunks.push(text.slice(i));
      break;
    }
    // Try to find a space near the end
    let spaceIdx = text.lastIndexOf(' ', end);
    if (spaceIdx > i + maxChars / 2) {
      end = spaceIdx;
    }
    chunks.push(text.slice(i, end));
    i = end - overlap;
  }
  return chunks;
};
