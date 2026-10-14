
const MODEL_URL = process.env.MODEL_URL;

// The frontend and server always receive this format.
async function analyzeArticle(article) {
  if (!MODEL_URL) {
    return getMockAnalysis(article);
  }

  const response = await fetch(`${MODEL_URL}/predict`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: article.text
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(
      `Model service returned ${response.status}`
    );
  }

  const prediction = await response.json();

  // Convert the model's raw output into your
  // standardized frontend response.
  return normalizePrediction(prediction, article);
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
        confidence: null
      },
      politicalLean: {
        label: "left",
        confidence: null
      },
      biasTypes: [
        {
          type: "loaded_language",
          score: 85
        }
      ],
      flaggedPassages: []
    },
    summary: "Mock analysis only. No AI model was used."
  };
}

function normalizePrediction(prediction, article) {
  // Define the real model's output mapping here
  // when its interface is finalized.
  throw new Error("Model adapter not implemented.");
}

module.exports = { analyzeArticle };
