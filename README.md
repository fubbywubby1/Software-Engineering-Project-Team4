# AI Article Bias Analyzer

A Chrome extension prototype that reads the current article page, sends its
title and text to a backend, and displays the backend response. The backend can
run locally or as the project's Docker container in Azure App Service.

The long-term goal is an explainable AI tool that helps readers notice framing,
loaded language, emotional language, and viewpoint balance. It should describe
evidence from an article, not claim to prove an author's intent or label a
publication as objectively biased.

## Current status

The extension's hosted end-to-end flow is working:

```text
Open article in Chrome
  -> Extension extracts title and page text
  -> Azure App Service backend receives the article
  -> Extension displays the backend result
```

The backend has also been packaged as a Docker image, pushed to Docker Hub, and
deployed to Azure App Service. Its hosted health endpoint is available at:

```text
https://ai-bias-backend-bghjdsckdshzccg6.germanywestcentral-01.azurewebsites.net/health
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
| `backend/models/` | The trained ONNX model files used by the backend. |
| `backend/Dockerfile` | Packages the backend and model into the deployable Docker image. |
| `package.json` | Defines the command that starts the backend. |

## Requirements

- Google Chrome
- Node.js 18 or newer, including npm
- Docker Desktop with the Linux/WSL 2 engine, only for building or running the container

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

### 0. Verify the model

The model files are included on the `model-inference` branch. Verify that this
folder exists after cloning the repository:

```text
backend/models/bias-model/
|-- config.json
|-- tokenizer.json
|-- tokenizer_config.json
`-- onnx/
    `-- model_quantized.onnx
```

If the folder is missing, obtain the team's `bias-model.zip` or regenerate the
model with the team Colab notebook before running real inference.

To work on the extension without model inference, set `MOCK_MODEL=1` before
starting the server. It then returns a fixed sample result.

### 1. Start the backend locally (development only)

Use the local server for backend development, API testing, or building the
Docker image. The Chrome extension itself uses the hosted Azure backend.

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

### 2. Run the backend in Docker (development only)

Build from the repository root:

```bash
docker build -f backend/Dockerfile -t ai-bias-backend:local .
```

Run the image locally:

```bash
docker run --rm -p 3000:3000 ai-bias-backend:local
```

The same health check should return `ok`:

```bash
curl http://localhost:3000/health
```

### 3. Load the extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Select this repository's `extension` folder.
5. Pin the extension if you want its icon visible in the toolbar.

Whenever files inside `extension/` change, return to `chrome://extensions` and
click the extension card's reload icon before testing again.

### 4. Test the hosted backend connection

The extension uses the deployed Azure App Service backend only:

```text
https://ai-bias-backend-bghjdsckdshzccg6.germanywestcentral-01.azurewebsites.net
```

1. Click the extension icon.
2. Select **Check Backend**.
3. Confirm the popup says **Backend connected.**

### 5. Test article extraction

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
| **Check Backend** | The hosted Azure backend's `GET /health` route can be reached. |
| **Analyze Current Page** | Article extraction and the backend request work together. |

The popup intentionally has no test-article action. Use the PowerShell request
in the [Backend API](#backend-api) section when you need to test the API without
opening a browser article.

## Azure deployment

The hosted backend runs as the same Docker image used for local container
testing:

```text
backend/Dockerfile
  -> Docker image
  -> Docker Hub: shrink1849/ai-bias-backend:v0.1
  -> Azure App Service Linux container
```

The Azure Web App routes traffic to port `3000` in the container. Its Docker
Hub image is public for this prototype; never place API keys, credentials, or
other secrets in the image.

To publish a later backend change:

1. Build and test the image locally.
2. Tag it with a new version, for example `v0.2`.
3. Push that tag to Docker Hub.
4. Change the Azure Web App's image tag to the new version and restart the Web
   App.
5. Test `/health`, then use the extension to confirm the deployed backend works.

You can pause the deployed service from the Web App's **Overview** page with
**Stop**, and resume it with **Start**. This keeps the deployment configuration
but makes the public endpoint unavailable while stopped.

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
|   |-- Dockerfile         Container build instructions
|   |-- server.js          Local HTTP backend
|   |-- modelClient.js     Builds the API response
|   |-- inference.js       Runs the bias model
|   |-- inference.test.js  Unit tests (npm test)
|   `-- models/            Trained model files
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
3. Test the hosted Azure backend through the extension on multiple articles.
4. Add request-rate limiting and restrict CORS before sharing the public API.
5. Add clearer loading, error, and analysis-result visuals.

For users, the final product should require only the published Chrome
extension. Node.js and the local backend are development tools, not something
end users should install or run.
