const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { splitSentences, scoreSentences, labelForScore, analyzeText, MODELS_DIR } = require("./inference");

test("splitSentences keeps full sentences with their positions", () => {
  const text = "Breaking news. The senator unveiled the new bill on Tuesday morning. "
    + "Critics called it a reckless scheme that will hurt families.";
  const sentences = splitSentences(text);

  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].text, "The senator unveiled the new bill on Tuesday morning.");
  for (const sentence of sentences) {
    assert.equal(text.slice(sentence.startOffset, sentence.endOffset), sentence.text);
  }
});

test("splitSentences drops short fragments", () => {
  assert.deepEqual(splitSentences("Home. Sports. Weather. Sign in."), []);
});

test("labelForScore uses the plan's thresholds", () => {
  assert.equal(labelForScore(0), "Low");
  assert.equal(labelForScore(14), "Low");
  assert.equal(labelForScore(15), "Moderate");
  assert.equal(labelForScore(35), "Moderate");
  assert.equal(labelForScore(36), "High");
});

test("scoreSentences reports the share of flagged sentences and the top three", () => {
  const sentences = ["a", "b", "c", "d", "e"].map((text, i) => ({ text, startOffset: i, endOffset: i + 1 }));
  const result = scoreSentences(sentences, [0.9, 0.1, 0.6, 0.95, 0.7]);

  assert.equal(result.score, 80);
  assert.equal(result.label, "High");
  assert.equal(result.flaggedCount, 4);
  assert.deepEqual(result.flaggedPassages.map((p) => p.text), ["d", "a", "e"]);
  assert.equal(result.flaggedPassages[0].biasScore, 95);
});

test("scoreSentences handles an article with no sentences", () => {
  const result = scoreSentences([], []);
  assert.equal(result.score, 0);
  assert.equal(result.label, "Low");
  assert.deepEqual(result.flaggedPassages, []);
});

// Runs only when the trained model has been unzipped into backend/models/bias-model.
const hasModel = fs.existsSync(path.join(MODELS_DIR, "bias-model", "onnx", "model_quantized.onnx"));

test("analyzeText runs the real model", { skip: !hasModel && "model not installed" }, async () => {
  const result = await analyzeText(
    "The city council approved the new budget on Tuesday after a long meeting. "
    + "Critics called the plan a reckless giveaway that will bankrupt hardworking families."
  );
  assert.equal(result.sentenceCount, 2);
  assert.ok(result.score >= 0 && result.score <= 100);
});
