// The local server started with `npm start`.
const HEALTH_URL = "http://localhost:3000/health";
const ANALYZE_URL = "http://localhost:3000/api/analyze";

const button = document.querySelector("#check-backend");
const analyzeButton = document.querySelector("#analyze-test-article");
const analyzeCurrentPageButton = document.querySelector("#analyze-current-page");
const status = document.querySelector("#status");
const analysis = document.querySelector("#analysis");
const framing = document.querySelector("#framing");
const articleTitle = document.querySelector("#article-title");
const characterCount = document.querySelector("#character-count");
const summary = document.querySelector("#summary");
const flaggedSection = document.querySelector("#flagged-section");
const flaggedList = document.querySelector("#flagged-list");

// A temporary article proves the analysis request works before page extraction exists.
const TEST_ARTICLE = {
  title: "Test Article",
  text: "The city council approved the new budget on Tuesday after a two-hour meeting. "
    + "Critics called the plan a reckless giveaway that will bankrupt hardworking families. "
    + "The budget includes funding for road repairs and two new public libraries.",
};

// Call the backend and show a simple success or failure message in the popup.
async function checkBackend() {
  button.disabled = true;
  status.textContent = "Checking backend…";

  try {
    const response = await fetch(HEALTH_URL);

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}.`);
    }

    const result = await response.json();
    status.textContent = result.status === "ok"
      ? "Backend connected."
      : "Backend returned an unexpected response.";
  } catch {
    status.textContent = "Could not reach the backend. Start it with npm start.";
  } finally {
    button.disabled = false;
  }
}

button.addEventListener("click", checkBackend);

// Send the temporary article to the backend and display its response.
async function analyzeTestArticle() {
  analyzeButton.disabled = true;
  analysis.hidden = true;
  status.textContent = "Sending test article…";

  try {
    const response = await fetch(ANALYZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article: TEST_ARTICLE }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}.`);
    }

    const result = await response.json();
    showAnalysis(result);
    status.textContent = "Test article analyzed.";
  } catch {
    status.textContent = "Could not analyze the test article. Is the backend running?";
  } finally {
    analyzeButton.disabled = false;
  }
}

analyzeButton.addEventListener("click", analyzeTestArticle);

// This function runs inside the current web page, not inside the extension popup.
function extractArticleFromPage() {
  const title = document.querySelector('meta[property="og:title"]')?.content
    || document.querySelector("h1")?.innerText
    || document.title;
  const source = document.querySelector("article") || document.querySelector("main") || document.body;
  const copy = source.cloneNode(true);

  // Remove common page sections that are not part of the article itself.
  copy.querySelectorAll("nav, header, footer, aside, form, script, style, noscript").forEach((element) => {
    element.remove();
  });

  // Keep line breaks so separate headlines and links are not merged into one sentence.
  const text = copy.innerText
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
  return { title, text };
}

// Display the shared backend response format for either a test or real page.
function showAnalysis(result) {
  const overall = result.results.overallBias;

  framing.textContent =
    overall.score === null
      ? "Not available"
      : `${overall.score} / 100 (${overall.label})`;

  articleTitle.textContent =
    result.article.title || "Untitled article";

  characterCount.textContent =
    result.article.characterCount;

  summary.textContent = result.summary;

  // Show the sentences the model is most confident are biased.
  const passages = result.results.flaggedPassages || [];
  flaggedList.replaceChildren(...passages.map((passage) => {
    const item = document.createElement("li");
    const probability = document.createElement("span");
    probability.className = "probability";
    probability.textContent = ` (${passage.biasScore}% likely biased)`;
    item.append(passage.text, probability);
    return item;
  }));
  flaggedSection.hidden = passages.length === 0;

  analysis.hidden = false;
}

// Extract text from the active tab, then submit it to the same backend endpoint.
async function analyzeCurrentPage() {
  analyzeCurrentPageButton.disabled = true;
  analysis.hidden = true;
  status.textContent = "Reading current page…";

  try {
    // This capability becomes available only after Chrome reloads the updated manifest.
    if (!chrome.scripting?.executeScript) {
      throw new Error("Reload this extension in chrome://extensions, then try again.");
    }

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

    if (!tab?.id) {
      throw new Error("No active tab was found.");
    }

    const [{ result: article }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractArticleFromPage,
    });

    if (!article.text) {
      throw new Error("No readable text was found on this page.");
    }

    status.textContent = "Sending article to backend…";
    const response = await fetch(ANALYZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}.`);
    }

    showAnalysis(await response.json());
    status.textContent = "Current page analyzed.";
  } catch (error) {
    status.textContent = error.message || "Could not read the current page.";
  } finally {
    analyzeCurrentPageButton.disabled = false;
  }
}

analyzeCurrentPageButton.addEventListener("click", analyzeCurrentPage);
