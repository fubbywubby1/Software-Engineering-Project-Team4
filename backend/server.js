// Node's built-in HTTP module keeps this first backend dependency-free.
const http = require("node:http");

// Use PORT from the environment when deployed; otherwise run locally on port 3000.
const PORT = Number(process.env.PORT) || 3000;
// Reject unusually large requests before they consume too much memory.
const MAX_BODY_BYTES = 1_000_000;

// Send every API response as JSON and allow the local extension to call this server.
function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

// Read the request stream and turn its JSON body into a JavaScript object.
function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    // HTTP request bodies arrive in chunks, so collect them before parsing.
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    // Parse the completed body and return a useful error if it is not JSON.
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

// Route incoming browser and extension requests.
const server = http.createServer(async (request, response) => {
  const method = request.method;
  const url = new URL(request.url, `http://${request.headers.host}`);

  // Answer browser CORS preflight requests before handling API routes.
  if (method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    response.end();
    return;
  }

  // A simple endpoint for confirming that the backend is running.
  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  // Accept an article and return a temporary response until AI is connected.
  if (method === "POST" && url.pathname === "/api/analyze") {
    try {
      const payload = await readJson(request);
      const article = payload?.article;
      const text = article?.text;

      // Article text is the only required input for this first version.
      if (typeof text !== "string" || text.trim().length === 0) {
        sendJson(response, 400, {
          error: "article.text is required and must be a non-empty string.",
        });
        return;
      }

      // This predictable placeholder lets the extension be built without AI setup.
      sendJson(response, 200, {
        overallFraming: "not_analyzed",
        summary: "AI analysis has not been connected yet.",
        article: {
          title: typeof article.title === "string" ? article.title.trim() : null,
          characterCount: text.trim().length,
        },
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  // Any unrecognized method or path receives a clear JSON error.
  sendJson(response, 404, { error: "Route not found." });
});

// Begin accepting requests and show the local URL in the terminal.
server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
