# AI Article Bias Analyzer

A local-first Chrome extension prototype that reads the current article page,
sends its title and text to a small backend, and displays the backend response.

The long-term goal is an explainable AI tool that helps readers notice framing,
loaded language, emotional language, and viewpoint balance. It should describe
evidence from an article, not claim to prove an author's intent or label a
publication as objectively biased.

## Current status

The first end-to-end local flow is working:

```text
Open article in Chrome
  -> Extension extracts title and page text
  -> Local backend receives the article
  -> Extension displays the backend result
```

The backend currently returns a fixed placeholder analysis. It does not yet
call an AI model, store data, or perform real bias analysis.

## What each part does

| Part | Responsibility |
| --- | --- |
| `extension/` | Chrome Manifest V3 extension with a popup UI. |
| `extension/popup.js` | Checks the backend, extracts active-page text, sends requests, and displays results. |
| `backend/server.js` | Local HTTP API that validates article text and returns a JSON response. |
| `package.json` | Defines the command that starts the backend. |

## Requirements

- Google Chrome
- Node.js 18 or newer, including npm

Verify Node.js and npm after installation:

```powershell
node --version
npm --version
```

No `npm install` is required yet. The backend uses only Node.js built-in
modules, so there are no external dependencies.

## Quick start

### 1. Start the backend

Open PowerShell in the project root:

```powershell
Set-Location 'C:\Users\Ckrog\git\Software-Engineering-Project-Team4-1'
npm start
```

Keep this terminal open. A successful start prints:

```text
Backend listening on http://localhost:3000
```

In a second terminal, confirm the server is available:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected result:

```text
status
------
ok
```

### 2. Load the local extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Select this repository's `extension` folder.
5. Pin the extension if you want its icon visible in the toolbar.

Whenever files inside `extension/` change, return to `chrome://extensions` and
click the extension card's reload icon before testing again.

### 3. Test the connection

1. Click the extension icon.
2. Select **Check Backend**.
3. Confirm the popup says **Backend connected.**

### 4. Test article extraction

1. Open a regular public news article in a browser tab.
2. Open the extension popup.
3. Select **Analyze Current Page**.
4. Confirm the popup shows the extracted title, character count, and the
   placeholder result.

The extension first uses an `article` element, then `main`, then the page body.
Before extracting text, it removes common non-article elements such as headers,
navigation, footers, sidebars, forms, and scripts. This is intentionally a
simple starting point and will not be perfect on every publication.

Chrome blocks script injection on protected pages, including `chrome://` pages,
the Chrome Web Store, and new-tab pages. Test with a normal website instead.

## Extension actions

| Popup button | What it verifies |
| --- | --- |
| **Check Backend** | The local `GET /health` route can be reached. |
| **Analyze Test Article** | The extension can send a fixed sample article to the backend. |
| **Analyze Current Page** | Article extraction and the backend request work together. |

## Backend API

### `GET /health`

Returns a small status response that confirms the server is running.

```json
{
  "status": "ok"
}
```

### `POST /api/analyze`

Accepts an article title and text:

```json
{
  "article": {
    "title": "Optional article title",
    "text": "Article text to analyze"
  }
}
```

`article.text` is required and must contain non-empty text. The current
placeholder response is:

```json
{
  "overallFraming": "not_analyzed",
  "summary": "AI analysis has not been connected yet.",
  "article": {
    "title": "Example story",
    "characterCount": 68
  }
}
```

You can test the route without Chrome:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/analyze `
  -ContentType 'application/json' `
  -Body '{"article":{"title":"Test article","text":"This is a short test article."}}'
```

## Project structure

```text
.
|-- backend/
|   `-- server.js          Local HTTP backend
|-- extension/
|   |-- manifest.json      Chrome extension configuration
|   |-- popup.html         Popup structure
|   |-- popup.css          Popup styling
|   `-- popup.js           Popup behavior and page extraction
|-- package.json           npm start command
`-- README.md
```

## Next steps

1. Improve extraction quality for pages that do not use standard article HTML.
2. Add article metadata such as publication, author, URL, and date.
3. Replace the fixed backend response with structured AI analysis.
4. Add clear loading, error, and analysis-result visuals.
5. Deploy the backend over HTTPS before distributing the extension to users.

For users, the final product should require only the published Chrome
extension. Node.js and the local backend are development tools, not something
end users should install or run.
