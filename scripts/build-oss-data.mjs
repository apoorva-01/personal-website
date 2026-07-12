// Regenerates assets/oss.json from GitHub: merged pull requests into repos I
// don't own, plus discussion answers marked accepted. Run in CI on a schedule,
// or locally with GITHUB_TOKEN=$(gh auth token) node scripts/build-oss-data.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const USER = "apoorva-01";
// Private-repo PRs are counted in the totals but never named on the public page
// (repo names and PR titles stay off the site). Flip to true only if a private
// repo is not confidential and you want it listed by name in the ledger.
const LIST_PRIVATE = false;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("Set GITHUB_TOKEN (locally: GITHUB_TOKEN=$(gh auth token)).");
  process.exit(1);
}

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "oss.json");

const headers = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github+json",
  "User-Agent": "oss-data-builder",
};

async function rest(path) {
  const r = await fetch("https://api.github.com" + path, { headers });
  if (!r.ok) throw new Error("REST " + path + " -> " + r.status);
  return r.json();
}

async function graphql(query) {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (j.errors) throw new Error("GraphQL: " + JSON.stringify(j.errors));
  return j.data;
}

const LANG = {
  TypeScript: "TS", JavaScript: "JS", Python: "PY", Rust: "RS", Go: "GO",
  Java: "JV", "C++": "C++", C: "C", "C#": "C#", Ruby: "RB", PHP: "PHP",
  Kotlin: "KT", Swift: "SW", Scala: "SC", MDX: "MDX", HTML: "HTML", Shell: "SH",
};
const code = (name) => LANG[name] || (name ? name.slice(0, 2).toUpperCase() : "—");
const day = (iso) => iso.slice(0, 10);
const isDocs = (t) => /\b(docs?|typo|grammar|readme|spelling)\b/i.test(t);

async function shipped() {
  const items = [];
  for (let page = 1; page <= 4; page++) {
    const q = encodeURIComponent(`is:pr author:${USER} is:merged -user:${USER}`);
    const res = await rest(`/search/issues?q=${q}&per_page=100&page=${page}`);
    items.push(...res.items);
    if (res.items.length < 100) break;
  }

  const byRepo = new Map();
  for (const it of items) {
    const repo = it.repository_url.replace(/.*\/repos\//, "");
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo).push({
      num: it.number, date: day(it.closed_at), title: it.title, docs: isDocs(it.title),
    });
  }

  const rows = [];
  let reach = 0, privatePrs = 0, privateRepos = 0;
  const langs = new Set();
  for (const [repo, prs] of byRepo) {
    const meta = await rest(`/repos/${repo}`);
    if (meta.private && !LIST_PRIVATE) {
      // Counted in the totals below, but never named or detailed on the public page.
      privateRepos += 1;
      privatePrs += prs.length;
      continue;
    }
    const stars = meta.stargazers_count || 0;
    const lang = code(meta.language);
    if (!meta.private) reach += stars;
    langs.add(lang);
    // Representative PR: newest substantive fix; if the repo only had docs work,
    // keep the newest but flag it so the UI can sort it to the bottom.
    const substantive = prs.filter((p) => !p.docs);
    const pick = (substantive.length ? substantive : prs).sort((a, b) => b.date.localeCompare(a.date))[0];
    rows.push({ date: pick.date, lang, repo, stars, num: pick.num, title: pick.title, docs: pick.docs });
  }
  // Substantive fixes first (by stars), docs-only repos trailing.
  rows.sort((a, b) => (a.docs - b.docs) || (b.stars - a.stars));

  return { prs: items.length, repos: byRepo.size, languages: langs.size, reach, privatePrs, privateRepos, rows };
}

async function answered() {
  const data = await graphql(`{
    user(login: "${USER}") {
      repositoryDiscussionComments(first: 100, onlyAnswers: true) {
        totalCount
        nodes {
          createdAt
          url
          discussion { title repository { nameWithOwner primaryLanguage { name } } }
        }
      }
    }
  }`);
  const c = data.user.repositoryDiscussionComments;
  const repos = new Set();
  const rows = c.nodes.map((n) => {
    const repo = n.discussion.repository.nameWithOwner;
    repos.add(repo);
    return {
      date: day(n.createdAt),
      lang: code(n.discussion.repository.primaryLanguage?.name),
      repo,
      title: n.discussion.title,
      url: n.url,
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
  return { total: c.totalCount, repos: repos.size, rows };
}

const [s, a] = await Promise.all([shipped(), answered()]);
const out = { generated: new Date().toISOString().slice(0, 10), shipped: s, answered: a };
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${OUT}: ${s.prs} PRs / ${s.repos} repos, ${a.total} answers.`);
