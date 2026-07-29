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
