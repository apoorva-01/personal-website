// Receives the contact form and relays it to Slack.
// The webhook URL lives in the SLACK_WEBHOOK_URL env var — never in the client,
// because Slack blocks browser (CORS) calls and a public webhook would get spammed.

function slackEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const email = String(body.email || "").trim();
  const message = String(body.message || "").trim();
  const honeypot = String(body.company || "").trim();

  // Bots fill the hidden field; pretend success and drop it.
  if (honeypot) {
    res.status(200).json({ ok: true });
    return;
  }

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!emailOk || message.length < 2 || message.length > 4000) {
    res.status(400).json({ error: "Enter a valid email and a message." });
    return;
  }

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    res.status(500).json({ error: "Contact isn't configured yet." });
    return;
  }

  const text =
    `:incoming_envelope: *New message via apoorvaverma.in*\n` +
    `*From:* ${slackEscape(email)}\n\n${slackEscape(message)}`;

  try {
    const slack = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false }),
    });
    if (!slack.ok) {
      res.status(502).json({ error: "Couldn't deliver the message. Try again later." });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: "Couldn't deliver the message. Try again later." });
  }
}
