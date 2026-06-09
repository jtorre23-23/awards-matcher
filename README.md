# Awards Matcher

AI-powered tool for matching member profiles to relevant awards and recognition programs.

## What it does

1. You enter a member's profile (name, industry, career stage, achievement themes, key accomplishments)
2. The AI finds 5–6 real, relevant awards they should apply for
3. Each award includes a fit explanation and a suggested nomination angle
4. One click opens a Claude chat to draft the full nomination

---

## Setup (5 minutes)

### Prerequisites
- Node.js 18 or higher ([download](https://nodejs.org))
- An Anthropic API key ([get one](https://console.anthropic.com))

### Run locally

```bash
# 1. Go into the project folder
cd awards-matcher

# 2. Start the server with your API key
ANTHROPIC_API_KEY=sk-ant-your-key-here node server.js

# 3. Open your browser
# http://localhost:3000
```

On Windows, set the environment variable like this:
```
set ANTHROPIC_API_KEY=sk-ant-your-key-here
node server.js
```

---

## Deploy to a server

### Option A — Render.com (free tier, easiest)
1. Push this folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo
4. Set **Build command**: (leave blank)
5. Set **Start command**: `node server.js`
6. Add environment variable: `ANTHROPIC_API_KEY` = your key
7. Deploy — you'll get a public URL

### Option B — Railway.app
1. Push to GitHub
2. New project → Deploy from GitHub repo
3. Add `ANTHROPIC_API_KEY` in Variables tab
4. Done — public URL provided automatically

### Option C — Your own server (VPS/EC2)
```bash
# Upload files, then:
export ANTHROPIC_API_KEY=sk-ant-your-key-here
node server.js

# To keep it running (use pm2):
npm install -g pm2
pm2 start server.js --name awards-matcher
pm2 save
```

---

## Project structure

```
awards-matcher/
├── server.js          # Node.js backend — proxies Anthropic API calls
├── package.json
└── public/
    └── index.html     # Full frontend app (self-contained)
```

---

## Customizing

**Add more achievement themes** — edit the tag list in `public/index.html` around line 140.

**Change industries** — edit the `<select id="f-industry">` options in `public/index.html`.

**Adjust the AI prompt** — edit the `prompt` string in `server.js` around line 30 to emphasize different award types or add organization-specific context.

**Add a logo / branding** — edit the `<header>` section in `public/index.html`.

---

## Cost

Each search uses approximately 500–800 input tokens + 1,000 output tokens.
At current Anthropic pricing (~$0.003/1K tokens for Sonnet), each search costs roughly **$0.005** (half a cent).
