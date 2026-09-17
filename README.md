# AI Article Bias Analyzer

This project will begin with one small, working backend. The browser extension
and AI integration come later.

## The bigger picture

The finished product will help a reader understand how a news article is
framed. They will open an article, click an extension button, and receive a
plain-language explanation of patterns such as emotionally charged wording,
loaded language, and whether different viewpoints appear represented.

There are three parts that work together:

```text
News article → Chrome extension → Backend → Analysis result → Extension display
```

- The **Chrome extension** will read the article currently open in the browser
  and show the result to the user.
- The **backend** receives that article text, protects any future AI API key,
  and sends a consistent response back to the extension.
- The **AI analysis** will be added later. It will replace the current example
  response with findings and short explanations grounded in the article text.

Starting with the backend lets us prove that the middle of this flow works
before adding the browser interface or AI service. Each later step changes only
one piece of the flow, which keeps the project easy to understand and debug.

## What works first

The backend provides two routes:

- `GET /health` confirms the server is running.
- `POST /api/analyze` accepts article text and returns a fixed example analysis.

The example response lets us build and test the frontend flow without an AI
account, API key, database, or external dependency.

## Requirements

Install [Node.js](https://nodejs.org/) 18 or newer. No `npm install` is needed
for this first backend because it uses Node's built-in HTTP module.

## Run the backend

From the project root:

```powershell
npm start
```

The server starts at `http://localhost:3000`.

Check it in a browser or PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Send a test article:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/analyze `
  -ContentType 'application/json' `
  -Body '{"article":{"title":"Example story","text":"This is a short example article with enough text to test the request."}}'
```

## Request format

```json
{
  "article": {
    "title": "Optional article title",
    "text": "Article text to analyze"
  }
}
```

`article.text` is required and must be a non-empty string. The current server
does not analyze the content. It returns a schema-stable placeholder result.

## Response format

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

## Next small steps

1. Add a Chrome popup with one button.
2. Send a hard-coded test article to this backend.
3. Extract text from the active page.
4. Replace the placeholder response with an AI call.

Keeping each step independently working makes bugs much easier to find.
