// Endpoint paths are added by endpoint(). The extension uses the deployed API only.
// Firefox exposes the extension APIs as `browser`, Chrome as `chrome`. Both return promises.
const api = globalThis.browser ?? globalThis.chrome;
const IS_FIREFOX = api.runtime.getURL("").startsWith("moz-extension:");
// Opened as popup.html?pick=1 in a full tab, the page analyzes a file chosen from the computer.
const PICK_MODE = new URLSearchParams(location.search).has("pick");
// Opened as popup.html?sidebar=1, the page runs in Firefox's sidebar (see background.js).
const SIDEBAR_MODE = new URLSearchParams(location.search).has("sidebar");

const BACKEND_BASE_URL = "https://ai-bias-backend-bghjdsckdshzccg6.germanywestcentral-01.azurewebsites.net";

const backendButton = document.querySelector("#backend-status");
const backendLabel = document.querySelector("#backend-label");
const analyzeCurrentPageButton = document.querySelector("#analyze-current-page");
const status = document.querySelector("#status");
const statusText = document.querySelector("#status-text");
const statusAction = document.querySelector("#status-action");
const flaggedHint = document.querySelector("#flagged-hint");
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
// PDFs open in Chrome's built-in viewer, which extensions cannot scroll or highlight.
let canJump = true;

function endpoint(path) {
  return `${BACKEND_BASE_URL}${path}`;
}

// Errors are the only thing shown in the status line; progress and success are not.
// Call with no message to clear it.
// An optional action adds a small button to the message, such as "Open settings".
function setStatus(message = "", action = null) {
  statusText.textContent = message;
  status.hidden = !message;
  statusAction.hidden = !action;
  statusAction.onclick = null;
  if (action) {
    statusAction.textContent = action.label;
    statusAction.onclick = action.run;
  }
}

// An error that comes with a button to fix it.
class ActionError extends Error {
  constructor(message, action) {
    super(message);
    this.action = action;
  }
}

// ---------- Downloaded files (file:// URLs) ----------

const isLocalFile = (url) => /^file:/i.test(url || "");
const isPdfUrl = (url) => /\.pdf$/i.test((url || "").split(/[?#]/)[0]);
const fileNameFromUrl = (url) =>
  decodeURIComponent((url || "").split(/[?#]/)[0].split("/").pop() || "");

// Chrome only lets an extension read downloaded files after the user turns on
// "Allow access to file URLs" for it, which an extension cannot do for itself.
async function requireFileAccess() {
  // Firefox has no such setting (and always reports false), so this check is Chrome-only.
  if (IS_FIREFOX || !api.extension?.isAllowedFileSchemeAccess) return;
  const allowed = await api.extension.isAllowedFileSchemeAccess();
  if (!allowed) {
    throw new ActionError(
      "To read downloaded files, turn on \"Allow access to file URLs\" for this extension.",
      {
        label: "Open settings",
        run: () => api.tabs.create({ url: `chrome://extensions/?id=${api.runtime.id}` }),
      },
    );
  }
}

// Firefox never lets extensions read file:// URLs or look inside its PDF viewer, so the
// fallback is to choose the file from the computer. A popup closes when a file dialog opens,
// so the picker runs in a full tab.
const chooseFileAction = {
  label: "Choose file",
  run: async () => {
    await api.tabs.create({ url: api.runtime.getURL("popup.html?pick=1") });
    if (!SIDEBAR_MODE) window.close(); // the sidebar stays open

  },
};

// Read a file's bytes. fetch() cannot load file:// URLs, but XMLHttpRequest can.
function readBytes(url) {
  if (!isLocalFile(url)) {
    return fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Could not download the PDF (${response.status}).`);
      return response.arrayBuffer();
    });
  }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url);
    request.responseType = "arraybuffer";
    request.onload = () => (request.response ? resolve(request.response) : reject(new Error("The file was empty.")));
    request.onerror = () => reject(new Error("Could not open that file. It may have been moved or deleted."));
    request.send();
  });
}

// Pull the text out of a PDF. Lines are joined back into paragraphs, because the backend
// treats every line as its own text and would otherwise cut sentences at each line break.
async function extractArticleFromPdf(url) {
  return extractArticleFromPdfData(await readBytes(url), fileNameFromUrl(url));
}

async function extractArticleFromPdfData(data, fileName) {
  const pdfjs = await import("./lib/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = api.runtime.getURL("lib/pdf.worker.min.mjs");

  // Only text is needed, so skip pdf.js's eval-based font compiler (also blocked by the extension CSP).
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const paragraphs = [];
  let current = "";
  const pushParagraph = () => {
    const text = current.replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
    current = "";
  };
  const append = (text) => {
    // Rejoin words hyphenated across a line break: "govern-" + "ment" -> "government".
    if (/\p{L}-$/u.test(current) && /^\p{Ll}/u.test(text)) {
      current = current.slice(0, -1) + text;
    } else {
      current += (current && !/\s$/.test(current) ? " " : "") + text;
    }
  };

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const { items } = await page.getTextContent();
    let lastY = null;
    let lastHeight = 0;
    for (const item of items) {
      if (typeof item.str !== "string") continue;
      const y = item.transform[5];
      const height = item.height || lastHeight || 10;
      // A gap of more than about one and a half lines, or a change in font size
      // (a heading next to body text), starts a new paragraph.
      const sizeChanged = lastHeight && Math.abs(height - lastHeight) > lastHeight * 0.2;
      if (lastY !== null && (sizeChanged || Math.abs(lastY - y) > Math.max(height, lastHeight) * 1.6)) {
        pushParagraph();
      }
      if (item.str.trim()) {
        append(item.str);
        lastY = y;
        lastHeight = height;
      }
    }
    pushParagraph(); // page breaks end a paragraph
    page.cleanup();
  }

  let title = "";
  try {
    const { info } = await pdf.getMetadata();
    title = (info?.Title || "").trim();
  } catch {
    // Metadata is optional.
  }
  await pdf.destroy();

  // Same filter as for web pages: very short lines are usually headers, page numbers, or captions.
  const text = paragraphs.filter((p) => p.split(" ").length >= 6).join("\n");
  if (!text) {
    throw new Error("No text was found in this PDF. Scanned PDFs (images of pages) can't be read.");
  }
  return { title: title || fileName.replace(/\.pdf$/i, ""), text };
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
// It can also be given a parsed document, for a saved page chosen from the computer.
function extractArticleFromPage(doc) {
  const document = doc || window.document;
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
async function jumpToSentence(passage) {
  try {
    if (analyzedTabId === null) throw new Error("Analyze a page first.");
    // The cleaned sentence can differ slightly from the page (for example a removed stray quote),
    // so also try it without its final punctuation, then the original text.
    const candidates = [
      passage.text,
      passage.text.replace(/[.!?…"”\s]+$/, ""),
      passage.raw,
    ].filter((value, index, all) => value && all.indexOf(value) === index);

    let found = false;
    for (const candidate of candidates) {
      const [{ result }] = await api.scripting.executeScript({
        target: { tabId: analyzedTabId },
        func: jumpToSentenceInPage,
        args: [candidate],
      });
      if (result) {
        found = true;
        break;
      }
    }
    // Clear any earlier "couldn't find" error, or show a new one.
    setStatus(found ? "" : "Couldn't find that sentence on the page.");
  } catch (error) {
    setStatus(error.message || "Could not reach the page.");
  }
}

// Tidy a flagged sentence for display: drop stray bullets, dashes, dangling quotes or
// brackets, footnote markers like [1], and extra spaces at either end, but keep quotes and
// brackets that are properly paired inside the sentence (for example: “Quoted words,” he said.).
function cleanSentence(raw) {
  let s = String(raw).replace(/\s+/g, " ").trim();
  const isWordChar = (ch) => /[\p{L}\p{N}]/u.test(ch);
  const isCurrency = (ch) => /\p{Sc}/u.test(ch); // keep the $ in "$5 billion"
  const count = (ch) => s.split(ch).length - 1;

  // Footnote markers such as [1] or [12] that were collected from the page,
  // and list numbering such as "1. " or "2) " at the very start.
  s = s.replace(/(\s*\[\d+\])+$/, "").replace(/^(\[\d+\]\s*)+/, "");
  s = s.replace(/^\d{1,2}[.)]\s+(?=\p{L})/u, "");
  // Half-cut footnote markers left at the start, such as "10][32] " from "[10][32]".
  s = s.replace(/^\d+\](\s*\[\d+\])*\s*/, "");
  // A trailing ellipsis (" ...", "…") is not part of the sentence itself.
  s = s.replace(/\s*(\.{2,}|…)\s*$/, "");

  // Leading side: remove anything that is not a letter, a number, or an opening quote/bracket
  // that has a partner later in the sentence.
  const closers = { "“": "”", "‘": "’", "(": ")", "[": "]", "«": "»" };
  while (s.length > 0) {
    const first = s[0];
    if (isWordChar(first) || isCurrency(first)) break;
    const rest = s.slice(1);
    const paired =
      (closers[first] && rest.includes(closers[first])) ||
      ((first === '"' || first === "'") && rest.includes(first));
    if (paired) break;
    s = rest.trimStart();
  }

  // Trailing side: keep letters, numbers, sentence-ending punctuation, and closing
  // quotes/brackets that have a partner earlier in the sentence. Remove everything else.
  const openers = { "”": "“", "’": "‘", ")": "(", "]": "[", "»": "«" };
  while (s.length > 0) {
    const last = s[s.length - 1];
    if (isWordChar(last) || ".!?…%".includes(last)) break;
    const before = s.slice(0, -1);
    const paired =
      (openers[last] && before.includes(openers[last])) ||
      (last === "’" && isWordChar(before.slice(-1))) || // possessive, like "the dogs’"
      ((last === '"' || last === "'") && count(last) % 2 === 0);
    if (paired) break;
    s = before.trimEnd();
  }

  // A quote mark with no partner sitting just before the final punctuation, as in: like a conservative".
  const tail = s.match(/(["”])([.!?]+)$/);
  if (tail) {
    const quoteCount = tail[1] === '"' ? count('"') : 0;
    const unpaired = tail[1] === '"' ? quoteCount % 2 === 1 : !s.includes("“");
    if (unpaired) s = s.slice(0, s.length - tail[0].length) + tail[2];
  }

  return s;
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
  const passages = (result.results.flaggedPassages || [])
    .map((passage) => ({ ...passage, raw: passage.text, text: cleanSentence(passage.text) }))
    .filter((passage) => passage.text.length > 0);
  flaggedHint.hidden = !canJump;
  flaggedList.classList.toggle("static", !canJump);
  flaggedList.replaceChildren(...passages.map((passage, index) => {
    const item = document.createElement("li");
    item.style.setProperty("--i", index);
    if (canJump) {
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.title = "Jump to this sentence on the page";
      item.addEventListener("click", () => jumpToSentence(passage));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          jumpToSentence(passage);
        }
      });
    }

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

// Turn Chrome's technical errors into something a reader can act on.
function friendlyError(error) {
  const message = error?.message || "";
  if (/Cannot access contents of url "file:|file:\/\/ URL/i.test(message)) {
    return "To read downloaded files, turn on \"Allow access to file URLs\" for this extension.";
  }
  if (/Cannot access a chrome|chrome:\/\/|extensions gallery|Cannot access contents of the page/i.test(message)) {
    return "Chrome doesn't allow extensions to read this page. Try a regular article or file.";
  }
  if (/Missing host permission|about:|addons\.mozilla\.org/i.test(message)) {
    return "Firefox doesn't allow extensions to read this page. Try a regular article or file.";
  }
  return message || "Could not read the current page.";
}

// Start an analysis: lock the button, show the loading card, and clear old results.
function beginAnalysis() {
  analyzeCurrentPageButton.disabled = true;
  analyzeCurrentPageButton.classList.add("loading");
  analyzeLabel.textContent = "Analyzing…";
  analysis.hidden = true;
  showLoading(true, "read");
  setStatus();
}

function endAnalysis() {
  showLoading(false);
  analyzeCurrentPageButton.disabled = false;
  analyzeCurrentPageButton.classList.remove("loading");
  analyzeLabel.textContent = PICK_MODE ? "Choose a File to Analyze" : "Analyze Current Page";
}

// Send an extracted article to the backend and show the result.
async function sendArticle(article) {
  if (!article?.text) {
    throw new Error("No readable text was found on this page.");
  }
  showLoading(true, "analyze");
  let response;
  try {
    response = await fetch(endpoint("/api/analyze"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article }),
    });
  } catch {
    checkBackend();
    throw new Error("Could not reach the hosted backend.");
  }
  if (!response.ok) {
    checkBackend();
    throw new Error(`Server returned ${response.status}.`);
  }
  const result = await response.json();
  setBackendState("online");
  showLoading(false);
  showAnalysis(result);
}

// Read the article from the active tab.
async function readCurrentTab() {
  // The sidebar belongs to one window, so use that window's tab.
  const [tab] = await api.tabs.query(
    SIDEBAR_MODE ? { active: true, currentWindow: true } : { active: true, lastFocusedWindow: true },
  );
  if (!tab?.id) {
    throw new Error("No active tab was found.");
  }
  analyzedTabId = tab.id;
  const local = isLocalFile(tab.url);
  const pdf = isPdfUrl(tab.url);

  // Downloaded files open as file:// URLs, which need the user's permission first in Chrome.
  if (local) {
    await requireFileAccess();
  }

  try {
    if (pdf) {
      canJump = false;
      return await extractArticleFromPdf(tab.url);
    }
    canJump = true;
    const [{ result: article }] = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractArticleFromPage,
    });
    // Plain .txt files have no title, so fall back to the file name.
    if (local && article && (!article.title || article.title === tab.url)) {
      article.title = fileNameFromUrl(tab.url);
    }
    return article;
  } catch (error) {
    // When a downloaded file or a PDF can't be read in place, offer to choose it instead.
    if (local || (IS_FIREFOX && pdf)) {
      throw new ActionError(
        IS_FIREFOX
          ? "Firefox doesn't let extensions read this file directly. Choose it from your computer instead."
          : "Couldn't open that file in place. Choose it from your computer instead.",
        chooseFileAction,
      );
    }
    throw error;
  }
}

// Read a file chosen with the file picker.
async function readChosenFile(file) {
  canJump = false; // the file isn't open in a tab, so there is nothing to jump to
  const name = file.name || "";
  if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
    return extractArticleFromPdfData(await file.arrayBuffer(), name);
  }
  const text = await file.text();
  if (/\.html?$/i.test(name) || file.type === "text/html") {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const article = extractArticleFromPage(doc);
    if (!article.title) article.title = name.replace(/\.html?$/i, "");
    return article;
  }
  // Plain text: keep paragraphs on their own lines, but rejoin lines wrapped inside a paragraph.
  const paragraphs = text.replace(/\r/g, "").split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return { title: name.replace(/\.txt$/i, ""), text: paragraphs.join("\n") };
}

async function analyze(readArticle) {
  beginAnalysis();
  try {
    await sendArticle(await readArticle());
  } catch (error) {
    setStatus(friendlyError(error), error.action || null);
  } finally {
    endAnalysis();
  }
}

const fileInput = document.querySelector("#file-input");

if (PICK_MODE) {
  document.body.classList.add("tab-mode");
  document.title = "Analyze a File – AI Article Bias Analyzer";
  analyzeLabel.textContent = "Choose a File to Analyze";
  analyzeCurrentPageButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files;
    fileInput.value = ""; // allow choosing the same file again
    if (file) analyze(() => readChosenFile(file));
  });
} else if (SIDEBAR_MODE) {
  // A popup gets access to the current tab each time it is opened, but the sidebar stays open
  // across tabs and pages, so it needs permission to read websites. Firefox asks once; the
  // request must be made straight from the click, before anything else is awaited.
  document.body.classList.add("sidebar-mode");
  const requestSiteAccess = () => api.permissions.request({ origins: ["<all_urls>"] });
  const allowAction = {
    label: "Allow",
    run: () => {
      requestSiteAccess().then((granted) => granted && setStatus());
    },
  };
  analyzeCurrentPageButton.addEventListener("click", () => {
    const access = requestSiteAccess();
    analyze(async () => {
      if (!(await access)) {
        throw new ActionError("To analyze pages from the sidebar, allow the extension to read websites.", allowAction);
      }
      return readCurrentTab();
    });
  });
} else {
  analyzeCurrentPageButton.addEventListener("click", () => analyze(readCurrentTab));
}
