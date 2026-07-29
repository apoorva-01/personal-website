# Email Newsletter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let visitors subscribe to an email newsletter from the blog, and let Apoorva send issues (post-notifications or manual one-offs) from a password-gated admin page on the site.

**Architecture:** Resend's hosted Audience is the only subscriber store (no database). Four new Vercel serverless functions under `api/` handle subscribing, admin login/session-check, reading the latest post, and sending a broadcast. A new static `admin/newsletter.html` page is the composer UI, gated by a signed HttpOnly cookie. Public subscribe forms are added to `blog.html` and to the per-post template in `scripts/build-blog.mjs`.

**Tech Stack:** Vercel serverless functions (Node, ES modules), `resend` npm package (Resend API client), `marked` (markdown → HTML, already used at build time), `gray-matter` (frontmatter parsing, already used at build time), vanilla JS on the client (matches the rest of the site — no framework).

**Spec:** `docs/superpowers/specs/2026-07-30-email-newsletter-design.md`

## Global Constraints

- No database — Resend's Audience is the only subscriber store.
- No double opt-in / confirmation emails — subscribing is instant.
- No scheduled/future-dated sends — broadcasts send immediately.
- No in-site subscriber list/management UI — use the Resend dashboard for that.
- No automatic send-on-publish — publishing a post never emails anyone by itself.
- Email validation regex (reuse exactly, matches `api/contact.js`): `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`
- Honeypot field name (reuse exactly, matches `api/contact.js`): `company`
- Admin session cookie name: `av_admin`, attributes `HttpOnly; Secure; SameSite=Strict`, 7-day `Max-Age`.
- New env vars required: `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`, `ADMIN_PASSWORD`, `ADMIN_SECRET`.
- `admin/newsletter.html` must not be indexed: `Disallow: /admin/` in `robots.txt`, `<meta name="robots" content="noindex, nofollow">` in the page, and it is never added to `sitemap.xml`.

---

### Task 1: Resend account + environment variables (manual setup, no code)

This task cannot be automated — it requires a human to create an external account and copy real secret values. Do this before starting Task 4 (the first task that calls Resend).

**Files:** none (environment configuration only)

- [ ] **Step 1: Create a Resend account**

Go to https://resend.com and sign up (free tier: 3,000 emails/mo, unlimited contacts on one audience).

- [ ] **Step 2: Verify the sending domain**

In the Resend dashboard, go to Domains → Add Domain, enter `apoorvaverma.in`, and add the DNS records it gives you (TXT/DKIM/etc.) wherever the domain's DNS is managed. Wait for it to show "Verified" — sending will fail until it does.

- [ ] **Step 3: Create an Audience**

Dashboard → Audiences → Create Audience. Name it something like "Newsletter". Copy its ID (looks like a UUID) — this is `RESEND_AUDIENCE_ID`.

- [ ] **Step 4: Create an API key**

Dashboard → API Keys → Create API Key. Give it "Sending access" scope. Copy the key (shown once) — this is `RESEND_API_KEY`.

- [ ] **Step 5: Generate ADMIN_PASSWORD and ADMIN_SECRET**

Pick any strong password for `ADMIN_PASSWORD` — this is what you'll type into the admin page. Generate `ADMIN_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output — this is `ADMIN_SECRET` (used to sign the login cookie; never typed by hand, never reused elsewhere).

- [ ] **Step 6: Set all four locally and on Vercel**

Create (or append to) a local `.env` file in the project root (already gitignored):

```
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_AUDIENCE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ADMIN_PASSWORD=your-chosen-password
ADMIN_SECRET=the-64-char-hex-string-from-step-5
```

Then add the same four to the Vercel project so production/preview deploys have them:

```bash
vercel env add RESEND_API_KEY
vercel env add RESEND_AUDIENCE_ID
vercel env add ADMIN_PASSWORD
vercel env add ADMIN_SECRET
```

(Each command prompts for the value and which environments to apply it to — select Production, Preview, and Development for all four.)

- [ ] **Step 7: Verify**

Run:

```bash
grep -c '^[A-Z_]*=' .env
```

Expected: `4` (or more, if other vars like `ANTHROPIC_API_KEY`/`SLACK_WEBHOOK_URL` already exist — just confirm all four new names appear via `grep -E "RESEND_API_KEY|RESEND_AUDIENCE_ID|ADMIN_PASSWORD|ADMIN_SECRET" .env` returning 4 lines).

No commit for this task (no files changed).

---

### Task 2: Shared admin-session helper

**Files:**
- Create: `api/_lib/adminAuth.js`

**Interfaces:**
- Produces: `createSessionCookie(): string` — a full `Set-Cookie` header value.
- Produces: `verifySession(req): boolean` — `req` is a Vercel request object with `req.headers.cookie` (string or undefined).
- Produces: `safeEqualStrings(a: string, b: string): boolean` — timing-safe string comparison of arbitrary-length strings.

Files prefixed with `_` under `api/` are not treated as routes by Vercel, so this file is safe to import without becoming an accidental endpoint.

- [ ] **Step 1: Write the helper**

```js
// api/_lib/adminAuth.js
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "av_admin";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sign(expiry) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET is not configured");
  return createHmac("sha256", secret).update(String(expiry)).digest("hex");
}

// Hashes both sides first so timingSafeEqual always compares equal-length
// buffers, regardless of the raw strings' lengths (avoids leaking length
// via early-return comparisons).
export function safeEqualStrings(a, b) {
  const ha = createHmac("sha256", "cmp").update(String(a)).digest();
  const hb = createHmac("sha256", "cmp").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function createSessionCookie() {
  const expiry = Date.now() + MAX_AGE_MS;
  const token = `${expiry}.${sign(expiry)}`;
  const maxAgeSec = Math.floor(MAX_AGE_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export function verifySession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const expiryStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  try {
    return safeEqualStrings(sig, sign(expiry));
  } catch (e) {
    return false;
  }
}
```

- [ ] **Step 2: Verify it by hand**

Run:

```bash
node --input-type=module -e "
import { createSessionCookie, verifySession, safeEqualStrings } from './api/_lib/adminAuth.js';
process.env.ADMIN_SECRET = 'test-secret-for-verification-only';

const cookieHeader = createSessionCookie();
const token = cookieHeader.split(';')[0].split('=')[1];
console.log('valid session:', verifySession({ headers: { cookie: 'av_admin=' + token } }));
console.log('missing cookie:', verifySession({ headers: {} }));
console.log('tampered sig:', verifySession({ headers: { cookie: 'av_admin=' + token.split('.')[0] + '.deadbeef' } }));
console.log('safeEqualStrings same:', safeEqualStrings('abc', 'abc'));
console.log('safeEqualStrings diff:', safeEqualStrings('abc', 'abcd'));
"
```

Expected output:

```
valid session: true
missing cookie: false
tampered sig: false
safeEqualStrings same: true
safeEqualStrings diff: false
```

- [ ] **Step 3: Commit**

```bash
git add api/_lib/adminAuth.js
git commit -m "Add shared admin-session cookie signing/verification helper"
```

---

### Task 3: Admin login + session-check route

**Files:**
- Create: `api/admin-login.js`

**Interfaces:**
- Consumes: `createSessionCookie()`, `verifySession(req)` from `./_lib/adminAuth.js` (Task 2).
- Produces: `GET /api/admin-login` → `200 { ok: boolean }` (session check, no auth required to call).
- Produces: `POST /api/admin-login` with body `{ password: string }` → `200 { ok: true }` + `Set-Cookie: av_admin=...` on success, or `401 { error: string }` on wrong password, or `500 { error: string }` if `ADMIN_PASSWORD` isn't set.

- [ ] **Step 1: Write the route**

```js
// api/admin-login.js
import { createSessionCookie, verifySession, safeEqualStrings } from "./_lib/adminAuth.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ ok: verifySession(req) });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const password = String(body.password || "");

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: "Admin login isn't configured yet." });
    return;
  }

  if (!safeEqualStrings(password, expected)) {
    res.status(401).json({ error: "Incorrect password." });
    return;
  }

  res.setHeader("Set-Cookie", createSessionCookie());
  res.status(200).json({ ok: true });
}
```

- [ ] **Step 2: Start the local dev server**

In one terminal, run and leave running:

```bash
vercel dev --listen 3000
```

- [ ] **Step 3: Verify the session-check branch (no cookie)**

```bash
curl -s http://localhost:3000/api/admin-login
```

Expected: `{"ok":false}`

- [ ] **Step 4: Verify wrong password**

```bash
curl -s -X POST http://localhost:3000/api/admin-login \
  -H "Content-Type: application/json" \
  -d '{"password":"definitely-wrong"}'
```

Expected: `{"error":"Incorrect password."}` with HTTP status 401.

- [ ] **Step 5: Verify correct password sets a cookie**

```bash
curl -si -X POST http://localhost:3000/api/admin-login \
  -H "Content-Type: application/json" \
  -d '{"password":"'"$ADMIN_PASSWORD"'"}'
```

(Replace `$ADMIN_PASSWORD` with the actual value from your `.env` if the shell doesn't have it exported.) Expected: `200 OK`, a `Set-Cookie: av_admin=...; HttpOnly; Secure; SameSite=Strict` header, and body `{"ok":true}`.

- [ ] **Step 6: Commit**

```bash
git add api/admin-login.js
git commit -m "Add admin login and session-check API route"
```

---

### Task 4: Public subscribe endpoint

**Files:**
- Create: `api/subscribe.js`
- Modify: `package.json` (add `resend` as a runtime dependency)

**Interfaces:**
- Produces: `POST /api/subscribe` with body `{ email: string, company?: string }` → `200 { ok: true }` on success (including "already subscribed"), `400 { error: string }` on invalid email, `502 { error: string }` on Resend failure, `500 { error: string }` if unconfigured.

- [ ] **Step 1: Install the Resend SDK**

```bash
npm install resend
```

- [ ] **Step 2: Confirm the installed SDK's contacts API shape**

The code below assumes `resend.contacts.create({ email, audienceId, unsubscribed })` returning `{ data, error }`. Confirm this matches what actually got installed before writing the route:

```bash
grep -A 10 "class Contacts" node_modules/resend/dist/index.d.ts
```

If the method name or parameter names differ from `create({ email, audienceId, unsubscribed })`, adjust Step 3's code to match what you see — the shape below is based on the SDK's documented API at time of writing and should be treated as a starting point, not gospel.

- [ ] **Step 3: Move `resend` into dependencies**

Open `package.json` and confirm `npm install resend` added it under `"dependencies"` (not `"devDependencies"`) — this code runs at request time in production, not just at build time. If it landed in the wrong section, move it manually so `dependencies` reads:

```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.40.0",
  "resend": "^6.18.1"
}
```

(Keep the exact version `npm install` wrote; `^6.18.1` above is illustrative.)

- [ ] **Step 4: Write the route**

```js
// api/subscribe.js
import { Resend } from "resend";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const email = String(body.email || "").trim();
  const honeypot = String(body.company || "").trim();

  // Bots fill the hidden field; pretend success and drop it (matches api/contact.js).
  if (honeypot) {
    res.status(200).json({ ok: true });
    return;
  }

  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    res.status(500).json({ error: "Newsletter signup isn't configured yet." });
    return;
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.contacts.create({ email, audienceId, unsubscribed: false });

  // Resubscribing an existing contact isn't an error from the visitor's
  // point of view — only surface genuinely unexpected failures.
  if (error && !/already exists/i.test(error.message || "")) {
    res.status(502).json({ error: "Couldn't subscribe you right now. Try again later." });
    return;
  }

  res.status(200).json({ ok: true });
}
```

- [ ] **Step 5: Verify the "unconfigured" branch without real credentials**

Temporarily rename `.env`'s `RESEND_API_KEY` line (or run without it loaded), restart `vercel dev`, then:

```bash
curl -s -X POST http://localhost:3000/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

Expected: `{"error":"Newsletter signup isn't configured yet."}` with status 500. Restore the real `RESEND_API_KEY` afterward and restart `vercel dev`.

- [ ] **Step 6: Verify invalid email is rejected**

```bash
curl -s -X POST http://localhost:3000/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email"}'
```

Expected: `{"error":"Enter a valid email address."}` with status 400.

- [ ] **Step 7: Verify the honeypot silently drops bots**

```bash
curl -s -X POST http://localhost:3000/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"bot@example.com","company":"filled-in-by-a-bot"}'
```

Expected: `{"ok":true}`, and confirm in the Resend dashboard's Audience that `bot@example.com` was NOT added.

- [ ] **Step 8: Verify a real subscribe (requires Task 1's real credentials)**

```bash
curl -s -X POST http://localhost:3000/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR-OWN-TEST-EMAIL@example.com"}'
```

Expected: `{"ok":true}`. Confirm the address now appears in the Resend dashboard under your Audience. Delete it from the audience afterward if it was a throwaway test address.

- [ ] **Step 9: Commit**

```bash
git add api/subscribe.js package.json package-lock.json
git commit -m "Add public newsletter subscribe endpoint"
```

---

### Task 5: Latest-post endpoint

**Files:**
- Create: `api/latest-post.js`
- Modify: `package.json` (move `gray-matter` from `devDependencies` to `dependencies`)

**Interfaces:**
- Produces: `GET /api/latest-post` → `200 { title: string, excerpt: string, slug: string, url: string }`, or `404 { error: string }` if `content/posts/` has no `.md` files.

This route intentionally has no auth check — it only exposes data that's already public on the built post pages.

- [ ] **Step 1: Move `gray-matter` to dependencies**

Open `package.json`. `gray-matter` currently lives under `"devDependencies"` because only the build script used it. This new route uses it at request time, so it must be a runtime dependency. Edit `package.json` so it reads:

```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.40.0",
  "gray-matter": "^4.0.3",
  "resend": "^6.18.1"
},
"devDependencies": {
  "marked": "^12.0.2"
}
```

(Exact versions should match what's already in your lockfile — only move the entry between sections, don't change its version.)

- [ ] **Step 2: Reinstall so the lockfile matches**

```bash
npm install
```

- [ ] **Step 3: Write the route**

```js
// api/latest-post.js
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content", "posts");
const SITE = "https://www.apoorvaverma.in";

function readLatestPost() {
  const files = readdirSync(CONTENT).filter((f) => f.endsWith(".md"));
  const posts = files.map((f) => matter(readFileSync(join(CONTENT, f), "utf8")).data);
  posts.sort((a, b) => String(b.published).localeCompare(String(a.published)));
  return posts[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const post = readLatestPost();
  if (!post) {
    res.status(404).json({ error: "No posts found." });
    return;
  }

  res.status(200).json({
    title: post.title,
    excerpt: post.excerpt || "",
    slug: post.slug,
    url: `${SITE}/posts/${post.slug}`,
  });
}
```

- [ ] **Step 4: Verify**

```bash
curl -s http://localhost:3000/api/latest-post
```

Expected: a JSON object whose `slug` matches the `published`-newest file in `content/posts/` (currently `mysql-vector-store-langchain`, published `2026-07-15`, newer than `rag-eval-lying-metrics`'s `2026-07-01`). Confirm `title` and `excerpt` match that file's frontmatter exactly.

- [ ] **Step 5: Commit**

```bash
git add api/latest-post.js package.json package-lock.json
git commit -m "Add latest-post API route for newsletter prefill"
```

---

### Task 6: Send-newsletter endpoint

**Files:**
- Create: `api/send-newsletter.js`
- Modify: `package.json` (move `marked` from `devDependencies` to `dependencies`)

**Interfaces:**
- Consumes: `verifySession(req)` from `./_lib/adminAuth.js` (Task 2).
- Produces: `POST /api/send-newsletter` with body `{ subject: string, markdown: string }`, requires a valid `av_admin` cookie → `200 { ok: true, broadcastId: string }`, `401 { error: string }` if not authenticated, `400 { error: string }` if subject/markdown missing, `502 { error: string }` on Resend failure, `500 { error: string }` if unconfigured.

- [ ] **Step 1: Move `marked` to dependencies**

Edit `package.json` so it reads:

```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.40.0",
  "gray-matter": "^4.0.3",
  "marked": "^12.0.2",
  "resend": "^6.18.1"
}
```

Remove the now-empty `"devDependencies"` key entirely. Then run:

```bash
npm install
```

- [ ] **Step 2: Confirm the installed SDK's broadcasts API shape**

The code below assumes `resend.broadcasts.create({ audienceId, from, subject, html })` → `{ data: { id }, error }`, and `resend.broadcasts.send(id)` → `{ data, error }`. Confirm before writing Step 3:

```bash
grep -A 10 "class Broadcasts" node_modules/resend/dist/index.d.ts
```

Adjust the code below to match if the installed version's method or field names differ.

- [ ] **Step 3: Write the route**

```js
// api/send-newsletter.js
import { Resend } from "resend";
import { marked } from "marked";
import { verifySession } from "./_lib/adminAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!verifySession(req)) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const subject = String(body.subject || "").trim();
  const markdown = String(body.markdown || "").trim();

  if (!subject || !markdown) {
    res.status(400).json({ error: "Subject and body are required." });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    res.status(500).json({ error: "Newsletter sending isn't configured yet." });
    return;
  }

  const html = marked.parse(markdown);
  const resend = new Resend(apiKey);

  const created = await resend.broadcasts.create({
    audienceId,
    from: "Apoorva Verma <hello@apoorvaverma.in>",
    subject,
    html,
  });
  if (created.error) {
    res.status(502).json({ error: "Couldn't create the broadcast. Try again later." });
    return;
  }

  const sent = await resend.broadcasts.send(created.data.id);
  if (sent.error) {
    res.status(502).json({ error: "Broadcast created but failed to send. Check the Resend dashboard." });
    return;
  }

  res.status(200).json({ ok: true, broadcastId: created.data.id });
}
```

Note: `from` uses `hello@apoorvaverma.in` — this must be an address on the domain verified in Task 1, Step 2. Change it to whatever address you actually want broadcasts to come from, as long as it's `@apoorvaverma.in`.

- [ ] **Step 4: Verify the auth check rejects an unauthenticated request**

```bash
curl -s -X POST http://localhost:3000/api/send-newsletter \
  -H "Content-Type: application/json" \
  -d '{"subject":"Test","markdown":"Hello"}'
```

Expected: `{"error":"Not authenticated."}` with status 401.

- [ ] **Step 5: Verify validation, with a valid cookie**

First log in and capture the cookie:

```bash
curl -s -c /tmp/av-cookies.txt -X POST http://localhost:3000/api/admin-login \
  -H "Content-Type: application/json" \
  -d '{"password":"'"$ADMIN_PASSWORD"'"}'
```

Then:

```bash
curl -s -b /tmp/av-cookies.txt -X POST http://localhost:3000/api/send-newsletter \
  -H "Content-Type: application/json" \
  -d '{"subject":"","markdown":""}'
```

Expected: `{"error":"Subject and body are required."}` with status 400.

- [ ] **Step 6: Verify a real send (requires Task 1's real, domain-verified credentials)**

Make sure your Resend Audience (Task 1) contains only a personal test address you control, then:

```bash
curl -s -b /tmp/av-cookies.txt -X POST http://localhost:3000/api/send-newsletter \
  -H "Content-Type: application/json" \
  -d '{"subject":"Newsletter test","markdown":"**Hello** — this is a test.\n\nSee [my site](https://www.apoorvaverma.in)."}'
```

Expected: `{"ok":true,"broadcastId":"..."}`. Check the test inbox: subject "Newsletter test", bold "Hello", a working link, and a working unsubscribe link (Resend injects this automatically into broadcasts).

- [ ] **Step 7: Commit**

```bash
git add api/send-newsletter.js package.json package-lock.json
git commit -m "Add newsletter send endpoint"
```

---

### Task 7: Admin composer page

**Files:**
- Create: `admin/newsletter.html`
- Modify: `robots.txt`

**Interfaces:**
- Consumes: `GET /api/admin-login`, `POST /api/admin-login` (Task 3), `GET /api/latest-post` (Task 5), `POST /api/send-newsletter` (Task 6).

- [ ] **Step 1: Write the page**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Newsletter admin</title>
<meta name="robots" content="noindex, nofollow">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
  :root{--bg:#0d0e11;--surface:#14161a;--text:#e7e8ea;--text-2:#c2c5ca;--text-4:#7c828b;--faint:#61656d;--accent:#ff4b26;--live:#37b46a;--w10:rgba(255,255,255,.13);--w12:rgba(255,255,255,.16)}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:ui-monospace,'IBM Plex Mono',monospace;padding:40px 20px;min-height:100vh}
  .wrap{max-width:720px;margin:0 auto}
  h1{font-size:18px;font-weight:500;margin-bottom:24px}
  label{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-bottom:6px}
  input,textarea{width:100%;background:var(--surface);border:1px solid var(--w12);color:var(--text);font-family:inherit;font-size:14px;padding:10px 12px;border-radius:2px}
  textarea{min-height:220px;resize:vertical;line-height:1.5}
  .field{margin-bottom:16px}
  button{font-family:inherit;font-size:13px;color:#fff;background:var(--accent);border:none;padding:10px 18px;border-radius:2px;cursor:pointer}
  button.secondary{background:transparent;color:var(--text-2);border:1px solid var(--w10)}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
  #login-status{font-size:12.5px;color:var(--accent);margin-top:10px;min-height:1em}
  #status{font-size:12.5px;color:var(--faint);margin-top:10px;min-height:1em}
  #preview{margin-top:10px;padding:16px;background:var(--surface);border:1px solid var(--w10);border-radius:2px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:var(--text-2)}
  #preview a{color:var(--accent)}
  #composer{display:none}
</style>
</head>
<body>
<div class="wrap">
  <h1>Newsletter admin</h1>

  <div id="login">
    <div class="field">
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password">
    </div>
    <button onclick="App.login()">Log in</button>
    <div id="login-status"></div>
  </div>

  <div id="composer">
    <div class="row">
      <button class="secondary" onclick="App.prefill()">Prefill from latest post</button>
    </div>
    <div class="field" style="margin-top:16px">
      <label for="subject">Subject</label>
      <input id="subject" type="text">
    </div>
    <div class="field">
      <label for="markdown">Body (markdown)</label>
      <textarea id="markdown" oninput="App.renderPreview()"></textarea>
    </div>
    <div class="field">
      <label>Preview</label>
      <div id="preview"></div>
    </div>
    <button onclick="App.send()">Send to subscribers</button>
    <div id="status"></div>
  </div>
</div>

<script>
(function(){
  "use strict";

  function el(id){ return document.getElementById(id); }

  function showComposer(){
    el("login").style.display = "none";
    el("composer").style.display = "block";
  }

  function checkSession(){
    fetch("/api/admin-login")
      .then(function(r){ return r.json(); })
      .then(function(d){ if (d.ok) showComposer(); })
      .catch(function(){});
  }

  function login(){
    var password = el("password").value;
    el("login-status").textContent = "";
    fetch("/api/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password })
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
      .then(function(res){
        if (res.ok) showComposer();
        else el("login-status").textContent = (res.d && res.d.error) || "Login failed.";
      })
      .catch(function(){ el("login-status").textContent = "Network error."; });
  }

  function renderPreview(){
    el("preview").innerHTML = window.marked.parse(el("markdown").value || "");
  }

  function prefill(){
    fetch("/api/latest-post")
      .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
      .then(function(res){
        if (!res.ok) return;
        var p = res.d;
        el("subject").value = p.title;
        el("markdown").value = "Just published: **" + p.title + "**\n\n" + p.excerpt + "\n\n[Read the full post](" + p.url + ")";
        renderPreview();
      });
  }

  function send(){
    var subject = el("subject").value.trim();
    var markdown = el("markdown").value.trim();
    var status = el("status");
    if (!subject || !markdown){ status.textContent = "Subject and body are required."; return; }
    status.textContent = "Sending…";
    fetch("/api/send-newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: subject, markdown: markdown })
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
      .then(function(res){
        status.textContent = res.ok ? "Sent." : ((res.d && res.d.error) || "Send failed.");
      })
      .catch(function(){ status.textContent = "Network error."; });
  }

  window.App = { login: login, renderPreview: renderPreview, prefill: prefill, send: send };
  checkSession();
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Disallow the admin path in robots.txt**

Edit `robots.txt` to add a `Disallow` line under the existing `User-agent: *` block:

```
User-agent: *
Allow: /
Disallow: /admin/

# AI crawlers are welcome — being cited by AI search drives brand visibility.
# (No llms.txt here on purpose: Google has stated it's not a ranking signal.)

Sitemap: https://www.apoorvaverma.in/sitemap.xml
```

- [ ] **Step 3: Verify in a browser**

With `vercel dev` still running, open `http://localhost:3000/admin/newsletter`. Confirm:
- The password field shows first.
- Entering the wrong password shows "Incorrect password." and does not reveal the composer.
- Entering the correct `ADMIN_PASSWORD` reveals the composer.
- Reloading the page (with the cookie still set) skips straight to the composer.
- "Prefill from latest post" fills in the subject/body matching Task 5's `/api/latest-post` response.
- Typing in the markdown textarea updates the Preview pane live, rendering `**bold**` and links.
- Clicking "Send to subscribers" shows "Sending…" then "Sent." (or the relevant error) and a real test email arrives, matching Task 6, Step 6.

- [ ] **Step 4: Commit**

```bash
git add admin/newsletter.html robots.txt
git commit -m "Add password-gated newsletter admin composer"
```

---

### Task 8: Public subscribe form on the blog

**Files:**
- Modify: `blog.html`
- Modify: `scripts/build-blog.mjs`

**Interfaces:**
- Consumes: `POST /api/subscribe` (Task 4).

- [ ] **Step 1: Add the subscribe section to `blog.html`**

In `blog.html`, insert this new `<section>` immediately after the closing `</header>` tag (i.e. between the page header and the `<!-- POST LIST -->` section):

```html
    <!-- NEWSLETTER SIGNUP -->
    <section style="padding:0 0 40px">
      <div style="border:1px solid var(--w10);background:var(--surface);padding:24px 22px;display:flex;flex-direction:column;gap:12px">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;color:var(--faint);text-transform:uppercase">Get new notes by email</div>
        <p style="font-size:14px;line-height:1.6;color:var(--text-4);max-width:52ch">One email when I publish. No spam, unsubscribe anytime.</p>
        <form id="subscribe-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <input name="email" type="email" required autocomplete="email" placeholder="you@company.com" style="flex:1;min-width:220px;font-family:'IBM Plex Mono',monospace;font-size:13.5px;color:var(--text);background:var(--bubble);border:1px solid var(--w12);border-radius:0;padding:11px 13px">
          <input name="company" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" placeholder="Company">
          <button type="submit" style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#fff;padding:11px 22px;border:none;border-radius:0;background:var(--accent);cursor:pointer">Subscribe</button>
        </form>
        <span id="subscribe-status" role="status" aria-live="polite" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--faint)"></span>
      </div>
    </section>
```

- [ ] **Step 2: Add the subscribe JS to `blog.html`**

In `blog.html`'s existing `<script>` block (the IIFE near the bottom), add this function alongside the other function declarations (e.g. right after `initCursor`):

```js
  // ---- newsletter subscribe ----
  function initSubscribe(){
    var f = document.getElementById("subscribe-form");
    if (!f) return;
    var status = document.getElementById("subscribe-status");
    f.addEventListener("submit", function(e){
      e.preventDefault();
      var btn = f.querySelector('button[type="submit"]');
      var email = f.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ status.style.color = "var(--accent)"; status.textContent = "Enter a valid email address."; return; }
      var label = btn.textContent; btn.disabled = true; btn.textContent = "Subscribing…"; status.style.color = "var(--faint)"; status.textContent = "";
      fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email, company: f.company.value }) })
        .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
        .then(function(res){
          if (res.ok){ f.reset(); status.style.color = "var(--live)"; status.textContent = "Subscribed! Watch your inbox."; }
          else { status.style.color = "var(--accent)"; status.textContent = (res.j && res.j.error) || "Something went wrong. Try again."; }
        })
        .catch(function(){ status.style.color = "var(--accent)"; status.textContent = "Network error. Try again."; })
        .then(function(){ btn.disabled = false; btn.textContent = label; });
    });
  }
```

Then call it inside the existing `boot()` function, alongside the other `init*()` calls:

```js
  function boot(){
    var stored = "light";
    try { stored = localStorage.getItem("av-theme") || "light"; } catch(e){}
    applyTheme(stored);
    bindHovers(document);
    initCursor();
    initSubscribe();
    startMotion();
  }
```

- [ ] **Step 3: Add the same block to `scripts/build-blog.mjs`'s post template**

In `scripts/build-blog.mjs`, add a new constant near `NAV` and `PAGE_SCRIPT` (e.g. right after the `NAV` constant's closing backtick):

```js
const SUBSCRIBE_BLOCK = `<section style="padding:0 0 8px">
    <div style="border:1px solid var(--w10);background:var(--surface);padding:24px 22px;display:flex;flex-direction:column;gap:12px">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;color:var(--faint);text-transform:uppercase">Get new notes by email</div>
      <p style="font-size:14px;line-height:1.6;color:var(--text-4);max-width:52ch">One email when I publish. No spam, unsubscribe anytime.</p>
      <form id="subscribe-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <input name="email" type="email" required autocomplete="email" placeholder="you@company.com" style="flex:1;min-width:220px;font-family:'IBM Plex Mono',monospace;font-size:13.5px;color:var(--text);background:var(--bubble);border:1px solid var(--w12);border-radius:0;padding:11px 13px">
        <input name="company" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" placeholder="Company">
        <button type="submit" style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#fff;padding:11px 22px;border:none;border-radius:0;background:var(--accent);cursor:pointer">Subscribe</button>
      </form>
      <span id="subscribe-status" role="status" aria-live="polite" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--faint)"></span>
    </div>
  </section>`;
```

In the same file, inside `pageHtml(post)`'s returned template string, insert `${SUBSCRIBE_BLOCK}` right after the author-bio `<div>` (the one containing "GitHub"/"LinkedIn" links) and before the final "Back to writing" `<div>`:

```js
    <div style="margin-top:48px;padding-top:26px;border-top:1px solid var(--w08);display:flex;align-items:center;gap:14px">...</div>

${SUBSCRIBE_BLOCK}

    <div style="margin-top:40px"><a href="/blog" ...>← Back to writing</a></div>
```

(Keep the existing author-bio and "Back to writing" markup exactly as-is — only insert `${SUBSCRIBE_BLOCK}` between them.)

In `PAGE_SCRIPT`'s IIFE, add the identical `initSubscribe` function from Step 2, and call it inside its `boot()`:

```js
  function boot(){
    var stored = "light";
    try { stored = localStorage.getItem("av-theme") || "light"; } catch(e){}
    applyTheme(stored);
    bindHovers(document);
    initCursor();
    initSubscribe();
  }
```

- [ ] **Step 4: Rebuild the post pages**

```bash
npm run build:blog
```

Expected output: `posts/mysql-vector-store-langchain.html`, `posts/rag-eval-lying-metrics.html`, `Built 2 post(s), blog index, sitemap.` — and no errors.

- [ ] **Step 5: Verify in a browser**

With `vercel dev` running, open `http://localhost:3000/blog` and confirm the subscribe box renders below the header, above "The log". Open `http://localhost:3000/posts/mysql-vector-store-langchain` and confirm the same box renders near the bottom, after the author bio and before "Back to writing". On either page, submit a real test email and confirm success against `/api/subscribe` (same verification as Task 4, Step 8).

- [ ] **Step 6: Commit**

```bash
git add blog.html scripts/build-blog.mjs posts/
git commit -m "Add newsletter subscribe form to blog index and post pages"
```
