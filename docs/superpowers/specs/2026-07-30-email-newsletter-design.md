# Email newsletter — design

## Purpose

Let visitors subscribe to an email newsletter from the blog, and let Apoorva send
issues two ways: notifying subscribers when a new post goes live, and sending
one-off manual issues not tied to a post. Both flows are triggered from one
password-protected admin page on the site.

## Provider

**Resend**, chosen over Buttondown/ConvertKit/Mailchimp because:

- Free tier (3,000 emails/mo, unlimited contacts on one audience) comfortably
  covers this site's scale.
- Code-first API fits the existing markdown → build script → static site
  pipeline (`scripts/build-blog.mjs`), unlike Buttondown/ConvertKit which
  expect you to compose in their own dashboard.
- Its hosted **Audience** feature replaces the need for a database, and its
  **Broadcasts** API handles unsubscribe links and delivery for us.

## Architecture

Three new pieces, no database:

1. **Public subscribe form** — embedded in `blog.html` and at the bottom of
   each generated post page (via `scripts/build-blog.mjs`'s post template).
   Posts to `api/subscribe.js`.
2. **Admin composer page** — `admin/newsletter.html`. Not linked from nav,
   excluded from `sitemap.xml` and disallowed in `robots.txt`. Password-gated.
   Used for both manual issues and post-notification emails — there is only
   one send flow.
3. **Two protected API routes**:
   - `api/admin-login.js` — checks a password against `ADMIN_PASSWORD`, issues
     a signed cookie on success.
   - `api/send-newsletter.js` — checks the cookie, converts submitted markdown
     to HTML, and sends via Resend's Broadcasts API.
   - `api/latest-post.js` — reads `content/posts/*.md` to prefill the composer
     with the newest post's title/excerpt/link (read-only convenience, no
     auth required since it exposes only already-public post data).

## Data flow

### Subscribing

1. Visitor submits email on `blog.html` or a post page.
2. Client POSTs `{ email, company }` (honeypot) to `api/subscribe.js`.
3. `api/subscribe.js`:
   - Rejects if the honeypot field is filled (pretend success, per the
     existing pattern in `api/contact.js`).
   - Validates email format; 400 on failure.
   - Calls Resend's `contacts.create` against `RESEND_AUDIENCE_ID`.
   - On Resend "already exists" response, treat as success (idempotent
     resubscribe, not an error).
   - Returns `{ ok: true }` or `{ error: "..." }`.
4. No confirmation email — the contact is added immediately (instant
   opt-in, matching the decision to skip double opt-in at this scale).

### Sending an issue (manual or post-notification)

1. Apoorva navigates to `/admin/newsletter.html` directly (unguessable-ish,
   but not the actual security boundary — see Security).
2. If no valid admin cookie is present, the page shows a password field.
   Submitting posts to `api/admin-login.js`; on success it sets a signed,
   HttpOnly, `Secure`, `SameSite=Strict` cookie (`av_admin`, ~7 day expiry)
   and reveals the composer.
3. Composer UI: subject field, markdown textarea, live preview pane
   (rendered client-side with the same conversion approach used for the
   existing chat markdown-to-HTML helper), and a "Prefill from latest post"
   button.
4. "Prefill from latest post" calls `GET api/latest-post.js`, which reads
   `content/posts/*.md` the same way `build-blog.mjs` does (parses
   frontmatter with `gray-matter`, sorts by `published`), and returns the
   newest post's `title`, `excerpt`, `slug`, and its public URL
   (`https://www.apoorvaverma.in/posts/<slug>`). The composer fills
   subject = post title, body = a short templated blurb using the excerpt +
   link (editable before sending).
5. Hitting "Send" POSTs `{ subject, markdown }` to `api/send-newsletter.js`.
6. `api/send-newsletter.js`:
   - Verifies the `av_admin` cookie's HMAC signature and expiry; 401 if
     invalid/missing.
   - Validates `subject` and `markdown` are non-empty; 400 if not.
   - Converts `markdown` to HTML using `marked` (already a devDependency;
     promote to a runtime dependency since this API route needs it at
     request time, not just at build time).
   - Calls Resend to create and send a Broadcast to `RESEND_AUDIENCE_ID`
     with the rendered HTML.
   - Returns `{ ok: true, broadcastId }` or `{ error: "..." }`.
7. Composer shows the result inline (success or error message), matching the
   existing contact-form status-message pattern.

## Security

- **The API route is the gate, not the page.** `admin/newsletter.html` is
  reachable by URL to anyone, but it cannot send anything without a valid
  signed cookie, and the cookie can only be obtained by knowing
  `ADMIN_PASSWORD`.
- Cookie format: `<expiryTimestamp>.<hmacSignature>`, signed with `ADMIN_SECRET`
  using HMAC-SHA256. Verified statelessly on every request to
  `send-newsletter.js` — no session store, consistent with the rest of this
  serverless, database-free site.
- `ADMIN_PASSWORD`, `ADMIN_SECRET`, `RESEND_API_KEY`, and `RESEND_AUDIENCE_ID`
  are Vercel environment variables, never present in client-side code.
- `admin/newsletter.html` is added to `robots.txt` as `Disallow:` and left out
  of `sitemap.xml`, so it isn't indexed or discoverable via the site's own
  metadata (defense in depth, not the actual security boundary).
- The subscribe endpoint reuses `contact.js`'s honeypot pattern against basic
  bots; Resend's own list handles spam/bounce management beyond that.

## Error handling

- `api/subscribe.js`: invalid email → 400 with a user-facing message; Resend
  API failure → 502 with a generic retry message (mirrors `contact.js`).
- `api/admin-login.js`: wrong password → 401, generic "Incorrect password"
  message (no distinction from "no password configured" to avoid leaking
  config state).
- `api/send-newsletter.js`: missing/invalid cookie → 401, redirect the
  composer back to the password prompt; empty subject/body → 400; Resend send
  failure → 502, composer shows the error and leaves the draft intact so
  nothing is lost.
- `api/latest-post.js`: no posts found → 404, composer disables the prefill
  button and shows nothing (not a hard failure, since manual issues don't
  need it).

## Testing / verification

Since this is a static-site-plus-serverless-functions project with no
existing test suite, verification is manual:

- Subscribe form: submit a real test email, confirm it appears in the Resend
  Audience dashboard; submit the honeypot-filled payload via curl and confirm
  no contact is created; submit a malformed email and confirm the 400 message
  renders in the UI.
- Admin login: wrong password → error shown, no cookie set; correct password
  → cookie set, composer appears; cookie expiry (can shorten temporarily to
  test) → falls back to password prompt.
- Send flow: send a manual test issue to a Resend audience containing only a
  personal test address; verify formatting (bold, links, paragraphs) renders
  correctly in an actual inbox; verify the unsubscribe link Resend injects
  works.
- Prefill: confirm it pulls the actual latest post's title/excerpt/link
  correctly after a new post is added to `content/posts/`.

## Scope — explicitly out

- No custom database — Resend's Audience is the only subscriber store.
- No double opt-in / confirmation emails.
- No scheduled or future-dated sends.
- No in-site subscriber list/management UI (use the Resend dashboard for
  that).
- No automatic send-on-publish — publishing a post never emails anyone by
  itself; the admin page's "Prefill from latest post" + manual Send is always
  the trigger.

## New environment variables

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API access |
| `RESEND_AUDIENCE_ID` | Target audience for subscribes and broadcasts |
| `ADMIN_PASSWORD` | Gate for `admin/newsletter.html` |
| `ADMIN_SECRET` | HMAC key for signing the admin session cookie |

## New/changed files

- `api/subscribe.js` (new)
- `api/admin-login.js` (new)
- `api/send-newsletter.js` (new)
- `api/latest-post.js` (new)
- `admin/newsletter.html` (new)
- `blog.html` (add subscribe form)
- `scripts/build-blog.mjs` (add subscribe form to the per-post template)
- `robots.txt` (disallow `/admin/`)
- `package.json` (move `marked` from devDependencies to dependencies)
