const http = require("http");
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;
const PROFILES_PATH = path.join(__dirname, "profiles.json");

function readProfiles() {
  try { return JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8")); }
  catch { return []; }
}

function writeProfiles(profiles) {
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(profiles, null, 2));
}

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/profiles
  if (req.method === "GET" && req.url === "/api/profiles") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readProfiles()));
    return;
  }

  // POST /api/profiles
  if (req.method === "POST" && req.url === "/api/profiles") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const profile = JSON.parse(body);
        const profiles = readProfiles();
        const saved = { ...profile, id: Date.now().toString(), savedAt: new Date().toISOString() };
        profiles.push(saved);
        writeProfiles(profiles);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(saved));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request body." }));
      }
    });
    return;
  }

  // DELETE /api/profiles/:id
  const deleteMatch = req.url.match(/^\/api\/profiles\/([^/]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    const id = deleteMatch[1];
    writeProfiles(readProfiles().filter((p) => p.id !== id));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
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
          ? `You are an expert at matching banking professionals to prestigious industry awards and recognition programs.

Given this bank member profile, return only awards where there is a genuine, strong fit based on the member's profile and achievements. Focus on nationally recognized, prestigious awards in banking leadership, community banking, and financial services. Quality over quantity — 3 great matches is better than 8 mediocre ones. Never pad results with weak matches just to fill a list. Only include an award if you are confident it is real, currently active, and the member has a credible shot at winning or being nominated. Infer achievement themes automatically from their accomplishments.

For each award include:
- Award name
- Sponsoring organization
- Match strength: High or Medium
- Why they're a strong fit (2–3 sentences, specific to their profile)
- Recommended nomination angle (1–2 sentences on how to frame the story)
- Typical deadline season (e.g. Q1, Q3, or "rolling")
- Specific deadline date in MM/DD/YYYY format (e.g. 03/15/2027), or "Rolling" if there is no fixed annual deadline
- The direct nomination or registration URL

Member profile:
- Name: ${profile.name}
- Title: ${profile.title}
- Bank: ${profile.company}
${profile.state ? `- Location: ${profile.state}\n` : ''}- Key achievements: ${profile.achievements}

If location is provided, include relevant local and regional awards alongside national ones. If no location is provided, focus entirely on national and industry-wide awards.`
          : `You are an expert at matching fintech companies and their leaders to prestigious startup, innovation, and technology awards.

Given this fintech company profile, return only awards where there is a genuine, strong fit based on the company's profile and achievements. Focus on nationally recognized, prestigious awards in fintech innovation, startup excellence, and technology leadership. Quality over quantity — 3 great matches is better than 8 mediocre ones. Never pad results with weak matches just to fill a list. Only include an award if you are confident it is real, currently active, and the company has a credible shot at winning or being nominated. Infer achievement themes automatically from their accomplishments.

For each award include:
- Award name
- Sponsoring organization
- Match strength: High or Medium
- Why they're a strong fit (2–3 sentences, specific to their profile)
- Recommended nomination angle (1–2 sentences on how to frame the story)
- Typical deadline season (e.g. Q1, Q3, or "rolling")
- Specific deadline date in MM/DD/YYYY format (e.g. 03/15/2027), or "Rolling" if there is no fixed annual deadline
- The direct nomination or registration URL

Company profile:
- Founder / Executive: ${profile.name}
- Title: ${profile.title}
- Company: ${profile.company}${profile.state ? `\n- Location: ${profile.state}` : ''}
- Key achievements: ${profile.achievements}

If location is provided, include relevant local and regional awards alongside national ones. If no location is provided, focus entirely on national and industry-wide awards.`;

        const sharedInstructions = `

For each award you identify, use web search to:
1. Find the specific current nomination or submission URL — the exact "nominate", "apply", or "submit" page, not the award homepage. Search for "[award name] nominations [current year]" or "[award name] apply now".
2. Find the confirmed deadline date for the current or next nomination cycle. Search for "[award name] deadline [current year]".

Only include an award in your response if you can find a confirmed, active nomination page. Do not include awards where nominations appear closed, the award has been discontinued, or you cannot find an active submission page.

Return ONLY a valid JSON array. No preamble, no markdown fences. Each object must have exactly these keys:
award_name, org, match, fit_reason, nomination_angle, deadline_season, deadline_date, website_url, nomination_url

deadline_date: the confirmed deadline date found via web search in MM/DD/YYYY format, or "Rolling" if truly rolling, or "Check website" if you could not find a confirmed date.
website_url: the award's official information page URL found via web search. Never return null.
nomination_url: the direct nomination/submission page URL found via web search — the specific page where someone submits, not the homepage. Return null only if you searched and could not find a direct submission page.`;

        const fullPrompt = prompt + sharedInstructions;

        const https = require("https");
        const payload = JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 5000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
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
