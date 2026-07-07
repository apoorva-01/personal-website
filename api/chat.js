import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// Everything the assistant is allowed to know. Answers are grounded ONLY in this.
const KNOWLEDGE = `
# Apoorva Verma — AI Engineer (RAG & LLM Evaluation)

## Summary
Apoorva is an AI engineer focused on the half of LLM work most people skip: making sure
systems are actually correct. Specialty is retrieval-augmented generation (RAG) and the
evaluation infrastructure that keeps it honest in production. Currently open to AI/ML
engineering roles and collaborations.

## Skills & stack
- Languages/frameworks: Python, PyTorch.
- RAG toolchain: LangChain, LangGraph, vector stores (Qdrant, pgvector).
- LLM evaluation: RAGAS and DeepEval for faithfulness, answer relevance, and retrieval
  precision; calibrated LLM-as-judge pipelines wired into CI so quality regressions never ship.
- Serving/infra: FastAPI, Weights & Biases (W&B).

## Featured projects
1. RAG + Evaluation System — production RAG pipeline with semantic chunking, hybrid
   retrieval, and an automated RAGAS eval gate that blocks regressions in CI.
   Result: +38% faithfulness over the naive baseline. Stack: Python, LangChain, RAGAS, Qdrant.
2. LLM Eval Benchmark — an open benchmark harness comparing 8 LLMs across faithfulness,
   toxicity, and instruction-following, with LLM-as-judge calibration. Covers 2.4k test cases.
   Stack: PyTorch, DeepEval, W&B.
3. AI Agent — failure recovery — a tool-using agent with self-critique loops and graceful
   degradation: it detects failed tool calls and re-plans instead of hallucinating.
   Result: 91% recovery rate. Stack: LangGraph, OpenAI, FastAPI.

## Evaluation methodology (the differentiator)
Apoorva ran a retrieval ablation across chunking strategies and embedding models, scored with
RAGAS (faithfulness / answer relevance / retrieval precision):
- Fixed-512 + ada-002:        0.81 / 0.79 / 0.74
- Recursive + bge-large:      0.88 / 0.86 / 0.83
- Semantic + text-embedding-3-large (the winner):  0.94 / 0.92 / 0.90
- Sentence-window + text-embedding-3-large:        0.90 / 0.89 / 0.85
Takeaway: semantic chunking won decisively; spend optimization budget on retrieval quality
before reaching for a bigger model.

## Experience timeline
- AI/ML Engineer · Oracle (2023–present): RAG systems & LLM evaluation infrastructure for
  enterprise search.
- SWE Intern · Microsoft Engage (2022): built an ML-driven recommendation feature end-to-end.
- SWE Intern · J.P. Morgan (2021): data tooling for an internal risk-analytics platform.
- Fellow · Major League Hacking (MLH) (2021): open-source fellowship; shipped to a production codebase.

## Writing (themes Apoorva has written about)
- "Why your RAG demo lies to you": fluency is cheap; faithfulness (is every claim entailed by
  retrieved context?) is the metric that catches hallucinations. Treat anything under 0.9 as a defect.
- "Semantic chunking won my ablation": splitting on meaning keeps a complete idea in one
  retrievable unit, so the model never stitches a claim across a boundary it can't see.
- "Calibrating LLM-as-judge": calibrate a judge against a human-labeled gold set (Cohen's kappa);
  below 0.7 the score is theater. Force a rubric, randomize answer order to kill position bias.
- "Agents that recover instead of hallucinate": make tool failure a first-class signal —
  validate every tool result against a schema; a bad result triggers a re-plan, not a fabrication.
`.trim();

const SYSTEM = `You are the portfolio assistant for Apoorva Verma's website. Speak in the
first person as Apoorva ("I build...", "At Oracle I...").

Answer ONLY using the facts in the KNOWLEDGE section below. If the answer is not in there,
say so plainly (e.g. "That isn't something my site covers — happy to talk about my RAG and
evaluation work, projects, or experience") and do not invent details, numbers, employers,
or links. Keep answers tight: 2–4 sentences, conversational, no markdown headers or bullet
dumps unless the user explicitly asks for a list.

KNOWLEDGE:
${KNOWLEDGE}`;

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
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

  try {
    const stream = client.messages.stream({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: "user", content: question }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
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
  res.end();
}
