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
const preview = document.querySelector("#extraction-preview");
const previewCount = document.querySelector("#preview-count");
const previewText = document.querySelector("#preview-text");

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

// This function is injected into the active tab. Keep its helpers inside it.
function extractArticleFromPage() {
  if (typeof Readability !== "function") {
    throw new Error("Article extraction library is unavailable.");
  }

  const title = document.querySelector('meta[property="og:title"]')?.content
    || document.querySelector("h1")?.textContent?.trim()
    || document.title;
  const empty = { title, text: "" };
  const clone = document.cloneNode(true);
  if (!clone.body) return empty;

  const unwanted = [
    "nav", "footer", "aside", "form", "button", "iframe", "figure", "figcaption",
    "style", "noscript", "template", "[hidden]", "[aria-hidden='true']",
    "[role='navigation']", "[role='complementary']", "[role='advertisement']",
    "[role='dialog']", "[data-ad-slot]", "[data-ad-unit]", "[data-ad-client]",
    ".ad", ".ads", ".ad-container", ".ad-banner", ".advertisement", ".advertising",
    ".sponsored-content", ".related-articles", ".related-content",
    ".recommended-articles", ".newsletter-signup", ".subscription-prompt",
    ".social-share", ".comments", ".comment-section", ".sidebar", ".cookie-banner",
    ".read-more", ".recommended-content", ".promo-box", ".subscription-banner",
    "[data-ad]", "[role='banner']", "[role='contentinfo']", "script",
    ".byline", "[itemprop='author']", "[itemprop='datePublished']"
  ].join(",");

  // Strip known clutter and conservatively match common class/id tokens.
  // Avoid matching arbitrary substrings such as "ad" in "headline".
  const clutterToken = /(?:^|[\s_-])(?:advertisement|advertising|ads?|adslot|adunit|adbreak|adwrapper|advert|outbrain|taboola|related|recommended|recirculation|newsletter|comments?|sidebar|cookie-banner|social-share|sponsored-content|read-more|promo-box|subscription-banner)(?:$|[\s_-])/i;

  function clean(root) {
    root.querySelectorAll(unwanted).forEach(el => el.remove());
    root.querySelectorAll("[class], [id], [data-testid], [data-component]").forEach(el => {
      const identifiers = ["class", "id", "data-testid", "data-component"]
        .map(attr => el.getAttribute(attr) || "")
        .join(" ")
        .replace(/([a-z])([A-Z])/g, "$1-$2");
      if (clutterToken.test(identifiers)) el.remove();
    });
  }

  // Remove CSS-hidden nodes from the clone using the live document's styles.
  // Cloned nodes are detached, so computed styles must be read from the original.
  const liveNodes = document.body.querySelectorAll("*");
  const clonedNodes = clone.body.querySelectorAll("*");
  for (let i = 0; i < liveNodes.length; i++) {
    const el = liveNodes[i];
    const copy = clonedNodes[i];
    if (!copy || !copy.parentNode || !clone.body.contains(copy)) continue;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") copy.remove();
  }

  clean(clone);

  function paragraphText(root) {
    return Array.from(root.querySelectorAll("p"))
      .map(p => p.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }
  const substantial = root => paragraphText(root).join("\n").length >= 150;
  const outermost = nodes => nodes.filter(node =>
    !nodes.some(other => other !== node && other.contains(node))
  );

  // Prefer explicit article-body markup over a broader <article> container.
  const bodies = outermost(Array.from(clone.body.querySelectorAll("[itemprop='articleBody'], .article-body, .article__body, .story-body, .story__body"))
    .filter(substantial));
  const articles = outermost(Array.from(clone.body.querySelectorAll("article, [role='article']"))
    .filter(substantial));
  // Use publisher metadata as evidence for pages without semantic article markup.
  const articleTypes = /^(?:Article|NewsArticle|ReportageNewsArticle|AnalysisNewsArticle|OpinionNewsArticle|BlogPosting|Report|ReviewNewsArticle|LiveBlogPosting)$/i;
  function hasArticleType(value) {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(hasArticleType);
    const types = [value["@type"]].flat();
    if (types.some(type => typeof type === "string" && articleTypes.test(type.split("/").pop()))) return true;
    return hasArticleType(value["@graph"]) || hasArticleType(value.mainEntity);
  }
  const articleMetadata = /^article$/i.test(
    document.querySelector('meta[property="og:type"]')?.content || ""
  ) || Boolean(document.querySelector('meta[property="article:published_time"]'))
    || Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some(script => {
      try { return hasArticleType(JSON.parse(script.textContent)); }
      catch { return false; }
    });

  let scope = null;
  if (bodies.length === 1) scope = bodies[0];
  else if (bodies.length > 1) return empty;
  else if (articles.length === 1) scope = articles[0];
  else if (articles.length > 1) {
    // Multiple stories are ambiguous. Only choose a dominant one on article pages.
    const ranked = articles.map(node => ({ node, size: paragraphText(node).join("\n").length }))
      .sort((a, b) => b.size - a.size);
    if (!articleMetadata || ranked[0].size < ranked[1].size * 2) return empty;
    scope = ranked[0].node;
  }

  // Reject ordinary homepages and pages with no evidence of a primary article.
  if (!articleMetadata && /^\/*$/.test(location.pathname) && !bodies.length) return empty;
  if (!scope && !articleMetadata) return empty;

  // Scope Readability to the identified article when possible. The original DOM
  // remains untouched. Otherwise let Readability locate the main content.
  if (scope) {
    scope.querySelectorAll("article, [role='article']").forEach(node => node.remove());
    clone.body.replaceChildren(scope);
  }

  const article = new Readability(clone, {
    charThreshold: 150,
    keepClasses: true,
    serializer: element => element
  }).parse();

  if (!article?.content) return empty;
  clean(article.content);

  // Ignore link-heavy teasers, but keep article paragraphs with ordinary citations.
  const paragraphs = Array.from(article.content.querySelectorAll("p"))
    .filter(p => {
      const text = p.textContent.replace(/\s+/g, " ").trim();
      if (!text) return false;
      const linkLength = Array.from(p.querySelectorAll("a"))
        .reduce((sum, a) => sum + a.textContent.trim().length, 0);
      if (linkLength / text.length > 0.6) return false;
      return !/^(?:advertisement|sponsored content|read more|related articles|recommended for you)(?:\s*[:–—-]|[.!]?\s*$)/i.test(text)
        && !/^(?:sign up for (?:our|the) newsletter|subscribe (?:now|today)|read more stories (?:like this|from)|continue reading (?:below|after the ad))\b/i.test(text);
    })
    .map(p => p.textContent.replace(/\s+/g, " ").trim());

  // Preserve paragraph boundaries. Never fall back to document.body.innerText.
  const text = paragraphs.join("\n");
  if (text.length < 150) return empty;

  return { title: article.title || title, text };
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
  preview.hidden = true;
  preview.open = false;
  previewText.textContent = "";
  showLoading(true, "read");
  setStatus("Identifying article…", "loading");

  try {
    // This capability becomes available only after Chrome reloads the updated manifest.
    if (!chrome.scripting?.executeScript) {
      throw new Error("Reload this extension in chrome://extensions, then try again.");
    }

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

    if (!tab?.id) {
      throw new Error("No active tab was found.");
    }

    // Both scripts run in the extension's isolated world in the main frame.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["Readability.js"],
        world: "ISOLATED"
      });
    } catch (error) {
      if (/readability|could not load file/i.test(error.message || "")) {
        throw new Error("Readability.js is missing. Install it in the extension folder and reload.");
      }
      throw error;
    }

    const [{ result: article } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractArticleFromPage,
      world: "ISOLATED"
    });

    if (!article?.text) {
      throw new Error("Could not reliably identify an article on this page.");
    }

    // The preview contains the exact body sent to the server, never live page HTML.
    previewCount.textContent = article.text.length.toLocaleString();
    previewText.textContent = article.text;
    preview.hidden = false;

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
    setStatus("Article analyzed.", "success");
  } catch (error) {
    setStatus(error.message || "Could not read the current page.", "error");
  } finally {
    showLoading(false);
    analyzeCurrentPageButton.disabled = false;
    analyzeCurrentPageButton.classList.remove("loading");
    analyzeLabel.textContent = "Analyze Article";
  }
}

analyzeCurrentPageButton.addEventListener("click", analyzeCurrentPage);
