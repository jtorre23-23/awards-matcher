# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the server
node server.js

# Install dependencies
npm install

# Run with env vars
ANTHROPIC_API_KEY=sk-ant-... node server.js
```

There is no build step, test suite, or linter configured.

## Architecture

**Awards Matcher** is a two-file full-stack app: a Node.js HTTP server (`server.js`) and a single-page app (`public/index.html`). It uses the Anthropic Claude API to match banking professionals or fintech executives to relevant awards and recognition programs.

### Backend — `server.js`

Plain Node.js HTTP server (no framework). Routes:

| Route | Purpose |
|---|---|
| `POST /api/match` | Find awards for a single profile — uses Claude with `web_search` tool for real-time URLs/deadlines |
| `POST /api/scan` | Extract members from a transcript, then find awards for each — sequential Claude calls, no web search |
| `GET /api/members?q=` | Autocomplete member search via Microsoft Graph (SharePoint/Excel) |
| `GET/POST/DELETE /api/profiles` | CRUD for saved profiles (persisted to `profiles.json`) |

Claude is called via raw HTTPS to `/v1/messages` using `claude-sonnet-4-20250514`. The model, prompt structure, and `web_search` tool config are all in `server.js`. Two prompt branches exist: one for bank members, one for fintech executives.

The Microsoft Graph integration (member search) is optional — it requires `MICROSOFT_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, and has SharePoint drive/item IDs hardcoded at the top of `server.js`.

**Profiles** are stored in `profiles.json` (local file, not persisted across server restarts on ephemeral hosts).

### Frontend — `public/index.html`

Vanilla JS + HTML + CSS, all in one file (~1,250 lines). Three views controlled by show/hide:

- **view-form** — Profile entry with Bank Member / Fintech Company tabs; name field has MS Graph autocomplete
- **view-results** — Award cards for a single matched profile, sorted by deadline soonest-first
- **view-scan** — Transcript paste → accordion of members each with their awards

The "Draft nomination" button constructs a URL to open a Claude chat pre-filled with nomination context. Award cards show match strength (High/Medium), deadline urgency (color-coded badges), fit reason, and nomination angle.

### Data shapes

**Award** (returned by Claude, rendered as card):
```json
{
  "award_name": "...", "org": "...", "match": "High|Medium",
  "fit_reason": "...", "nomination_angle": "...",
  "deadline_season": "Q1|Q3|Rolling",
  "deadline_date": "MM/DD/YYYY|Rolling|Check website",
  "website_url": "https://...", "nomination_url": "https://...|null"
}
```

**Profile** (saved to profiles.json):
```json
{
  "id": "1704067200000", "savedAt": "ISO string",
  "type": "bank|fintech", "name": "...", "title": "...",
  "company": "...", "state": "...", "achievements": "..."
}
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `PORT` | No | Server port (default 3000) |
| `MICROSOFT_TENANT_ID` | No | MS Graph auth |
| `MS_CLIENT_ID` | No | MS Graph auth |
| `MS_CLIENT_SECRET` | No | MS Graph auth |

## Key design decisions

- **Sequential scan processing** — `/api/scan` calls Claude once per member in series to avoid rate limits; this is intentional and slow for large transcripts
- **Web search only on `/api/match`** — scan skips web search for speed; individual match uses it for real-time deadline data
- **Hardcoded SharePoint IDs** — `SP_DRIVE_ID` and `SP_ITEM_ID` at the top of `server.js` must be updated if the source Excel workbook changes
- **No auth** — all endpoints are public; intended for trusted internal use only
