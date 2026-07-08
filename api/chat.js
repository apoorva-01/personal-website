import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// Everything the assistant is allowed to know. Answers are grounded ONLY in this.
const KNOWLEDGE = `
# Apoorva Verma — Software Engineer (Oracle) · Applied AI

## Summary
Apoorva is a software engineer at Oracle who builds full-stack products end to end and goes
deep on applied AI: retrieval-augmented generation (RAG) and the evaluation infrastructure
that keeps LLM systems correct in production. Works across the stack in Python and TypeScript,
backend to frontend. Open to software and AI engineering roles and collaborations.

## Skills & stack
- Languages: Python, TypeScript, JavaScript, SQL.
- Web / full-stack: Next.js, React, Node, FastAPI, Flask, REST APIs, Postgres, MySQL, MongoDB.
- Applied AI / LLM: RAG (LangChain, vector stores such as Qdrant, pgvector, and MySQL's native
  VECTOR type), LLM evaluation (DeepEval, RAGAS, custom metrics), LLM-as-judge calibration,
  semantic caching, prompt regression testing.
- Tooling / infra: Docker, Vercel, CI, Git.

## Featured projects (all on GitHub — github.com/apoorva-01)
1. rag-eval-harness — RAG over 15 arXiv papers with exact page and section citations. The real
   project is the evaluation harness: a reproducible comparison of retrieval strategies and
   chunk x embedding configs, scored with DeepEval plus a custom, gold-independent
   citation-faithfulness metric. Results over 50 questions: retrieval NDCG@5 climbs 0.33 to 0.62
   (+86%) across naive dense, BM25 hybrid, then cross-encoder rerank; on the generation matrix,
   citation precision is 1.0 across every config and context precision tops out at 0.85 with
   semantic chunking + e5-large. Headline lesson: the bottleneck is retrieval, not the generator.
   Stack: Python, DeepEval.
2. FounderSignal — a full-stack market-intelligence platform that mines and validates early
   startup signals: data pipelines, scoring, and a dashboard. Stack: Next.js, TypeScript, Postgres.
3. promptguard — regression testing for LLM apps, "pytest for prompts." Write checks against
   prompt outputs so quality regressions fail in CI instead of reaching users. Stack: Python, pytest.
Other work includes judgelab (LLM-as-judge calibration that quantifies position bias and
verbosity), semcache (semantic caching for LLM APIs), langchain-shannonbase (a LangChain
VectorStore for MySQL 9's native VECTOR type), and a range of full-stack web apps: Next.js
platforms, an e-commerce CMS, Flask apps, and Chrome extensions.

## Evaluation methodology (a differentiator)
In rag-eval-harness Apoorva built a custom citation-faithfulness metric (framed in
attribution-eval / ALCE terms) that is gold-independent: it audits an answer against its own
cited sources rather than a synthetic gold set. Findings: citation precision is 1.0 across
every config and citation recall around 0.98 to 1.0, so a well-prompted generator essentially
never miscites; configs only separate on context precision (0.75 to 0.85), where semantic
chunking + e5-large wins at roughly 3x the embedding cost. Takeaway: spend optimization budget
on retrieval quality before reaching for a bigger model.

## Experience
- Software Engineer · Oracle (2023–present): backend services and applied-AI work, including RAG
  and LLM evaluation for enterprise search.
- SWE Intern · Microsoft Engage (2022): built an ML-driven recommendation feature end-to-end.
- SWE Intern · J.P. Morgan (2021): data tooling for an internal risk-analytics platform.
- Fellow · Major League Hacking (MLH) (2021): open-source fellowship; shipped to a production codebase.

## Writing (themes Apoorva has written about)
- "I graded 50 RAG answers with a hand-built harness. Half the metrics were lying to me":
  faithfulness saturated at 1.0 across every config and told him nothing, so he leads with the
  gold-independent citation metric instead.
- Broader themes: production reliability and evaluation for LLM and agent systems, retrieval
  quality over model size, and treating evaluation as a first-class engineering problem.
`.trim();

const SYSTEM = `You are the portfolio assistant for Apoorva Verma's website. Speak in the
first person as Apoorva ("I build...", "At Oracle I...").

Apoorva is a software engineer who also works in applied AI: full-stack product work plus RAG
and LLM evaluation. Answer ONLY using the facts in the KNOWLEDGE section below. If the answer
is not in there, say so plainly (e.g. "That isn't something my site covers, but I'm happy to
talk about my software engineering, my RAG and evaluation work, projects, or experience") and
do not invent details, numbers, employers, or links.

Formatting rules:
- Keep it tight and conversational. Usually 2 to 4 short sentences.
- When you mention several things (like multiple projects), give each its own short paragraph,
  separated by a BLANK LINE. Never cram them into one long paragraph.
- You may bold a name with **double asterisks**, sparingly. No headers, bullets, or numbered lists.
- Never use em dashes; use a comma, colon, or a new sentence instead.

KNOWLEDGE:
${KNOWLEDGE}`;

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Turn the assistant's Markdown into Slack mrkdwn: escape &<> first (Slack's three
// reserved chars), then convert [text](url) links and **bold** (the model writes
// **double asterisks**, but Slack bold is *single asterisks*, so raw ** shows literally).
function slackText(s) {
  let out = esc(s);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "<$2|$1>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  return out;
}

async function slackPost(token, payload) {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(payload),
  });
  return r.json().catch(() => ({}));
}

// Log a real Q&A to Slack. With a bot token it posts the question to the channel
// and the answer as a threaded reply (channel stays one line per question). Without
// one it falls back to a single formatted webhook message (webhooks can't thread).
// Never throws, never blocks the answer the visitor already received.
async function notifyQA(req, question, answer) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!(token && channel) && !webhook) return;

  const h = req.headers || {};
  const ua = String(h["user-agent"] || "");
  if (/bot|crawl|spider|slurp|bing|preview|monitor|headless|lighthouse|curl|wget/i.test(ua)) return;

  const city = h["x-vercel-ip-city"] ? decodeURIComponent(h["x-vercel-ip-city"]) : "";
  const region = h["x-vercel-ip-country-region"] || "";
  const country = h["x-vercel-ip-country"] || "";
  const location = [city, region, country].filter(Boolean).join(", ") || "unknown";
  const ts = Math.floor(Date.now() / 1000);

  const q = slackText(question);
  let a = slackText(answer).trim();
  if (a.length > 3500) a = a.slice(0, 3500) + "…";
  const meta = `:round_pushpin: ${esc(location)}   ·   <!date^${ts}^{time} · {date_short}|now>`;

  try {
    if (token && channel) {
      const head = await slackPost(token, {
        channel,
        text: `New question in the chat: ${q}`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `:speech_balloon: *New question in the chat*\n>${q}` } },
          { type: "context", elements: [{ type: "mrkdwn", text: meta }] },
        ],
      });
      if (head && head.ok && head.ts) {
        await slackPost(token, { channel, thread_ts: head.ts, text: a || "_(no answer)_" });
      }
      return;
    }

    // Webhook fallback: one message, since incoming webhooks can't post to a thread.
    const text = `:speech_balloon: *New question in the chat*\n>${q}\n\n${a}\n\n${meta}`;
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false }),
    });
  } catch (e) {
    // A dropped notification must never surface to the visitor.
  }
}

// --- Abuse guard --------------------------------------------------------------
// Vercel functions are stateless, but a warm instance keeps module scope between
// invocations, which is enough to blunt a single source hammering the endpoint.
// This is best-effort; the real hard ceiling is an Anthropic spend limit.
const PER_IP_WINDOW_MS = 60_000;   // 1 minute
const PER_IP_PER_MIN = 6;          // questions per IP per minute
const PER_IP_PER_DAY = 40;         // questions per IP per day
const DAY_MS = 86_400_000;
const INSTANCE_HOURLY_CAP = 400;   // total questions per warm instance per hour

const ipHits = new Map();          // ip -> [timestamps]
let instanceHits = [];             // timestamps across all IPs

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "");
  return fwd.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

// Returns null if allowed, or a human message if blocked.
function abuseBlock(req) {
  const now = Date.now();

  instanceHits = instanceHits.filter((t) => now - t < 3_600_000);
  if (instanceHits.length >= INSTANCE_HOURLY_CAP) {
    return "This chat is busy right now. Please try again later.";
  }

  const ip = clientIp(req);
  const recent = (ipHits.get(ip) || []).filter((t) => now - t < DAY_MS);
  const lastMinute = recent.filter((t) => now - t < PER_IP_WINDOW_MS).length;

  if (recent.length >= PER_IP_PER_DAY) {
    ipHits.set(ip, recent);
    return "You've reached today's question limit. Try again tomorrow.";
  }
  if (lastMinute >= PER_IP_PER_MIN) {
    ipHits.set(ip, recent);
    return "Slow down a moment — too many questions at once.";
  }

  recent.push(now);
  ipHits.set(ip, recent);
  instanceHits.push(now);

  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) {
      if (!v.some((t) => now - t < DAY_MS)) ipHits.delete(k);
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let question = "";
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    question = String(body.question || "").slice(0, 600).trim();
  } catch (e) {
    question = "";
  }
  if (!question) {
    res.status(400).json({ error: "Missing question" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const blocked = abuseBlock(req);
  if (blocked) {
    sse(res, { error: blocked });
    res.end();
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    sse(res, { error: "Chat isn't configured yet — the API key is missing." });
    res.end();
    return;
  }

  let answer = "";
  try {
    const stream = client.messages.stream({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: "user", content: question }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        answer += event.delta.text;
        sse(res, { text: event.delta.text });
      }
    }
    sse(res, { done: true });
  } catch (err) {
    const msg = err && err.status === 401
      ? "Chat isn't configured yet — the API key is invalid."
      : "Sorry, I hit an error answering that. Please try again.";
    sse(res, { error: msg });
  }

  // Log the real Q&A to Slack after the visitor has the full answer. Awaited so
  // the serverless function doesn't freeze the request before the ping goes out.
  if (answer.trim()) await notifyQA(req, question, answer);

  res.end();
}
