const http = require("node:http");

const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 1_000_000;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

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

const server = http.createServer(async (request, response) => {
  const method = request.method;
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (method === "POST" && url.pathname === "/api/analyze") {
    try {
      const payload = await readJson(request);
      const article = payload?.article;
      const text = article?.text;

      if (typeof text !== "string" || text.trim().length === 0) {
        sendJson(response, 400, {
          error: "article.text is required and must be a non-empty string.",
        });
        return;
      }

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

  sendJson(response, 404, { error: "Route not found." });
});

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
