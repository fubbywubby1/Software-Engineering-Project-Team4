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

The backend now runs a real bias model. It splits the article into sentences,
asks a fine-tuned DistilRoBERTa model whether each sentence uses biased
language, and reports the share of flagged sentences as a 0 to 100 score
(under 15 Low, 15 to 35 Moderate, over 35 High) plus the three most biased
sentences.

The model was trained on the BABE dataset (about 3,700 expert-labeled news
sentences). On held-out test sentences the int8 ONNX model the server runs
scores 79.8% accuracy and 0.79 F1, compared with 75.8% for a TF-IDF baseline.
It reflects what BABE's annotators judged biased in mostly US political news,
so results on other topics are less reliable.

## What each part does

| Part | Responsibility |
| --- | --- |
| `extension/` | Chrome Manifest V3 extension with a popup UI. |
| `extension/popup.js` | Checks the backend, extracts active-page text, sends requests, and displays results. |
| `backend/server.js` | Local HTTP API that validates article text and returns a JSON response. |
| `backend/modelClient.js` | Builds the shared response format from the model's results. |
| `backend/inference.js` | Loads the model, splits sentences, classifies them, and computes the score. |
| `backend/models/` | The trained model files. Not in Git; see "Set up the model". |
| `package.json` | Defines the command that starts the backend. |

## Requirements

- Google Chrome
- Node.js 18 or newer, including npm

Verify Node.js and npm after installation:

```powershell
node --version
npm --version
```

Install the backend's one dependency, `@huggingface/transformers`, which runs
the model:

```powershell
npm install
```

## Quick start

### 0. Set up the model

The model files (about 80 MB) are not stored in Git. Get `bias-model.zip`
from the team's shared drive, or train it yourself with the Colab notebook,
then unzip it so the files land here:

```text
backend/models/bias-model/
|-- config.json
|-- tokenizer.json
|-- tokenizer_config.json
`-- onnx/
    `-- model_quantized.onnx
```

To work on the extension without the model, start the backend with
`$env:MOCK_MODEL = "1"` set first. It then returns a fixed sample result.

### 1. Start the backend

Open PowerShell in the project root:

```powershell
Set-Location 'C:\Users\Ckrog\git\Software-Engineering-Project-Team4-1'
npm start
```

Keep this terminal open. A successful start prints:

```text
Backend listening on http://localhost:3000
Bias model loaded.
```

If it prints `Could not load the bias model`, check step 0.

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
4. Confirm the popup shows the bias score, the extracted title, the character
   count, and the most biased sentences.

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

`article.text` is required and must contain non-empty text. A response looks
like this:

```json
{
  "schemaVersion": "1.0",
  "analysisId": "3f1c...",
  "status": "completed",
  "model": { "name": "distilroberta-babe", "version": "1.0.0" },
  "article": { "title": "Example story", "characterCount": 2450 },
  "results": {
    "overallBias": { "score": 40, "label": "High", "confidence": null },
    "politicalLean": null,
    "biasTypes": [],
    "sentenceCount": 20,
    "flaggedCount": 8,
    "flaggedPassages": [
      {
        "text": "Critics called the plan a reckless giveaway.",
        "startOffset": 128,
        "endOffset": 172,
        "biasScore": 91
      }
    ]
  },
  "summary": "8 of 20 sentences use language the model flags as biased. Results are estimates, not proof of intent."
}
```

`politicalLean` and `biasTypes` stay empty for now because the current model
only detects biased wording. If the model cannot be loaded the route returns
`503` with an error instead of a made-up result.

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
|   |-- server.js          Local HTTP backend
|   |-- modelClient.js     Builds the API response
|   |-- inference.js       Runs the bias model
|   |-- inference.test.js  Unit tests (npm test)
|   `-- models/            Trained model files (not in Git)
|-- extension/
|   |-- manifest.json      Chrome extension configuration
|   |-- popup.html         Popup structure
|   |-- popup.css          Popup styling
|   `-- popup.js           Popup behavior and page extraction
|-- package.json           npm start and npm test commands
`-- README.md
```

## Tests

```powershell
npm test
```

The scoring and sentence-splitting tests always run. The test that runs the
real model is skipped unless `backend/models/bias-model` is present.

## Next steps

1. Improve extraction quality for pages that do not use standard article HTML.
2. Add article metadata such as publication, author, URL, and date.
3. Package the model into a Docker image and deploy the backend to Azure.
4. Add clear loading, error, and analysis-result visuals.
5. Deploy the backend over HTTPS before distributing the extension to users.

For users, the final product should require only the published Chrome
extension. Node.js and the local backend are development tools, not something
end users should install or run.
