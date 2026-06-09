const http = require("http");
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // API proxy endpoint
  if (req.method === "POST" && req.url === "/api/match") {
    if (!API_KEY) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not set on server." }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { profile } = JSON.parse(body);

        const isBank = profile.type === 'bank';

        const prompt = isBank
          ? `You are an expert at matching banking professionals to industry awards and recognition programs.

Given this bank member profile, identify 5–6 specific, real awards they should apply for. Focus on banking leadership, community banking, financial services, credit union, and related professional recognition programs. Infer achievement themes automatically from their accomplishments — do not ask for themes.

For each award include:
- Award name
- Sponsoring organization
- Match strength: High or Medium
- Why they're a strong fit (2–3 sentences, specific to their profile)
- Recommended nomination angle (1–2 sentences on how to frame the story)
- Typical deadline season (e.g. Q1, Q3, or "rolling")
- The direct nomination or registration URL

Member profile:
- Name: ${profile.name}
- Title: ${profile.title}
- Bank: ${profile.company}
- State: ${profile.state}
- Key achievements: ${profile.achievements}`
          : `You are an expert at matching fintech companies and their leaders to startup, innovation, and technology awards.

Given this fintech company profile, identify 5–6 specific, real awards they should apply for. Focus on startup awards, fintech innovation, technology leadership, entrepreneurship, and financial technology recognition programs. Infer achievement themes automatically from their accomplishments — do not ask for themes.

For each award include:
- Award name
- Sponsoring organization
- Match strength: High or Medium
- Why they're a strong fit (2–3 sentences, specific to their profile)
- Recommended nomination angle (1–2 sentences on how to frame the story)
- Typical deadline season (e.g. Q1, Q3, or "rolling")
- The direct nomination or registration URL

Company profile:
- Founder / Executive: ${profile.name}
- Title: ${profile.title}
- Company: ${profile.company}
- State: ${profile.state}
- Key achievements: ${profile.achievements}`;

        const sharedInstructions = `

Return ONLY a valid JSON array. No preamble, no markdown fences. Each object must have exactly these keys:
award_name, org, match, fit_reason, nomination_angle, deadline_season, website_url, nomination_url

website_url: the award's official information page URL. Never return null — if uncertain of the exact award page, use the sponsoring organization's main website. If that is also uncertain, return a Google search URL in the format https://www.google.com/search?q=Award+Name+nomination.
nomination_url: the direct nomination/registration submission page URL, or null if uncertain.`;

        const fullPrompt = prompt + sharedInstructions;

        const https = require("https");
        const payload = JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          messages: [{ role: "user", content: fullPrompt }],
        });

        const options = {
          hostname: "api.anthropic.com",
          path: "/v1/messages",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Length": Buffer.byteLength(payload),
          },
        };

        const apiReq = https.request(options, (apiRes) => {
          let data = "";
          apiRes.on("data", (chunk) => (data += chunk));
          apiRes.on("end", () => {
            res.writeHead(apiRes.statusCode, { "Content-Type": "application/json" });
            res.end(data);
          });
        });

        apiReq.on("error", (e) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        });

        apiReq.write(payload);
        apiReq.end();
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request body." }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(__dirname, "public", filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Awards Matcher running at http://localhost:${PORT}`);
  if (!API_KEY) console.warn("WARNING: ANTHROPIC_API_KEY is not set.");
});
