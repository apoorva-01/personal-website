// Nudges Google to (re)crawl every URL in sitemap.xml via the Indexing API.
// Auth uses a Google Cloud service account (added as an owner of the GSC property).
// Run in CI after deploy, or locally:
//   GOOGLE_APPLICATION_CREDENTIALS=./service_account.json node scripts/gsc-index.mjs
//
// NOTE: Google's Indexing API is officially for JobPosting/BroadcastEvent pages.
// For regular pages it's an unofficial nudge — sitemap.xml (submitted in GSC) is the
// authoritative path; this just speeds first crawl. Daily quota is ~200 URLs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { google } from "googleapis";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(ROOT, "service_account.json");
const SITEMAP = join(ROOT, "sitemap.xml");

function urlsFromSitemap() {
  const xml = readFileSync(SITEMAP, "utf8");
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function main() {
  const urls = urlsFromSitemap();
  if (urls.length === 0) {
    console.error("No <loc> URLs in sitemap.xml");
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY,
    scopes: ["https://www.googleapis.com/auth/indexing"],
  });
  const indexing = google.indexing({ version: "v3", auth });

  let ok = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      await indexing.urlNotifications.publish({ requestBody: { url, type: "URL_UPDATED" } });
      console.log(`  submitted  ${url}`);
      ok++;
    } catch (e) {
      const msg = e?.errors?.[0]?.message || e?.message || String(e);
      console.error(`  FAILED     ${url} — ${msg}`);
      failed++;
    }
  }
  console.log(`Indexing API: ${ok} submitted, ${failed} failed, of ${urls.length} URLs.`);
  // Don't fail the pipeline on per-URL errors (quota/unsupported) — indexing is a nudge.
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
