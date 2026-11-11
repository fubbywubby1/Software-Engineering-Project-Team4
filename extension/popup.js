// Endpoint paths are added by endpoint(). The extension uses the deployed API only.
const BACKEND_BASE_URL = "https://ai-bias-backend-bghjdsckdshzccg6.germanywestcentral-01.azurewebsites.net";

const button = document.querySelector("#check-backend");
const analyzeCurrentPageButton = document.querySelector("#analyze-current-page");
const status = document.querySelector("#status");
const statusText = document.querySelector("#status-text");
const analysis = document.querySelector("#analysis");
const loading = document.querySelector("#loading");
const loadingTitle = document.querySelector("#loading-title");
const analyzeLabel = document.querySelector("#analyze-label");
const scoreValue = document.querySelector("#score-value");
const scoreLabel = document.querySelector("#score-label");
const ringProgress = document.querySelector("#ring-progress");
const articleTitle = document.querySelector("#article-title");
const characterCount = document.querySelector("#character-count");
const summary = document.querySelector("#summary");
const flaggedSection = document.querySelector("#flagged-section");
const flaggedList = document.querySelector("#flagged-list");

function endpoint(path) {
  return `${BACKEND_BASE_URL}${path}`;
}

// Show a message in the status pill. state: idle | loading | success | error.
function setStatus(message, state = "idle") {
  statusText.textContent = message;
  status.dataset.state = state;
}

// Show or hide the loading panel, and move its checklist to the given step.
function showLoading(visible, step = "read") {
  loading.hidden = !visible;
  if (!visible) return;
  const order = ["read", "analyze"];
  loading.querySelectorAll(".steps li").forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    const current = order.indexOf(step);
    item.dataset.state = index < current ? "done" : index === current ? "active" : "pending";
  });
  loadingTitle.textContent = step === "read" ? "Reading the article…" : "Analyzing the wording…";
}

// Count a number up from zero so the score feels alive.
function animateNumber(element, target, duration = 1200) {
  const start = performance.now();
  function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    element.textContent = Math.round(target * eased);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Call the backend and show a simple success or failure message in the popup.
async function checkBackend() {
  button.disabled = true;
  button.classList.add("loading");
  setStatus("Checking backend…", "loading");

  try {
    const response = await fetch(endpoint("/health"));

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}.`);
    }

    const result = await response.json();
    if (result.status === "ok") {
      setStatus("Backend connected.", "success");
    } else {
      setStatus("Backend returned an unexpected response.", "error");
    }
  } catch {
    setStatus("Could not reach the hosted backend.", "error");
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
  }
}

button.addEventListener("click", checkBackend);

// This function runs inside the current web page, not inside the extension popup.
function extractArticleFromPage() {
  const title = document.querySelector('meta[property="og:title"]')?.content
    || document.querySelector("h1")?.innerText
    || document.title;

  // Article text lives in <p> paragraphs. Menus, ads, captions, and story teasers are skipped.
  const SKIP = "nav, header, footer, aside, form, figure, figcaption, [aria-hidden='true']";
  function paragraphsIn(root) {
    return Array.from(root.querySelectorAll("p"))
      .filter((p) => !p.closest(SKIP))
      .map((p) => p.innerText.replace(/\s+/g, " ").trim())
      .filter((text) => text.split(" ").length >= 6);
  }
  const length = (paragraphs) => paragraphs.join(" ").length;

  // Prefer the article container with the most paragraph text. Pages often have several
  // small <article> cards, so a container that holds under half the page's text is not the story.
  const pageParagraphs = paragraphsIn(document.body);
  let best = [];
  for (const candidate of document.querySelectorAll("article, main, [itemprop='articleBody']")) {
    const paragraphs = paragraphsIn(candidate);
    if (length(paragraphs) > length(best)) {
      best = paragraphs;
    }
  }
  if (length(best) < length(pageParagraphs) / 2) {
    best = pageParagraphs;
  }

  // One paragraph per line, so the backend never merges separate paragraphs into one sentence.
  const text = best.length > 0
    ? best.join("\n")
    : document.body.innerText.replace(/[^\S\n]+/g, " ").replace(/ *\n[\s]*/g, "\n").trim();
  return { title, text };
}

// Display the shared backend response format for either a test or real page.
function showAnalysis(result) {
  const overall = result.results.overallBias;
  const hasScore = overall.score !== null;

  analysis.dataset.level = hasScore ? overall.label : "";
  scoreLabel.textContent = hasScore ? overall.label : "N/A";
  articleTitle.textContent = result.article.title || "Untitled article";
  characterCount.textContent = Number(result.article.characterCount).toLocaleString();
  summary.textContent = result.summary;

  // Show the sentences the model is most confident are biased.
  const passages = result.results.flaggedPassages || [];
  flaggedList.replaceChildren(...passages.map((passage, index) => {
    const item = document.createElement("li");
    item.style.setProperty("--i", index);

    const text = document.createElement("span");
    text.textContent = passage.text;

    const probability = document.createElement("div");
    probability.className = "probability";
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.dataset.width = `${passage.biasScore}%`;
    bar.append(fill);
    const percent = document.createElement("span");
    percent.textContent = `${passage.biasScore}% likely biased`;
    probability.append(bar, percent);

    item.append(text, probability);
    return item;
  }));
  flaggedSection.hidden = passages.length === 0;

  // Reset, reveal, then animate the ring, the number, and the bars.
  const circumference = 2 * Math.PI * 42;
  ringProgress.style.strokeDashoffset = circumference;
  scoreValue.textContent = "0";
  analysis.hidden = false;
  void analysis.offsetWidth; // force a reflow so the transitions replay

  requestAnimationFrame(() => {
    if (hasScore) {
      const score = Math.max(0, Math.min(100, overall.score));
      ringProgress.style.strokeDashoffset = circumference * (1 - score / 100);
      animateNumber(scoreValue, score);
    } else {
      scoreValue.textContent = "–";
    }
    flaggedList.querySelectorAll(".bar > span").forEach((fill, index) => {
      setTimeout(() => { fill.style.width = fill.dataset.width; }, 500 + index * 120);
    });
  });
}

// Extract text from the active tab, then submit it to the same backend endpoint.
async function analyzeCurrentPage() {
  analyzeCurrentPageButton.disabled = true;
  analyzeCurrentPageButton.classList.add("loading");
  analyzeLabel.textContent = "Analyzing…";
  analysis.hidden = true;
  showLoading(true, "read");
  setStatus("Reading current page…", "loading");

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

    showLoading(true, "analyze");
    setStatus("Sending article to backend…", "loading");
    const response = await fetch(endpoint("/api/analyze"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}.`);
    }

    const result = await response.json();
    showLoading(false);
    showAnalysis(result);
    setStatus("Current page analyzed.", "success");
  } catch (error) {
    setStatus(error.message || "Could not read the current page.", "error");
  } finally {
    showLoading(false);
    analyzeCurrentPageButton.disabled = false;
    analyzeCurrentPageButton.classList.remove("loading");
    analyzeLabel.textContent = "Analyze Current Page";
  }
}

analyzeCurrentPageButton.addEventListener("click", analyzeCurrentPage);
