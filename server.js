const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;
const PROFILES_PATH = path.join(__dirname, "profiles.json");

// Microsoft Graph — member search
const MS_TENANT_ID = process.env.MICROSOFT_TENANT_ID;
const MS_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const SP_DRIVE_ID = "b!eXXUArkJbE6IRqy6Sj0P3JoM1wQqV-xJg-jhyrNpqusQJgvWP_m7RoUnAZPr3h3N";
const SP_ITEM_ID  = "01GEYK6V6RWAX7TGUHFRCIDTDG5FLAOWKE";

let msTokenCache   = { token: null, expires: 0 };
let membersCache   = { data: null, expires: 0 };

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
};

function readProfiles() {
  try { return JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8")); }
  catch { return []; }
}

function writeProfiles(profiles) {
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(profiles, null, 2));
}

// Generic HTTPS helper — returns parsed JSON
function callHTTPS(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (r) => {
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Non-JSON response (${r.statusCode}): ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getMicrosoftToken() {
  if (msTokenCache.token && Date.now() < msTokenCache.expires) return msTokenCache.token;
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET)
    throw new Error("Microsoft credentials not configured (MICROSOFT_TENANT_ID / CLIENT_ID / CLIENT_SECRET).");

  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(MS_CLIENT_ID)}&client_secret=${encodeURIComponent(MS_CLIENT_SECRET)}&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default`;
  const data = await callHTTPS(
    {
      hostname: "login.microsoftonline.com",
      path: `/${MS_TENANT_ID}/oauth2/v2.0/token`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
    },
    body
  );
  if (!data.access_token) throw new Error(data.error_description || "Failed to get Microsoft token.");
  msTokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return msTokenCache.token;
}

async function getAllMembers() {
  if (membersCache.data && Date.now() < membersCache.expires) return membersCache.data;

  const token = await getMicrosoftToken();
  const auth = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  // Get worksheets and take the first one
  const sheets = await callHTTPS({ hostname: "graph.microsoft.com", path: `/v1.0/drives/${SP_DRIVE_ID}/items/${SP_ITEM_ID}/workbook/worksheets`, headers: auth });
  if (!sheets.value?.length) throw new Error("No worksheets found in workbook.");
  const sheetId = encodeURIComponent(sheets.value[0].id);

  // Read used range (all data)
  const range = await callHTTPS({ hostname: "graph.microsoft.com", path: `/v1.0/drives/${SP_DRIVE_ID}/items/${SP_ITEM_ID}/workbook/worksheets/${sheetId}/usedRange`, headers: auth });
  const rows = range.values;
  if (!rows?.length) return [];

  // Map headers
  const hdrs = rows[0].map((h) => String(h || "").toLowerCase().trim());
  const col = {
    email:     hdrs.indexOf("contact email"),
    firstName: hdrs.indexOf("first name"),
    lastName:  hdrs.indexOf("last name"),
    title:     hdrs.indexOf("title"),
    account:   hdrs.indexOf("account name"),
  };

  const members = rows.slice(1)
    .filter((r) => r[col.firstName] || r[col.lastName] || r[col.account])
    .map((r) => ({
      email:     col.email     >= 0 ? String(r[col.email]     || "") : "",
      firstName: col.firstName >= 0 ? String(r[col.firstName] || "") : "",
      lastName:  col.lastName  >= 0 ? String(r[col.lastName]  || "") : "",
      title:     col.title     >= 0 ? String(r[col.title]     || "") : "",
      account:   col.account   >= 0 ? String(r[col.account]   || "") : "",
    }));

  membersCache = { data: members, expires: Date.now() + 5 * 60 * 1000 };
  return members;
}

async function searchMembers(q) {
  const lower = q.toLowerCase();
  const all = await getAllMembers();
  return all
    .filter((m) => {
      const name = `${m.firstName} ${m.lastName}`.toLowerCase();
      return name.includes(lower) || m.account.toLowerCase().includes(lower);
    })
    .slice(0, 8);
}

// Generic Claude API caller — returns parsed response object
function callClaudeAPI(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (r) => {
        let data = "";
        r.on("data", (c) => (data += c));
        r.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error("Invalid API response")); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Award-matching prompt builder — used by /api/scan (no web search)
function buildAwardPrompt(profile) {
  const isBank = profile.type !== "fintech";
  return isBank
    ? `You are an expert at matching banking professionals to prestigious industry awards and recognition programs.

Given this bank member profile, return only awards where there is a genuine, strong fit. Focus on nationally recognized, prestigious awards in banking leadership, community banking, and financial services. Quality over quantity — 3 great matches is better than 8 mediocre ones. Only include awards you are confident are real and currently active.

Member profile:
- Name: ${profile.name || "Not specified"}
- Title: ${profile.title || "Not specified"}
- Bank: ${profile.company || "Not specified"}
${profile.state ? `- Location: ${profile.state}\n` : ""}- Key achievements: ${profile.achievements || "Not specified"}`
    : `You are an expert at matching fintech companies and their leaders to prestigious startup, innovation, and technology awards.

Given this fintech company profile, return only awards where there is a genuine, strong fit. Focus on nationally recognized, prestigious awards in fintech innovation, startup excellence, and technology leadership. Quality over quantity — 3 great matches is better than 8 mediocre ones. Only include awards you are confident are real and currently active.

Company profile:
- Founder / Executive: ${profile.name || "Not specified"}
- Title: ${profile.title || "Not specified"}
- Company: ${profile.company || "Not specified"}
${profile.state ? `- Location: ${profile.state}\n` : ""}- Key achievements: ${profile.achievements || "Not specified"}`;
}

const SCAN_SHARED_INSTRUCTIONS = `

Return ONLY a valid JSON array. No preamble, no markdown fences. Each object must have exactly these keys:
award_name, org, match, fit_reason, nomination_angle, deadline_season, deadline_date, website_url, nomination_url

match: "High" or "Medium"
deadline_date: estimated MM/DD/YYYY for next cycle (assuming today is June 2026), "Rolling", or "Check website"
website_url: award info page — never null; use org homepage or https://www.google.com/search?q=Award+Name+nomination as fallback
nomination_url: direct nomination/submission page URL, or null if unknown`;

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

  // GET /api/members?q=
  if (req.method === "GET" && req.url.startsWith("/api/members")) {
    const q = (new URL(req.url, "http://localhost").searchParams.get("q") || "").trim();
    if (!q) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
      return;
    }
    try {
      const members = await searchMembers(q);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(members));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/scan
  if (req.method === "POST" && req.url === "/api/scan") {
    if (!API_KEY) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not set on server." }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { transcript } = JSON.parse(body);
        if (!transcript?.trim()) throw new Error("No transcript provided.");

        // Step 1: extract member profiles from transcript
        const extractResp = await callClaudeAPI({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: `Extract all banking professionals and fintech executives mentioned in the following transcript or meeting notes. Only extract people being discussed as members, clients, or prospects — not the interviewer or note-taker.

For each person return a JSON object with these exact keys: name, title, company, state, type, achievements
- type: "bank" if they work at a bank/credit union/financial institution, "fintech" if fintech/startup/tech, default "bank" if unclear
- achievements: a string summarizing ALL accomplishments, projects, and notable work mentioned about this person
- Use "" for any field not mentioned

Return ONLY a valid JSON array. No preamble, no markdown fences.

Transcript:
${transcript.slice(0, 8000)}`,
          }],
        });

        const extractText = extractResp.content?.find((b) => b.type === "text")?.text || "[]";
        let profiles = [];
        try { profiles = JSON.parse(extractText.replace(/```json|```/g, "").trim()); } catch { profiles = []; }
        if (!Array.isArray(profiles)) profiles = [];
        profiles = profiles.filter((p) => p.name || p.company).slice(0, 8);

        if (!profiles.length) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ members: [] }));
          return;
        }

        // Step 2: award matching for each member (sequential, no web search for speed)
        const members = [];
        for (const profile of profiles) {
          try {
            const awardResp = await callClaudeAPI({
              model: "claude-sonnet-4-20250514",
              max_tokens: 3000,
              messages: [{ role: "user", content: buildAwardPrompt(profile) + SCAN_SHARED_INSTRUCTIONS }],
            });
            const awardText = awardResp.content?.find((b) => b.type === "text")?.text || "[]";
            let awards = [];
            try { awards = JSON.parse(awardText.replace(/```json|```/g, "").trim()); } catch { awards = []; }
            members.push({ profile, awards: Array.isArray(awards) ? awards : [] });
          } catch {
            members.push({ profile, awards: [] });
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ members }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/match (with web search)
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

        const isBank = profile.type === "bank";

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
${profile.state ? `- Location: ${profile.state}\n` : ""}- Key achievements: ${profile.achievements}

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
- Company: ${profile.company}${profile.state ? `\n- Location: ${profile.state}` : ""}
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

        const apiResp = await callClaudeAPI({
          model: "claude-sonnet-4-20250514",
          max_tokens: 5000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: fullPrompt }],
        });

        if (apiResp.error) throw new Error(apiResp.error.message || "API error");

        const rawText = apiResp.content?.find((b) => b.type === "text")?.text || "[]";
        const clean = rawText.replace(/```json|```/g, "").trim();
        let awards = [];
        try {
          awards = JSON.parse(clean);
        } catch {
          const m = clean.match(/\[[\s\S]*\]/);
          if (m) { try { awards = JSON.parse(m[0]); } catch {} }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ awards: Array.isArray(awards) ? awards : [] }));
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
