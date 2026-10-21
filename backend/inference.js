const path = require("node:path");

// The trained model folder (unzipped bias-model.zip) lives here and is kept out of Git.
const MODELS_DIR = process.env.MODELS_DIR || path.join(__dirname, "models");
const MODEL_NAME = "bias-model";

// Sentences shorter than this are usually headings, captions, or leftover page text.
const MIN_WORDS = 6;
// Cap the work per request so one very long page cannot use up the server's CPU.
const MAX_SENTENCES = 200;
// A sentence counts as biased when the model's BIASED probability reaches this value.
const BIASED_THRESHOLD = 0.5;
// Number of flagged sentences returned to the popup.
const TOP_FLAGGED = 3;

let classifierPromise = null;

// Load the model once and reuse it. transformers.js is an ES module, so it is imported dynamically.
function loadClassifier() {
  if (!classifierPromise) {
    classifierPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowRemoteModels = false;
      env.localModelPath = MODELS_DIR;
      return pipeline("text-classification", MODEL_NAME, { dtype: "q8" });
    })();
    // Let a later request retry if loading failed (for example, the model folder was missing).
    classifierPromise.catch(() => {
      classifierPromise = null;
    });
  }
  return classifierPromise;
}

// Split article text into sentences and remember where each one starts and ends.
function splitSentences(text) {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const sentences = [];

  for (const { segment, index } of segmenter.segment(text)) {
    const trimmed = segment.trim();
    if (trimmed.split(/\s+/).length < MIN_WORDS) {
      continue;
    }
    const startOffset = index + segment.indexOf(trimmed);
    sentences.push({ text: trimmed, startOffset, endOffset: startOffset + trimmed.length });
  }

  return sentences.slice(0, MAX_SENTENCES);
}

// Map the share of flagged sentences to the label shown in the popup.
function labelForScore(score) {
  if (score < 15) return "Low";
  if (score <= 35) return "Moderate";
  return "High";
}

// Turn per-sentence probabilities into the article score and the top flagged sentences.
function scoreSentences(sentences, biasedProbabilities) {
  const scored = sentences.map((sentence, i) => ({ ...sentence, probability: biasedProbabilities[i] }));
  const flagged = scored.filter((sentence) => sentence.probability >= BIASED_THRESHOLD);
  const score = scored.length === 0 ? 0 : Math.round((100 * flagged.length) / scored.length);

  return {
    score,
    label: labelForScore(score),
    sentenceCount: scored.length,
    flaggedCount: flagged.length,
    flaggedPassages: flagged
      .sort((a, b) => b.probability - a.probability)
      .slice(0, TOP_FLAGGED)
      .map(({ text, startOffset, endOffset, probability }) => ({
        text,
        startOffset,
        endOffset,
        biasScore: Math.round(probability * 100),
      })),
  };
}

// Run the model on every sentence and return the BIASED probability for each one.
async function classifySentences(sentences) {
  if (sentences.length === 0) {
    return [];
  }
  const classify = await loadClassifier();
  // top_k: null returns both labels, so the BIASED probability is always available.
  const outputs = await classify(sentences.map((s) => s.text), { top_k: null });
  return outputs.map((labels) => labels.find((l) => l.label === "BIASED")?.score ?? 0);
}

async function analyzeText(text) {
  const sentences = splitSentences(text);
  const probabilities = await classifySentences(sentences);
  return scoreSentences(sentences, probabilities);
}

module.exports = { analyzeText, loadClassifier, splitSentences, scoreSentences, labelForScore, MODELS_DIR };
