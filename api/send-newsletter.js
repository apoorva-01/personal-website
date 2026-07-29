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
