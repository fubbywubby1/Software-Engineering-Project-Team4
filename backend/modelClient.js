const { randomUUID } = require("node:crypto");
const { analyzeText } = require("./inference");

const MODEL_INFO = {
  name: "distilroberta-babe",
  version: "1.0.0"
};

// Set MOCK_MODEL=1 to work on the extension without downloading the model.
const USE_MOCK = process.env.MOCK_MODEL === "1";

// The frontend and server always receive this format.
async function analyzeArticle(article) {
  if (USE_MOCK) {
    return getMockAnalysis(article);
  }

  const result = await analyzeText(article.text);

  return {
    schemaVersion: "1.0",
    analysisId: randomUUID(),
    status: "completed",
    model: MODEL_INFO,
    article: {
      title: article.title || null,
      characterCount: article.text.length
    },
    results: {
      overallBias: {
        score: result.score,
        label: result.label,
        confidence: null
      },
      // The BABE model only detects biased wording, not political lean or bias type.
      politicalLean: null,
      biasTypes: [],
      sentenceCount: result.sentenceCount,
      flaggedCount: result.flaggedCount,
      flaggedPassages: result.flaggedPassages
    },
    summary: buildSummary(result)
  };
}

function buildSummary(result) {
  if (result.sentenceCount === 0) {
    return "No full sentences were found to analyze.";
  }
  return `${result.flaggedCount} of ${result.sentenceCount} sentences use language ` +
    "the model flags as biased. Results are estimates, not proof of intent.";
}

function getMockAnalysis(article) {
  return {
    schemaVersion: "1.0",
    analysisId: "mock-001",
    status: "completed",
    model: {
      name: "mock-bias-model",
      version: "0.1.0"
    },
    article: {
      title: article.title || null,
      characterCount: article.text.length
    },
    results: {
      overallBias: {
        score: 72,
        label: "High",
        confidence: null
      },
      politicalLean: null,
      biasTypes: [],
      sentenceCount: 0,
      flaggedCount: 0,
      flaggedPassages: []
    },
    summary: "Mock analysis only. No AI model was used."
  };
}

module.exports = { analyzeArticle };
