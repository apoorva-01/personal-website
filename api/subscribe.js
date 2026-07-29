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
