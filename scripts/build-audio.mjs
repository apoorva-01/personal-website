// Generates natural-voice narration for each post with Kokoro (local, offline,
// free) and bakes it into the post HTML so "Listen to this post" plays a real
// voice instead of the browser's robotic one.
//
//   npm run build:blog   # first — regenerates posts/*.html from markdown
//   npm run build:audio  # then — adds posts/<slug>.mp3 + highlight timings
//
// For each post it: collects the readable blocks (title, dek, paragraphs,
// headings, list items) in reading order, tags each with data-ts="i", speaks
// them via scripts/tts/gen.py, writes posts/<slug>.mp3, and injects a
// <script id="tts-data"> with the per-block start times. The client reads that
// and highlights the block being read. Posts without generated audio fall back
// to Web Speech, so this step is optional and safe to skip for a new post.
//
// Idempotent: a content hash is stored with the audio; unchanged posts are
// skipped. Kept out of build-blog.mjs on purpose — that script runs in CI and
// must not depend on Python/Kokoro/ffmpeg.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parse } from "node-html-parser";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const POSTS = join(ROOT, "posts");
const PY = join(ROOT, "scripts", "tts", "venv", "bin", "python");
const GEN = join(ROOT, "scripts", "tts", "gen.py");
const VOICE = "af_heart"; // Kokoro voice. Swap for af_bella / am_michael / am_fenrir to taste.

const decodeEntities = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");

const clean = (s) => decodeEntities(String(s).replace(/\s+/g, " ")).trim();

// Text of a node for narration, skipping the heading "#" anchor link so it
// isn't read aloud. Inline children (links, code, bold) are kept.
function readText(node) {
  let out = "";
  for (const c of node.childNodes) {
    if (c.nodeType === 1 && c.classList && c.classList.contains("anchor-link")) continue;
    out += c.text;
  }
  return clean(out);
}

function ancestorMatches(node, test) {
  let p = node.parentNode;
  while (p) {
    if (test(p)) return true;
    p = p.parentNode;
  }
  return false;
}

// The readable blocks of the article body, in document (reading) order, with a
// data-ts index stamped on each. Returns { html, texts }.
function tagArticle(innerHtml, startIndex) {
  const root = parse(innerHtml);
  const texts = [];
  let i = startIndex;
  for (const el of root.querySelectorAll("p, li, h2, h3, blockquote")) {
    const tag = el.rawTagName.toLowerCase();
    const skip =
      ancestorMatches(el, (p) => (p.classList && p.classList.contains("code-block")) || p.rawTagName === "figure") ||
      (tag === "p" && ancestorMatches(el, (p) => p.rawTagName === "blockquote"));
    if (skip) continue;
    const text = readText(el);
    if (!text) continue;
    el.setAttribute("data-ts", String(i++));
    texts.push(text);
  }
  return { html: root.toString(), texts };
}

function processPost(file) {
  const slug = file.replace(/\.html$/, "");
  const path = join(POSTS, file);
  let html = readFileSync(path, "utf8");

  // Title (always present) and dek (optional) are the first blocks read.
  const titleMatch = html.match(/<h1 style="margin-top:14px;[^"]*">([\s\S]*?)<\/h1>/);
  if (!titleMatch) return { slug, status: "no-title" };
  const texts = [clean(titleMatch[1].replace(/<[^>]+>/g, ""))];
  let next = 1;

  const dekMatch = html.match(/<p class="dek">([\s\S]*?)<\/p>/);
  const hasDek = !!dekMatch;
  if (hasDek) { texts.push(clean(dekMatch[1].replace(/<[^>]+>/g, ""))); next = 2; }

  const artMatch = html.match(/(<div class="article"[^>]*>)([\s\S]*)(<\/div>\s*<\/article>)/);
  if (!artMatch) return { slug, status: "no-article" };
  const { html: taggedInner, texts: bodyTexts } = tagArticle(artMatch[2], next);
  texts.push(...bodyTexts);

  const hash = createHash("sha1").update(VOICE + "\n" + texts.join("\n")).digest("hex").slice(0, 12);

  // Skip if this exact content was already generated and the mp3 is present.
  const existing = html.match(/<script id="tts-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (existing && existsSync(join(POSTS, `${slug}.mp3`))) {
    try { if (JSON.parse(existing[1]).h === hash) return { slug, status: "unchanged", n: texts.length }; } catch {}
  }

  // Synthesize. gen.py writes timings to a meta file (not stdout, which Kokoro
  // pollutes with progress warnings).
  const blocksFile = join(POSTS, `.${slug}.blocks.json`);
  const metaFile = join(POSTS, `.${slug}.meta.json`);
  writeFileSync(blocksFile, JSON.stringify(texts));
  execFileSync(PY, [GEN, "--in", blocksFile, "--out", join(POSTS, `${slug}.mp3`), "--meta", metaFile, "--voice", VOICE], {
    stdio: ["ignore", "inherit", "inherit"], maxBuffer: 64 * 1024 * 1024,
  });
  const { timings } = JSON.parse(readFileSync(metaFile, "utf8"));
  execFileSync("rm", ["-f", blocksFile, metaFile]);
  if (timings.length !== texts.length) throw new Error(`${slug}: ${timings.length} timings for ${texts.length} blocks`);

  // Bake: data-ts attributes + the timings blob into the shipped HTML.
  html = html.replace('<h1 style="margin-top:14px;', '<h1 data-ts="0" style="margin-top:14px;');
  if (hasDek) html = html.replace('<p class="dek">', '<p class="dek" data-ts="1">');
  html = html.replace(artMatch[0], artMatch[1] + taggedInner + artMatch[3]);
  const blob = JSON.stringify({ src: `/posts/${slug}.mp3`, h: hash, timings });
  html = html.replace("</article>", `<script id="tts-data" type="application/json">${blob}</script>\n    </article>`);

  writeFileSync(path, html);
  return { slug, status: "generated", n: texts.length };
}

function main() {
  const only = process.argv[2]; // optional slug filter, e.g. `node build-audio.mjs rag-eval-lying-metrics`
  let files = readdirSync(POSTS).filter((f) => f.endsWith(".html") && f !== "index.html");
  if (only) files = files.filter((f) => f === `${only}.html`);
  for (const f of files) {
    const r = processPost(f);
    console.log(`  ${r.slug}: ${r.status}${r.n ? ` (${r.n} blocks)` : ""}`);
  }
  console.log(`Audio pass done for ${files.length} post(s).`);
}

main();
