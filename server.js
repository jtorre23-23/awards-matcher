const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const PROFILES_PATH = path.join(DATA_DIR, "profiles.json");
const AWARDS_DB_PATH = path.join(DATA_DIR, "awards-db.json");
const REVIEW_QUEUE_PATH = path.join(DATA_DIR, "review-queue.json");
const AUTOMATION_STATE_PATH = path.join(DATA_DIR, "automation-state.json");
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const NOTION_API_TOKEN = process.env.NOTION_API_TOKEN;
const NOTION_PARENT_PAGE_ID = process.env.NOTION_PARENT_PAGE_ID;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;
const SENDGRID_TO_EMAIL = process.env.SENDGRID_TO_EMAIL;
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_API_HOST = process.env.ZOHO_API_HOST || "www.zohoapis.com";
const ZOHO_OAUTH_HOST = process.env.ZOHO_OAUTH_HOST || "accounts.zoho.com";
const NOTION_API_KEY = process.env.NOTION_API_KEY || process.env.NOTION_API_TOKEN;
const NOTION_AWARDS_DB_ID = process.env.NOTION_AWARDS_DB_ID || 'cb520702-862a-4d8e-a969-535792bb6c43';
const NOTION_MEMBER_PROFILES_DB_ID = process.env.NOTION_MEMBER_PROFILES_DB_ID || '3b5f04c85d7a4ff1b9f55f89a85d0b08';

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

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  ensureDataDirectory();
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return fallback; }
}

function writeJsonFile(filePath, data) {
  ensureDataDirectory();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readProfiles() {
  return readJsonFile(PROFILES_PATH, []);
}

function writeProfiles(profiles) {
  writeJsonFile(PROFILES_PATH, profiles);
}

function loadAwardsDb() {
  return readJsonFile(AWARDS_DB_PATH, []);
}

function loadReviewQueue() {
  return readJsonFile(REVIEW_QUEUE_PATH, []);
}

function saveReviewQueue(items) {
  writeJsonFile(REVIEW_QUEUE_PATH, items);
}

function loadAutomationState() {
  return readJsonFile(AUTOMATION_STATE_PATH, { lastRun: null });
}

function saveAutomationState(state) {
  writeJsonFile(AUTOMATION_STATE_PATH, state);
}

const INITIAL_AWARDS_DB = [
  {
    id: "aba-community-bank-leader",
    award_name: "Community Bank Leadership Award",
    org: "American Bankers Association",
    description: "Recognizes outstanding leadership in community banking, local growth, and differentiated customer impact.",
    region: "National",
    typical_deadline: "Q2",
    website_url: "https://www.aba.com/about-us/awards",
    nomination_url: null
  },
  {
    id: "american-banker-innovators",
    award_name: "American Banker Innovators Award",
    org: "American Banker",
    description: "Celebrates financial services leaders and teams who launch innovative products, services, and transformation programs.",
    region: "National",
    typical_deadline: "Q1",
    website_url: "https://www.americanbanker.com/awards/innovators",
    nomination_url: "https://www.americanbanker.com/awards/innovators/entry"
  },
  {
    id: "fintech-breakthrough",
    award_name: "Fintech Breakthrough Award",
    org: "Fintech Breakthrough",
    description: "Honors fintech companies and technology leaders for innovation, growth, and measurable business impact.",
    region: "Global",
    typical_deadline: "Q3",
    website_url: "https://fintechbreakthrough.com/awards/",
    nomination_url: "https://fintechbreakthrough.com/awards/enter/"
  },
  {
    id: "bank-director-top-25-women",
    award_name: "Top 25 Women in Banking",
    org: "Bank Director",
    description: "Recognizes senior women bankers and executives who are leading cultural change, growth, and strategic innovation.",
    region: "National",
    typical_deadline: "Q2",
    website_url: "https://www.bankdirector.com/awards/top-25-women-in-banking/",
    nomination_url: null
  },
  {
    id: "community-banking-leadership-award",
    award_name: "Community Banking Leadership Award",
    org: "Independent Community Bankers of America",
    description: "Rewards community bank leaders and teams for excellence in serving small businesses and underserved communities.",
    region: "National",
    typical_deadline: "Q4",
    website_url: "https://www.icba.org/",
    nomination_url: null
  }
];

function makeAutoId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function initializeDataFiles() {
  ensureDataDirectory();
  if (!fs.existsSync(PROFILES_PATH)) writeJsonFile(PROFILES_PATH, []);
  if (!fs.existsSync(AWARDS_DB_PATH)) writeJsonFile(AWARDS_DB_PATH, INITIAL_AWARDS_DB);
  if (!fs.existsSync(REVIEW_QUEUE_PATH)) writeJsonFile(REVIEW_QUEUE_PATH, []);
  if (!fs.existsSync(AUTOMATION_STATE_PATH)) writeJsonFile(AUTOMATION_STATE_PATH, { lastRun: null });
}

function getFirstOfNextMonthRun(after = new Date()) {
  const next = new Date(after.getFullYear(), after.getMonth(), 1, 9, 0, 0);
  if (after >= next) next.setMonth(next.getMonth() + 1);
  return next;
}

function formatDateISO(date) {
  return new Date(date).toISOString();
}

async function matchProfileWithAwards(profile, awards) {
  if (!awards.length) return [];
  const filteredAwards = awards.map((award) => ({
    id: award.id,
    award_name: award.award_name,
    org: award.org,
    description: award.description,
    region: award.region,
    typical_deadline: award.typical_deadline,
    website_url: award.website_url || "",
    nomination_url: award.nomination_url || null,
  }));

  const prompt = `You are an expert at matching award opportunities to candidate profiles.

Candidate profile:
- Name: ${profile.name || "Unknown"}
- Title: ${profile.title || "Not specified"}
- Company / Bank: ${profile.company || "Not specified"}
${profile.state ? `- Location: ${profile.state}
` : ""}${profile.portfolio ? `- Portfolio / Ventures: ${profile.portfolio}
` : ""}- Key achievements: ${profile.achievements || "Not specified"}

Tracked award opportunities:
${JSON.stringify(filteredAwards, null, 2)}

Return only the 3 best matches from this tracked award database. Use only awards from the database. For each award, return an object with these exact keys:
award_id, award_name, org, match, fit_reason, nomination_angle, deadline_season, deadline_date, website_url, nomination_url

- match must be either "High" or "Medium"
- deadline_season should be a short cycle like Q1, Q2, Q3, Q4, rolling, or "Check website"
- deadline_date should be the most likely next nomination deadline in MM/DD/YYYY format, "Rolling", or "Check website"
- website_url should be the award information page URL from the tracked database if available
- nomination_url should be the direct nomination page URL if available; if not known, use the tracked database value or leave null

Return ONLY a valid JSON array with no markdown fences or extra text.`;

  const resp = await callClaudeAPI({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2200,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: "user", content: prompt }],
  });

  const raw = resp.content?.find((b) => b.type === "text")?.text || "[]";
  const clean = raw.replace(/```json|```/g, "").trim();
  let matches = [];
  try {
    matches = JSON.parse(clean);
  } catch {
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      try { matches = JSON.parse(match[0]); } catch {}
    }
  }
  return Array.isArray(matches) ? matches : [];
}

async function buildDraftSummary(profile, award, match) {
  const typeLabel = profile.type === 'bank' ? 'banking professional' : 'fintech leader';
  const orgLabel = profile.type === 'bank' ? 'bank' : 'company';

  const prompt = `Write a complete, professional 400-word nomination letter for the award below. Structure it as five paragraphs: (1) compelling hook establishing why the nominee stands out — do not start with "I am pleased to nominate"; (2) most significant achievement with specific measurable impact — use [INSERT METRIC] as placeholder where data is unknown; (3) second major achievement showing a different dimension of their leadership; (4) direct connection between the nominee's work and what this award specifically values; (5) strong closing that makes the case for why they should win. Tone: authoritative, specific, persuasive. Output only the letter text — no preamble, no subject line, no commentary.

Award: ${award.award_name}
Organization: ${award.org}
What this award recognizes: ${match.fit_reason || award.description || ''}
Nomination angle: ${match.nomination_angle || ''}

Nominee:
- Name: ${profile.name}
- Title: ${profile.title || 'Not specified'}
- ${profile.type === 'bank' ? 'Bank' : 'Company'}: ${profile.company || 'Not specified'}
${profile.state ? `- Location: ${profile.state}` : ''}
- Background: ${typeLabel}
- Key achievements: ${profile.achievements || 'Not specified'}`;

  const resp = await callClaudeAPI({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  return resp.content?.find((b) => b.type === 'text')?.text?.trim() || '';
}

async function sendEmailDigest(items) {
  if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL || !SENDGRID_TO_EMAIL) return;
  const subject = items.length
    ? `Awards automation digest — ${items.length} new nomination item${items.length !== 1 ? 's' : ''}`
    : 'Awards automation digest — no new nomination items';
  const body = items.length
    ? items.map((item, index) => `Item ${index + 1}: ${item.award.award_name} (${item.award.org})\nCandidate: ${item.profile.name || item.profile.company}\nMatch: ${item.match}\nDeadline: ${item.award.deadline_date} (${item.award.deadline_season})\nNomination: ${item.award.nomination_url || item.award.website_url || 'N/A'}\nPortfolio/Ventures: ${item.profile.portfolio || 'N/A'}\nSummary: ${item.draft_summary}`).join('\n\n')
    : 'No new nomination items were generated this month.';

  const payload = {
    personalizations: [{ to: [{ email: SENDGRID_TO_EMAIL }] }],
    from: { email: SENDGRID_FROM_EMAIL },
    subject,
    content: [{ type: 'text/plain', value: body }],
  };

  await callHTTPS(
    {
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
      },
    },
    JSON.stringify(payload),
    false
  );
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function approximateDeadlineDate(award) {
  const now = new Date();
  const q = String(award.typical_deadline || '').trim().toUpperCase();
  if (award.next_deadline_date) {
    return parseDateOrNull(award.next_deadline_date);
  }
  if (q === 'ROLLING') return now;
  const quarterMap = { Q1: 2, Q2: 5, Q3: 8, Q4: 11 };
  const month = quarterMap[q];
  if (month === undefined) return null;
  const year = now.getMonth() <= month ? now.getFullYear() : now.getFullYear() + 1;
  return new Date(year, month, 15);
}

function filterUpcomingAwards(awards, days = 90) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return awards.filter((award) => {
    const deadline = approximateDeadlineDate(award);
    if (!deadline) return false;
    if (award.typical_deadline?.toLowerCase() === 'rolling') return true;
    return deadline >= now && deadline <= cutoff;
  });
}

async function getZohoAccessToken() {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Zoho credentials not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN.');
  }
  const url = `/oauth/v2/token?refresh_token=${encodeURIComponent(ZOHO_REFRESH_TOKEN)}&client_id=${encodeURIComponent(ZOHO_CLIENT_ID)}&client_secret=${encodeURIComponent(ZOHO_CLIENT_SECRET)}&grant_type=refresh_token`;
  const data = await callHTTPS({ hostname: ZOHO_OAUTH_HOST, path: url, method: 'GET' });
  if (!data.access_token) throw new Error('Failed to get Zoho access token.');
  return data.access_token;
}

async function fetchZohoContacts(accessToken) {
  const data = await callHTTPS({
    hostname: ZOHO_API_HOST,
    path: '/crm/v2/Contacts?per_page=100&page=1',
    method: 'GET',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
    },
  });
  return Array.isArray(data.data) ? data.data : [];
}

async function fetchZohoNotes(accessToken) {
  const data = await callHTTPS({
    hostname: ZOHO_API_HOST,
    path: '/crm/v2/Notes?per_page=100&page=1',
    method: 'GET',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
    },
  });
  return Array.isArray(data.data) ? data.data : [];
}

async function fetchZohoProfiles() {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) return [];
  const accessToken = await getZohoAccessToken();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let contacts = [];
  try {
    const coqlResp = await callHTTPS(
      {
        hostname: ZOHO_API_HOST,
        path: '/crm/v2/coql',
        method: 'POST',
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
      JSON.stringify({
        select_query: `SELECT First_Name, Last_Name, Title, Account_Name, Modified_Time, Description FROM Contacts WHERE Modified_Time >= '${sixtyDaysAgo}' ORDER BY Modified_Time DESC LIMIT 50`,
      })
    );
    contacts = Array.isArray(coqlResp.data) ? coqlResp.data : [];
  } catch {
    contacts = await fetchZohoContacts(accessToken).catch(() => []);
  }

  const notes = await fetchZohoNotes(accessToken).catch(() => []);
  const cutoffMs = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const notesByParent = notes.reduce((acc, note) => {
    const noteDate = note.Modified_Time ? new Date(note.Modified_Time).getTime() : 0;
    if (noteDate < cutoffMs) return acc;
    const parentId = note.Parent_Id?.id || note.Parent_Id?.name;
    if (!parentId) return acc;
    acc[parentId] = acc[parentId] || [];
    if (note.Note_Content) acc[parentId].push(note.Note_Content);
    return acc;
  }, {});

  return contacts.map(contact => {
    const parentId = contact.id;
    const noteContent = (notesByParent[parentId] || []).join(' // ');
    const achievements = [contact.Description || '', noteContent].filter(Boolean).join(' -- ');
    const accountName = contact.Account_Name?.name || contact.Account_Name || '';
    return {
      id: parentId,
      type: 'bank',
      name: [contact.First_Name, contact.Last_Name].filter(Boolean).join(' ').trim() || accountName || 'Unknown',
      title: contact.Title || '',
      company: accountName,
      state: contact.Mailing_State || contact.Other_State || '',
      achievements: achievements || `Recent Zoho activity for ${accountName || contact.First_Name}`,
      source: 'zoho',
    };
  }).filter(p => p.name || p.company);
}

async function discoverAwardsFromWeb() {
  if (!API_KEY) return [];
  const prompt = `Search the web for awards and open nomination opportunities relevant to banking, financial services, community banking, and fintech.

Return a JSON array of awards that have nominations currently open or are newly opened within the next 60 days. Each object should use these exact keys: award_name, org, description, region, typical_deadline, next_deadline_date, website_url, nomination_url.

For each award:
- nomination_url must be the direct nomination or application page
- website_url must be the award information page
- next_deadline_date should be the next confirmed nomination deadline in MM/DD/YYYY format or "Rolling"
- typical_deadline should describe the normal cycle (Q1, Q2, Q3, Q4, or Rolling)

Return only valid JSON array output with no markdown fences or extra text.`;

  const resp = await callClaudeAPI({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = resp.content?.find((b) => b.type === 'text')?.text || '[]';
  const clean = raw.replace(/```json|```/g, '').trim();
  let awards = [];
  try { awards = JSON.parse(clean); } catch {
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      try { awards = JSON.parse(match[0]); } catch {}
    }
  }
  return Array.isArray(awards) ? awards : [];
}

function mergeNewAwards(existingAwards, discoveredAwards) {
  const byKey = {};
  existingAwards.forEach((award) => {
    byKey[`${award.award_name}`.toLowerCase()] = award;
  });
  discoveredAwards.forEach((award) => {
    const key = `${award.award_name}`.toLowerCase();
    if (byKey[key]) {
      byKey[key] = { ...byKey[key], ...award, id: byKey[key].id };
    } else {
      const id = slugify(`${award.award_name}-${award.org}`) || makeAutoId();
      byKey[key] = { ...award, id };
    }
  });
  return Object.values(byKey);
}

async function fetchNotionAwards() {
  if (!NOTION_API_KEY || !NOTION_AWARDS_DB_ID) return [];
  const now = new Date();
  const cutoff = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const todayStr = now.toISOString().split('T')[0];
  const cutoffStr = cutoff.toISOString().split('T')[0];
  try {
    const data = await callHTTPS(
      {
        hostname: 'api.notion.com',
        path: `/v1/databases/${NOTION_AWARDS_DB_ID}/query`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
      },
      JSON.stringify({
        filter: {
          and: [
            { property: 'Active', checkbox: { equals: true } },
            { property: 'Nomination Deadline', date: { on_or_after: todayStr } },
            { property: 'Nomination Deadline', date: { on_or_before: cutoffStr } },
          ],
        },
      })
    );
    return (data.results || []).map(page => {
      const props = page.properties;
      const awardName = props['Award Name']?.title?.[0]?.plain_text || '';
      const org = props['Organization']?.rich_text?.[0]?.plain_text || '';
      const deadline = props['Nomination Deadline']?.date?.start || null;
      const url = props['URL']?.url || null;
      const criteria = props['Eligibility / Criteria']?.rich_text?.[0]?.plain_text || '';
      return {
        id: slugify(`${awardName}-${org}`) || makeAutoId(),
        award_name: awardName,
        org,
        description: criteria,
        region: 'National',
        typical_deadline: 'Check website',
        next_deadline_date: deadline,
        website_url: url,
        nomination_url: null,
        notion_url: page.url,
        source: 'notion',
      };
    }).filter(a => a.award_name);
  } catch (err) {
    console.warn('Notion awards fetch failed:', err.message);
    return [];
  }
}

async function fetchNotionMemberProfiles() {
  if (!NOTION_API_KEY || !NOTION_MEMBER_PROFILES_DB_ID) return [];
  try {
    const data = await callHTTPS(
      {
        hostname: 'api.notion.com',
        path: `/v1/databases/${NOTION_MEMBER_PROFILES_DB_ID}/query`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
      },
      JSON.stringify({})
    );
    return (data.results || []).map(page => {
      const props = page.properties;
      const getTitle = (p) => p?.title?.[0]?.plain_text || '';
      const getText = (p) => p?.rich_text?.[0]?.plain_text || p?.title?.[0]?.plain_text || '';
      const getSelect = (p) => p?.select?.name || '';
      const name = getTitle(props['Name'] || props['Member Name'] || props['Full Name'] || props['Contact Name'] || {});
      const title = getText(props['Title'] || props['Job Title'] || props['Role'] || {});
      const company = getText(props['Company'] || props['Bank'] || props['Organization'] || props['Account'] || {});
      const state = getText(props['State'] || props['Location'] || props['Region'] || {});
      const achievements = getText(props['Achievements'] || props['Bio'] || props['Notes'] || props['Description'] || props['About'] || {});
      const typeRaw = getSelect(props['Type'] || props['Member Type'] || {});
      return {
        id: page.id,
        type: typeRaw.toLowerCase().includes('fintech') ? 'fintech' : 'bank',
        name,
        title,
        company,
        state,
        achievements,
        source: 'notion',
      };
    }).filter(p => p.name || p.company);
  } catch (err) {
    console.warn('Notion member profiles fetch failed:', err.message);
    return [];
  }
}

async function postSlackNotification(item) {
  if (!SLACK_WEBHOOK_URL) return;
  const slackUrl = new URL(SLACK_WEBHOOK_URL);
  const text = `*New awards automation item*\n*Candidate:* ${item.profile.name || item.profile.company}\n*Award:* ${item.award.award_name} (${item.award.org})\n*Match:* ${item.match}\n*Deadline:* ${item.award.deadline_date} (${item.award.deadline_season})\n*Nomination:* ${item.award.nomination_url || item.award.website_url || 'N/A'}\n*Portfolio / Ventures:* ${item.profile.portfolio || 'N/A'}\n\n${item.draft_summary}`;

  await callHTTPS(
    {
      hostname: slackUrl.hostname,
      path: slackUrl.pathname + slackUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify({ text }),
    false
  );
}

async function createNotionPageForItem(item) {
  const blocks = [
    { type: "heading_2", heading_2: { text: [{ type: "text", text: { content: item.award.award_name } }] } },
    { type: "paragraph", paragraph: { text: [{ type: "text", text: { content: `Candidate: ${item.profile.name || item.profile.company}` } }] } },
    { type: "paragraph", paragraph: { text: [{ type: "text", text: { content: `Organization: ${item.award.org}` } }] } },
    { type: "paragraph", paragraph: { text: [{ type: "text", text: { content: `Match: ${item.match}` } }] } },
    { type: "paragraph", paragraph: { text: [{ type: "text", text: { content: `Portfolio / Ventures: ${item.profile.portfolio || 'N/A'}` } }] } },
    { type: "paragraph", paragraph: { text: [{ type: "text", text: { content: `Deadline: ${item.award.deadline_date} (${item.award.deadline_season})` } }] } },
    { type: "paragraph", paragraph: { text: [{ type: "text", text: { content: `Nomination URL: ${item.award.nomination_url || item.award.website_url || 'N/A'}` } }] } },
    { type: "heading_3", heading_3: { text: [{ type: "text", text: { content: "Draft nomination summary" } }] } },
    { type: "paragraph", paragraph: { text: [{ type: "text", text: { content: item.draft_summary } }] } },
  ];

  await callHTTPS(
    {
      hostname: "api.notion.com",
      path: "/v1/pages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NOTION_API_TOKEN}`,
        "Notion-Version": "2022-06-28",
      },
    },
    JSON.stringify({
      parent: { page_id: NOTION_PARENT_PAGE_ID },
      properties: {},
      children: blocks,
    })
  );
}

async function createNotionPipelinePage(items) {
  const notionToken = NOTION_API_KEY;
  const parentPageId = NOTION_PARENT_PAGE_ID;
  if (!notionToken || !parentPageId || !items.length) return null;

  const now = new Date();
  const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const pageTitle = `Awards Pipeline — ${monthYear}`;

  const summaryLines = items.map(item => {
    const deadline = item.award.deadline_date;
    const days = deadline && deadline !== 'Rolling' && deadline !== 'Check website'
      ? Math.ceil((new Date(deadline) - now) / (1000 * 60 * 60 * 24)) : null;
    const urgency = days === null ? '🟢' : days <= 30 ? '🔴' : days <= 60 ? '🟡' : '🟢';
    return `${urgency} ${item.profile.name || item.profile.company} → ${item.award.award_name} (deadline: ${deadline || 'TBD'})`;
  });

  function matchBlocks(item) {
    const deadline = item.award.deadline_date;
    const days = deadline && deadline !== 'Rolling' && deadline !== 'Check website'
      ? Math.ceil((new Date(deadline) - now) / (1000 * 60 * 60 * 24)) : null;
    const urgencyColor = days === null ? 'green_background' : days <= 30 ? 'red_background' : days <= 60 ? 'yellow_background' : 'green_background';
    const urgencyEmoji = days === null ? '🟢' : days <= 30 ? '🔴' : days <= 60 ? '🟡' : '🟢';
    const urgencyLabel = days === null ? 'No deadline / rolling' : `${urgencyEmoji} Deadline: ${deadline} (${days} days away)`;

    const blocks = [
      { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: `${item.award.award_name} — ${item.profile.name || item.profile.company}` } }] } },
      { type: 'callout', callout: { rich_text: [{ type: 'text', text: { content: urgencyLabel } }], color: urgencyColor, icon: { emoji: urgencyEmoji } } },
      { type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'Member Profile' } }] } },
      { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: [item.profile.name, item.profile.title, item.profile.company, item.profile.state].filter(Boolean).join(' · ') } }] } },
      { type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'Award Details' } }] } },
      { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `${item.award.org}${item.award.website_url ? ' · ' + item.award.website_url : ''}` } }] } },
      { type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'Why This Matches' } }] } },
      { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `${item.fit_reason || ''}\n\nNomination angle: ${item.nomination_angle || ''}` } }] } },
      { type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'Draft Nomination' } }] } },
    ];

    const draft = item.draft_summary || '';
    for (let i = 0; i < Math.max(draft.length, 1); i += 2000) {
      blocks.push({ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: draft.slice(i, i + 2000) } }] } });
    }
    blocks.push({ type: 'divider', divider: {} });
    return blocks;
  }

  const headerBlocks = [
    { type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: pageTitle } }] } },
    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `Generated: ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · ${items.length} match${items.length !== 1 ? 'es' : ''} found` } }] } },
    { type: 'divider', divider: {} },
    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Summary' } }] } },
    ...summaryLines.map(line => ({ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: line } }] } })),
    { type: 'divider', divider: {} },
  ];

  const created = await callHTTPS(
    {
      hostname: 'api.notion.com',
      path: '/v1/pages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
      },
    },
    JSON.stringify({
      parent: { page_id: parentPageId },
      properties: { title: { title: [{ text: { content: pageTitle } }] } },
      children: headerBlocks,
    })
  );

  const pageId = created.id;
  const allMatchBlocks = items.flatMap(item => matchBlocks(item));
  for (let i = 0; i < allMatchBlocks.length; i += 90) {
    await callHTTPS(
      {
        hostname: 'api.notion.com',
        path: `/v1/blocks/${pageId}/children`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28',
        },
      },
      JSON.stringify({ children: allMatchBlocks.slice(i, i + 90) })
    );
  }

  return created.url;
}

async function runAutomationBatch() {
  // Step 1: Awards — Notion (primary) + local db, merged
  const [notionAwards, localAwards] = await Promise.all([
    fetchNotionAwards().catch(err => { console.warn('Notion awards:', err.message); return []; }),
    Promise.resolve(loadAwardsDb()),
  ]);
  let awards = mergeNewAwards(localAwards, notionAwards);

  // Supplement with web-discovered awards
  const discoveredAwards = await discoverAwardsFromWeb().catch(err => { console.warn('Award discovery:', err.message); return []; });
  if (discoveredAwards.length) {
    awards = mergeNewAwards(awards, discoveredAwards);
    writeJsonFile(AWARDS_DB_PATH, awards);
  }

  const upcomingAwards = filterUpcomingAwards(awards, 90);
  const awardPool = upcomingAwards.length ? upcomingAwards : awards;

  // Step 2: Profiles — Notion + Zoho + saved, deduplicated
  const [notionProfiles, zohoProfiles, savedProfiles] = await Promise.all([
    fetchNotionMemberProfiles().catch(err => { console.warn('Notion profiles:', err.message); return []; }),
    fetchZohoProfiles().catch(err => { console.warn('Zoho profiles:', err.message); return []; }),
    Promise.resolve(readProfiles()),
  ]);

  const allProfiles = [...savedProfiles, ...notionProfiles, ...zohoProfiles];
  const seenProfileKeys = new Set();
  const uniqueProfiles = allProfiles.filter(p => {
    const key = `${p.source || ''}|${p.id || ''}|${(p.name || '').toLowerCase()}|${(p.company || '').toLowerCase()}`;
    if (seenProfileKeys.has(key)) return false;
    seenProfileKeys.add(key);
    return true;
  });

  // Step 3: Match and draft
  const queue = loadReviewQueue();
  const seen = new Set(queue.map(item => `${item.profile.id || 'unknown'}|${item.award.id}`));
  const newItems = [];

  for (const profile of uniqueProfiles) {
    const matches = await matchProfileWithAwards(profile, awardPool);
    if (!matches.length) continue;

    for (const match of matches.slice(0, 3)) {
      const key = `${profile.id || 'unknown'}|${match.award_id}`;
      if (seen.has(key)) continue;
      const award = awardPool.find(a => a.id === match.award_id) || {
        id: match.award_id,
        award_name: match.award_name,
        org: match.org,
        description: '',
      };
      const draft_summary = await buildDraftSummary(profile, award, match);
      const item = {
        id: makeAutoId(),
        createdAt: formatDateISO(new Date()),
        profile,
        award: {
          id: award.id,
          award_name: award.award_name,
          org: award.org,
          website_url: match.website_url || award.website_url || null,
          nomination_url: match.nomination_url || award.nomination_url || null,
          deadline_season: match.deadline_season,
          deadline_date: match.deadline_date,
        },
        match: match.match,
        fit_reason: match.fit_reason,
        nomination_angle: match.nomination_angle,
        draft_summary,
        status: 'pending',
      };
      queue.push(item);
      seen.add(key);
      newItems.push(item);
    }
  }

  // Step 4: Deliver to Notion as consolidated pipeline page
  let lastNotionUrl = loadAutomationState().lastNotionUrl || null;
  if (newItems.length && NOTION_API_KEY && NOTION_PARENT_PAGE_ID) {
    try {
      lastNotionUrl = await createNotionPipelinePage(newItems);
      newItems.forEach(item => { item.notionPageUrl = lastNotionUrl; item.notionStatus = 'created'; });
    } catch (err) {
      console.warn('Notion pipeline page failed:', err.message);
      newItems.forEach(item => { item.notionStatus = 'error'; item.notionError = err.message; });
    }
  }

  // Slack + email
  for (const item of newItems) {
    if (SLACK_WEBHOOK_URL) {
      try { await postSlackNotification(item); item.slackStatus = 'sent'; }
      catch (err) { item.slackStatus = 'error'; item.slackError = err.message; }
    }
  }
  if (newItems.length) {
    try { await sendEmailDigest(newItems); } catch (err) { console.warn('Email digest failed:', err.message); }
  }

  saveReviewQueue(queue);
  saveAutomationState({ lastRun: formatDateISO(new Date()), lastNotionUrl });
  return { added: newItems.length, total: queue.length, newItems, notionUrl: lastNotionUrl };
}

async function maybeRunScheduledAutomation() {
  const state = loadAutomationState();
  const lastRun = state.lastRun ? new Date(state.lastRun) : null;
  const now = new Date();
  const nextRun = getFirstOfNextMonthRun(lastRun || new Date(0));
  if (!lastRun || now >= nextRun) {
    try {
      const result = await runAutomationBatch();
      console.log(`Monthly automation run complete: added=${result.added}, total=${result.total}`);
    } catch (error) {
      console.error("Monthly automation failed", error);
    }
  }
  setTimeout(maybeRunScheduledAutomation, getFirstOfNextMonthRun(now) - now);
}

function getAutomationStatus() {
  const state = loadAutomationState();
  const lastRun = state.lastRun ? new Date(state.lastRun) : null;
  const nextRun = getFirstOfNextMonthRun(lastRun || new Date(0));
  return {
    lastRun: lastRun ? formatDateISO(lastRun) : null,
    nextRun: formatDateISO(nextRun),
    queuedCount: loadReviewQueue().length,
    lastNotionUrl: state.lastNotionUrl || null,
  };
}

// Generic HTTPS helper — optional JSON parsing
function callHTTPS(options, body, parseJson = true) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (r) => {
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => {
        if (!parseJson) return resolve(data);
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

  // GET /api/review-items
  if (req.method === "GET" && req.url === "/api/review-items") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(loadReviewQueue()));
    return;
  }

  // GET /api/automation/status
  if (req.method === "GET" && req.url === "/api/automation/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getAutomationStatus()));
    return;
  }

  // POST /api/automation/run
  if (req.method === "POST" && req.url === "/api/automation/run") {
    try {
      const result = await runAutomationBatch();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
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

initializeDataFiles();

server.listen(PORT, () => {
  console.log(`Awards Matcher running at http://localhost:${PORT}`);
  if (!API_KEY) console.warn("WARNING: ANTHROPIC_API_KEY is not set.");
  maybeRunScheduledAutomation().catch((err) => console.error("Scheduler startup failed", err));
});
