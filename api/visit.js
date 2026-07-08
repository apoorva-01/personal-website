// Pings Slack when a real person lands on the site.
//
// Honest scope: a browser CANNOT hand a website a visitor's email or LinkedIn
// identity — no API exposes that, by design. What IS available, and what this
// sends, is the useful anonymous signal: the referrer (often literally
// linkedin.com when someone clicks through from there), the approximate location
// (from Vercel's edge geo headers — city-level, no lookup service), and the
// device. Nothing is stored; it's a transient notification. The webhook URL
// stays server-side in SLACK_WEBHOOK_URL (same one the contact form uses).

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sourceLabel(ref) {
  if (!ref) return "direct / unknown";
  if (/linkedin/i.test(ref)) return ":briefcase: *LinkedIn*";
  if (/google\./i.test(ref)) return "Google";
  if (/twitter|x\.com|t\.co/i.test(ref)) return "X / Twitter";
  if (/github/i.test(ref)) return "GitHub";
  if (/news\.ycombinator|reddit/i.test(ref)) return "HN / Reddit";
  try {
    return esc(new URL(ref).hostname.replace(/^www\./, ""));
  } catch {
    return esc(ref.slice(0, 80));
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    res.status(200).json({ ok: true }); // fail quietly if not configured
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const h = req.headers;
  const ua = String(h["user-agent"] || "");

  // Only ping for real humans — drop crawlers, previews, and headless browsers.
  if (/bot|crawl|spider|slurp|bing|preview|monitor|headless|lighthouse|curl|wget/i.test(ua)) {
    res.status(200).json({ ok: true });
    return;
  }

  const city = h["x-vercel-ip-city"] ? decodeURIComponent(h["x-vercel-ip-city"]) : "";
  const region = h["x-vercel-ip-country-region"] || "";
  const country = h["x-vercel-ip-country"] || "";
  const location = [city, region, country].filter(Boolean).join(", ") || "unknown";

  const device = (ua.match(/\(([^)]+)\)/) || [])[1] || ua.slice(0, 80);
  const ts = Math.floor(Date.now() / 1000);

  const text =
    `:eyes: *Someone is on apoorvaverma.in*\n` +
    `*Page:* ${esc(body.page || "/")}\n` +
    `*Came from:* ${sourceLabel(String(body.referrer || ""))}\n` +
    `*Location:* ${esc(location)}\n` +
    `*Device:* ${esc(device)}\n` +
    `*When:* <!date^${ts}^{time} · {date_short}|now>`;

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false }),
    });
  } catch {
    // A dropped notification shouldn't ever surface to the visitor.
  }
  res.status(200).json({ ok: true });
}
