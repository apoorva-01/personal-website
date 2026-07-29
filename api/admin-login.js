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
