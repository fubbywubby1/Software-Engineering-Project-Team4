// Endpoint paths are added by endpoint(). The extension uses the deployed API only.
const BACKEND_BASE_URL = "https://ai-bias-backend-bghjdsckdshzccg6.germanywestcentral-01.azurewebsites.net";

const backendButton = document.querySelector("#backend-status");
const backendLabel = document.querySelector("#backend-label");
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
const summary = document.querySelector("#summary");
const flaggedSection = document.querySelector("#flagged-section");
const flaggedList = document.querySelector("#flagged-list");

// The tab that was analyzed, so a clicked sentence can be located on that page.
let analyzedTabId = null;

function endpoint(path) {
  return `${BACKEND_BASE_URL}${path}`;
}

// Errors are the only thing shown in the status line; progress and success are not.
// Call with no message to clear it.
function setStatus(message = "") {
  statusText.textContent = message;
  status.hidden = !message;
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

// Update the small green/red pill in the header. state: checking | online | offline.
const BACKEND_STATES = {
  checking: { label: "Checking", title: "Checking backend…" },
  online: { label: "Online", title: "Backend connected. Click to recheck." },
  offline: { label: "Offline", title: "Can't reach the backend. Click to retry." },
};

function setBackendState(state) {
  const { label, title } = BACKEND_STATES[state];
  backendButton.dataset.state = state;
  backendLabel.textContent = label;
  backendButton.title = title;
  backendButton.setAttribute("aria-label", `Backend status: ${label.toLowerCase()}. Click to recheck.`);
}

// Ping the backend's /health route. Runs when the popup opens, when the pill is clicked,
// and after an analysis fails once the article was sent, so the pill reflects what happened.
let backendCheckInFlight = false;
async function checkBackend() {
  if (backendCheckInFlight) return;
  backendCheckInFlight = true;
  setBackendState("checking");

  // A sleeping Azure container can take a while to wake, so allow a generous timeout.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(endpoint("/health"), { signal: controller.signal });
    const result = response.ok ? await response.json() : null;
    setBackendState(result?.status === "ok" ? "online" : "offline");
  } catch {
    setBackendState("offline");
  } finally {
    clearTimeout(timeout);
    backendCheckInFlight = false;
  }
}

backendButton.addEventListener("click", checkBackend);
checkBackend();

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

// This function runs inside the current web page, not inside the extension popup.
// It finds a sentence in the page text, scrolls to it, and highlights it.
function jumpToSentenceInPage(sentence) {
  const normalize = (s) => s.replace(/\s+/g, " ").trim();
  const target = normalize(sentence);
  if (!target) return false;

  // Flatten the page's text nodes into one whitespace-collapsed string, remembering
  // which node and offset every character came from.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && !node.parentElement.closest("script, style, noscript, template")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  let flat = "";
  const map = [];
  let lastWasSpace = true;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue;
    for (let i = 0; i < value.length; i++) {
      if (/\s/.test(value[i])) {
        if (lastWasSpace) continue;
        flat += " ";
        lastWasSpace = true;
      } else {
        flat += value[i];
        lastWasSpace = false;
      }
      map.push({ node, offset: i });
    }
  }

  // The same sentence can appear twice (teasers, pull quotes), so take the first visible match.
  let range = null;
  for (let from = flat.indexOf(target); from !== -1; from = flat.indexOf(target, from + 1)) {
    const start = map[from];
    const end = map[from + target.length - 1];
    const candidate = document.createRange();
    candidate.setStart(start.node, start.offset);
    candidate.setEnd(end.node, end.offset + 1);
    if (candidate.getClientRects().length > 0) {
      range = candidate;
      break;
    }
  }
  if (!range) return false;

  range.startContainer.parentElement.scrollIntoView({ behavior: "smooth", block: "center" });

  if (window.CSS && CSS.highlights && typeof Highlight !== "undefined") {
    let style = document.getElementById("bias-analyzer-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "bias-analyzer-style";
      style.textContent = "::highlight(bias-analyzer) { background-color: #ffd43b; color: #111; }";
      document.head.append(style);
    }
    CSS.highlights.set("bias-analyzer", new Highlight(range));
  } else {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return true;
}

// Ask the analyzed page to scroll to and highlight one flagged sentence.
async function jumpToSentence(sentence) {
  try {
    if (analyzedTabId === null) throw new Error("Analyze a page first.");
    const [{ result: found }] = await chrome.scripting.executeScript({
      target: { tabId: analyzedTabId },
      func: jumpToSentenceInPage,
      args: [sentence],
    });
    if (found) {
      // Clear any earlier "couldn't find" error.
      setStatus();
    } else {
      setStatus("Couldn't find that sentence on the page.");
    }
  } catch (error) {
    setStatus(error.message || "Could not reach the page.");
  }
}

// Display the shared backend response format for either a test or real page.
function showAnalysis(result) {
  const overall = result.results.overallBias;
  const hasScore = overall.score !== null;

  analysis.dataset.level = hasScore ? overall.label : "";
  scoreLabel.textContent = hasScore ? overall.label : "N/A";
  articleTitle.textContent = result.article.title || "Untitled article";
  summary.textContent = result.summary;

  // Show the sentences the model is most confident are biased.
  const passages = result.results.flaggedPassages || [];
  flaggedList.replaceChildren(...passages.map((passage, index) => {
    const item = document.createElement("li");
    item.style.setProperty("--i", index);
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.title = "Jump to this sentence on the page";
    item.addEventListener("click", () => jumpToSentence(passage.text));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        jumpToSentence(passage.text);
      }
    });

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
  setStatus();
  let sentToBackend = false;

  try {
    // This capability becomes available only after Chrome reloads the updated manifest.
    if (!chrome.scripting?.executeScript) {
      throw new Error("Reload this extension in chrome://extensions, then try again.");
    }

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

    if (!tab?.id) {
      throw new Error("No active tab was found.");
    }
    analyzedTabId = tab.id;

    const [{ result: article }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractArticleFromPage,
    });

    if (!article.text) {
      throw new Error("No readable text was found on this page.");
    }

    showLoading(true, "analyze");
    sentToBackend = true;
    const response = await fetch(endpoint("/api/analyze"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}.`);
    }

    const result = await response.json();
    setBackendState("online");
    showLoading(false);
    showAnalysis(result);
  } catch (error) {
    setStatus(error.message || "Could not read the current page.");
    if (sentToBackend) checkBackend();
  } finally {
    showLoading(false);
    analyzeCurrentPageButton.disabled = false;
    analyzeCurrentPageButton.classList.remove("loading");
    analyzeLabel.textContent = "Analyze Current Page";
  }
}

analyzeCurrentPageButton.addEventListener("click", analyzeCurrentPage);
