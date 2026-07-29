// Generates one static page per post from content/posts/*.md, then regenerates
// the blog index cards + sitemap. Source of truth is the markdown; posts/*.html,
// the card list in blog.html, and sitemap.xml are build output (committed).
//
//   node scripts/build-blog.mjs
//
// Byline publishes by committing content/posts/{slug}.md to this repo; CI runs
// this script and commits the generated HTML, so a publish becomes a live page.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.apoorvaverma.in";
const CONTENT = join(ROOT, "content", "posts");
const POSTS_OUT = join(ROOT, "posts");
const DEFAULT_OG = "/assets/apoorva.jpg";

marked.setOptions({ gfm: true, breaks: false });

const escHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => escHtml(s).replace(/"/g, "&quot;");

function readPosts() {
  return readdirSync(CONTENT)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = readFileSync(join(CONTENT, f), "utf8");
      const { data, content } = matter(raw);
      if (!data.slug) throw new Error(`${f}: missing 'slug' in frontmatter`);
      if (!data.title) throw new Error(`${f}: missing 'title' in frontmatter`);
      return { data, content, file: f };
    })
    .sort((a, b) => String(b.data.published).localeCompare(String(a.data.published)));
}

function renderBody(md) {
  let html = marked.parse(md);
  // Wrap tables so wide grids scroll on mobile instead of blowing out the layout.
  html = html.replace(/<table>/g, '<div class="tablewrap"><table>').replace(/<\/table>/g, "</table></div>");
  return html;
}

function readingMinutes(post, plainWords) {
  const m = String(post.data.read || "").match(/(\d+)/);
  return m ? Number(m[1]) : Math.max(1, Math.round(plainWords / 200));
}

const ARTICLE_CSS = `
  .article{display:flex;flex-direction:column;gap:22px}
  .article>p{font-size:17.5px;line-height:1.78;color:var(--text-2);letter-spacing:-.005em}
  .article>p:first-of-type{font-size:20px;line-height:1.62;color:var(--text);letter-spacing:-.01em}
  .article h2{margin-top:14px;font-size:24px;font-weight:400;letter-spacing:-.03em;line-height:1.25;color:var(--heading)}
  .article h3{margin-top:8px;font-size:19px;font-weight:500;letter-spacing:-.02em;line-height:1.3;color:var(--heading)}
  .article a{color:var(--accent);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--accent) 40%,transparent)}
  .article a:hover{border-bottom-color:var(--accent)}
  .article code{font-family:'IBM Plex Mono',monospace;font-size:.88em;background:var(--bubble);border:1px solid var(--w09);padding:1px 6px;border-radius:0}
  .article pre{margin:0;overflow-x:auto;background:var(--bubble);border:1px solid var(--w09);border-radius:0;padding:16px 18px}
  .article pre code{background:none;border:0;padding:0;font-size:13.5px;line-height:1.6;color:var(--text-2)}
  .article ul,.article ol{padding-left:22px;display:flex;flex-direction:column;gap:8px;font-size:17.5px;line-height:1.7;color:var(--text-2)}
  .article li{padding-left:3px}
  .article blockquote{margin:0;padding:2px 0 2px 18px;border-left:2px solid var(--accent);color:var(--text-3)}
  .article strong{color:var(--text);font-weight:600}
  .article img{max-width:100%;height:auto;border:1px solid var(--w08)}
  .article .tablewrap{overflow-x:auto}
  .article table{border-collapse:collapse;width:100%;min-width:360px}
  .article th{text-align:left;padding:9px 14px;font-size:12.5px;font-weight:500;color:var(--text-3);border-bottom:1px solid var(--w12);white-space:nowrap}
  .article td{padding:9px 14px;font-size:13.5px;color:var(--text-2);border-bottom:1px solid var(--w08);white-space:nowrap}
  .article th[align="right"],.article td[align="right"]{text-align:right}
  .article td[align="right"]{font-family:'IBM Plex Mono',monospace}
  .article figure{margin:0}
  .article figure svg{width:100%;height:auto}
  .article figcaption{margin-top:10px;font-size:12.5px;color:var(--faint);text-align:center}`;

const BASE_CSS = `
  :root{
    --bg:#0d0e11;--surface:#14161a;--surface-hover:#191c22;--bubble:#14161a;--nav-bg:rgba(13,14,17,.94);
    --text:#e7e8ea;--text-2:#c2c5ca;--text-3:#9aa0a8;--text-4:#7c828b;--faint:#61656d;--heading:#f5f6f7;
    --on-accent:#fff;--invert-bg:#e7e8ea;--invert-fg:#0d0e11;--dot:#23262c;--scroll:#262a30;--scrim:rgba(8,9,11,.9);
    --accent:#ff4b26;--accent-ink:#ff6a4d;--live:#37b46a;--pass:#8a8f98;--grid:rgba(255,255,255,.045);
    --w025:rgba(255,255,255,.03);--w03:rgba(255,255,255,.035);--w04:rgba(255,255,255,.045);--w05:rgba(255,255,255,.06);--w06:rgba(255,255,255,.07);--w07:rgba(255,255,255,.085);--w08:rgba(255,255,255,.1);--w09:rgba(255,255,255,.11);--w10:rgba(255,255,255,.13);--w12:rgba(255,255,255,.16);--w14:rgba(255,255,255,.19);--w30:rgba(255,255,255,.34);
  }
  :root[data-av-theme="light"]{
    --bg:#f4f3ef;--surface:#ffffff;--surface-hover:#ffffff;--bubble:#ffffff;--nav-bg:rgba(244,243,239,.92);
    --text:#1a1b1e;--text-2:#3b3d42;--text-3:#54565c;--text-4:#6a6c72;--faint:#8e9096;--heading:#0d0e11;
    --on-accent:#fff;--invert-bg:#1a1b1e;--invert-fg:#f4f3ef;--dot:#d7d5cd;--scroll:#cbc9c0;--scrim:rgba(244,243,239,.86);
    --accent:#e03c15;--accent-ink:#bf3210;--live:#1f9d55;--pass:#6a6c72;--grid:rgba(0,0,0,.04);
    --w025:rgba(0,0,0,.035);--w03:rgba(0,0,0,.04);--w04:rgba(0,0,0,.05);--w05:rgba(0,0,0,.06);--w06:rgba(0,0,0,.07);--w07:rgba(0,0,0,.085);--w08:rgba(0,0,0,.1);--w09:rgba(0,0,0,.11);--w10:rgba(0,0,0,.13);--w12:rgba(0,0,0,.15);--w14:rgba(0,0,0,.18);--w30:rgba(0,0,0,.32);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth;background-color:var(--bg);transition:background-color .35s ease}
  html body{background:var(--bg);color:var(--text);font-family:'IBM Plex Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased;transition:background-color .35s ease,color .35s ease}
  ::selection{background:var(--accent);color:#fff}
  ::-webkit-scrollbar{width:12px;height:12px}
  ::-webkit-scrollbar-track{background:var(--bg)}
  ::-webkit-scrollbar-thumb{background:var(--scroll);border-radius:0;border:3px solid var(--bg)}
  a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @media (prefers-reduced-motion:reduce){*{animation:none !important;transition:none !important}}
  #theme-btn{position:relative;box-sizing:border-box;width:56px;height:30px;padding:0 8px;border:1px solid var(--w12);background:var(--bubble);border-radius:3px;cursor:pointer;display:inline-flex;align-items:center;justify-content:space-between;transition:border-color .18s;flex:0 0 auto}
  #theme-btn:hover{border-color:var(--w30)}
  #theme-btn svg{width:13px;height:13px;position:relative;z-index:2;transition:color .2s}
  #theme-btn .tt-sun{color:#fff}
  #theme-btn .tt-moon{color:var(--faint)}
  #theme-btn .tt-thumb{position:absolute;top:3px;left:3px;width:22px;height:22px;background:var(--accent);border-radius:2px;transition:transform .24s cubic-bezier(.4,0,.2,1);z-index:1}
  :root:not([data-av-theme="light"]) #theme-btn .tt-sun{color:var(--faint)}
  :root:not([data-av-theme="light"]) #theme-btn .tt-moon{color:#fff}
  :root:not([data-av-theme="light"]) #theme-btn .tt-thumb{transform:translateX(26px)}
  @media (max-width:640px){
    .nav-link{display:none !important}
    #cur-ring,#cur-dot{display:none !important}
  }`;

const NAV = `  <nav style="position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px 20px">
    <div style="display:flex;align-items:center;justify-content:space-between;width:100%;max-width:1180px;padding:9px 10px 9px 16px;background:var(--nav-bg);border:1px solid var(--w08);border-radius:2px">
      <a href="/" style="display:flex;align-items:center;gap:11px;text-decoration:none;color:var(--text)">
        <img src="/assets/apoorva.jpg" alt="Apoorva Verma" width="28" height="28" style="width:28px;height:28px;border-radius:2px;object-fit:cover;border:1px solid var(--accent);display:block">
        <span style="font-family:'IBM Plex Mono',monospace;font-weight:500;letter-spacing:-.01em;font-size:14px">Apoorva Verma</span>
      </a>
      <div style="display:flex;align-items:center;gap:4px">
        <a class="nav-link" href="/#projects" style="text-decoration:none;color:var(--text-3);font-size:13.5px;padding:7px 12px;border-radius:2px;transition:color .2s" data-hover="color:var(--text)">Projects</a>
        <a class="nav-link" href="/blog" style="text-decoration:none;color:var(--text);font-size:13.5px;padding:7px 12px;border-radius:2px">My notes</a>
        <button id="theme-btn" onclick="App.toggleTheme()" aria-label="Toggle light or dark theme" title="Toggle theme"><svg class="tt-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/></svg><svg class="tt-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><span class="tt-thumb"></span></button>
        <a href="/#contact" style="text-decoration:none;color:var(--invert-fg);font-size:13.5px;font-weight:600;padding:8px 15px;border-radius:2px;background:var(--invert-bg);margin-left:6px;transition:transform .2s" data-hover="">Contact</a>
      </div>
    </div>
  </nav>`;

const SUBSCRIBE_BLOCK = `<section style="padding:0 0 8px">
    <div style="border:1px solid var(--w10);background:var(--surface);padding:24px 22px;display:flex;flex-direction:column;gap:12px">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;color:var(--faint);text-transform:uppercase">Get new notes by email</div>
      <p style="font-size:14px;line-height:1.6;color:var(--text-4);max-width:52ch">One email when I publish. No spam, unsubscribe anytime.</p>
      <form id="subscribe-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <input name="email" type="email" required autocomplete="email" placeholder="you@company.com" style="flex:1;min-width:220px;font-family:'IBM Plex Mono',monospace;font-size:13.5px;color:var(--text);background:var(--bubble);border:1px solid var(--w12);border-radius:0;padding:11px 13px">
        <input name="company" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" placeholder="Company">
        <button type="submit" style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#fff;padding:11px 22px;border:none;border-radius:0;background:var(--accent);cursor:pointer">Subscribe</button>
      </form>
      <span id="subscribe-status" role="status" aria-live="polite" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--faint)"></span>
    </div>
  </section>`;

const PAGE_SCRIPT = `<script>
(function(){
  "use strict";
  function bindHovers(scope){
    var els = scope.querySelectorAll("[data-hover]");
    for (var i=0;i<els.length;i++){
      (function(el){
        if (el.__hb) return; el.__hb = 1;
        var hov = el.getAttribute("data-hover");
        el.addEventListener("mouseenter", function(){
          if (el.__hovering) return;
          el.__hovering = 1;
          el.__base = el.getAttribute("style") || "";
          el.setAttribute("style", el.__base + ";" + hov);
        });
        el.addEventListener("mouseleave", function(){
          el.__hovering = 0;
          el.setAttribute("style", el.__base);
        });
      })(els[i]);
    }
  }
  var curTheme = "dark";
  function applyTheme(t){
    var light = t === "light";
    curTheme = light ? "light" : "dark";
    try {
      if (light) document.documentElement.setAttribute("data-av-theme", "light");
      else document.documentElement.removeAttribute("data-av-theme");
    } catch(e){}
    try { localStorage.setItem("av-theme", curTheme); } catch(e){}
    var btn = document.getElementById("theme-btn");
    if (btn) btn.setAttribute("aria-pressed", curTheme === "dark" ? "true" : "false");
  }
  function toggleTheme(){
    var cur = "dark";
    try { cur = document.documentElement.getAttribute("data-av-theme") === "light" ? "light" : "dark"; } catch(e){}
    applyTheme(cur === "light" ? "dark" : "light");
  }
  function initCursor(){
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return;
    var ring = document.getElementById("cur-ring"), dot = document.getElementById("cur-dot");
    if (!ring || !dot) return;
    var mx=-200,my=-200,rx=-200,ry=-200,shown=false,big=false;
    function move(e){
      mx=e.clientX; my=e.clientY;
      dot.style.transform = "translate("+mx+"px,"+my+"px)";
      if (!shown){ shown=true; ring.style.opacity="1"; dot.style.opacity="1"; }
    }
    function setBig(on){
      if (on===big) return; big=on;
      ring.style.width = on?"52px":"34px";
      ring.style.height = on?"52px":"34px";
      ring.style.margin = on?"-26px 0 0 -26px":"-17px 0 0 -17px";
      ring.style.background = on?"rgba(255,75,38,.12)":"rgba(255,75,38,.05)";
      ring.style.borderColor = on?"rgba(168,156,255,.9)":"rgba(255,75,38,.6)";
    }
    function over(e){ setBig(!!(e.target.closest && e.target.closest('a,button,input,[role="button"]'))); }
    function leave(){ ring.style.opacity="0"; dot.style.opacity="0"; shown=false; }
    function loop(){
      rx += (mx-rx)*0.18; ry += (my-ry)*0.18;
      ring.style.transform = "translate("+rx.toFixed(2)+"px,"+ry.toFixed(2)+"px)";
      requestAnimationFrame(loop);
    }
    window.addEventListener("mousemove", move, { passive:true });
    window.addEventListener("mouseover", over, { passive:true });
    document.addEventListener("mouseleave", leave);
    requestAnimationFrame(loop);
  }
  function initSubscribe(){
    var f = document.getElementById("subscribe-form");
    if (!f) return;
    var status = document.getElementById("subscribe-status");
    f.addEventListener("submit", function(e){
      e.preventDefault();
      var btn = f.querySelector('button[type="submit"]');
      var email = f.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ status.style.color = "var(--accent)"; status.textContent = "Enter a valid email address."; return; }
      var label = btn.textContent; btn.disabled = true; btn.textContent = "Subscribing…"; status.style.color = "var(--faint)"; status.textContent = "";
      fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email, company: f.company.value }) })
        .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
        .then(function(res){
          if (res.ok){ f.reset(); status.style.color = "var(--live)"; status.textContent = "Subscribed! Watch your inbox."; }
          else { status.style.color = "var(--accent)"; status.textContent = (res.j && res.j.error) || "Something went wrong. Try again."; }
        })
        .catch(function(){ status.style.color = "var(--accent)"; status.textContent = "Network error. Try again."; })
        .then(function(){ btn.disabled = false; btn.textContent = label; });
    });
  }
  function boot(){
    var stored = "light";
    try { stored = localStorage.getItem("av-theme") || "light"; } catch(e){}
    applyTheme(stored);
    bindHovers(document);
    initCursor();
    initSubscribe();
  }
  window.App = { toggleTheme: toggleTheme };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
</script>`;

function pageHtml(post) {
  const d = post.data;
  const url = `${SITE}/posts/${d.slug}`;
  const og = d.ogImage ? SITE + d.ogImage : SITE + DEFAULT_OG;
  const desc = d.excerpt || "";
  const tags = Array.isArray(d.tags) ? d.tags : [];
  const bodyHtml = renderBody(post.content);
  const plainWords = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const minutes = readingMinutes(post, plainWords);
  const twTitle = d.twitterTitle || d.title;
  const twDesc = d.twitterDescription || desc;
  const crumb = d.breadcrumb || d.title;

  const ldPost = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#post`,
    mainEntityOfPage: url,
    headline: d.title,
    description: desc,
    image: og,
    datePublished: d.published,
    dateModified: d.updated || d.published,
    inLanguage: "en",
    articleSection: d.section || (tags[0] ?? undefined),
    wordCount: plainWords,
    timeRequired: `PT${minutes}M`,
    keywords: d.keywords || tags,
    isPartOf: { "@type": "Blog", "@id": `${SITE}/blog#blog` },
    author: { "@type": "Person", "@id": `${SITE}/#person`, name: "Apoorva Verma", url: `${SITE}/` },
    publisher: { "@type": "Person", "@id": `${SITE}/#person`, name: "Apoorva Verma" },
  };
  const ldCrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Writing", item: `${SITE}/blog` },
      { "@type": "ListItem", position: 3, name: crumb },
    ],
  };

  const tagPills = tags
    .map(
      (t) =>
        `<span style="font-size:11.5px;color:var(--text-2);padding:4px 11px;border-radius:2px;background:rgba(255,75,38,.1);border:1px solid rgba(255,75,38,.25)">${escHtml(t)}</span>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(d.title)} — Apoorva Verma</title>
<link rel="icon" type="image/jpeg" href="/assets/apoorva.jpg">
<link rel="apple-touch-icon" href="/assets/apoorva.jpg">
<script>try{var _t=localStorage.getItem("av-theme");if(_t!=="dark")document.documentElement.setAttribute("data-av-theme","light");}catch(e){document.documentElement.setAttribute("data-av-theme","light");}</script>
<meta name="description" content="${escAttr(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escAttr(d.title)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:image" content="${og}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(twTitle)}">
<meta name="twitter:description" content="${escAttr(twDesc)}">
<meta name="twitter:image" content="${og}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/motion@11.11.13/dist/motion.js"></script>
<style>${BASE_CSS}${ARTICLE_CSS}
</style>
  <!-- RB2B person-level visitor identification (US traffic) -> Slack -->
  <script>!function(key) {if (window.reb2b) return;window.reb2b = {loaded: true};var s = document.createElement("script");s.async = true;s.src = "https://ddwl4m2hdecbv.cloudfront.net/b/" + key + "/" + key + ".js.gz";document.getElementsByTagName("script")[0].parentNode.insertBefore(s, document.getElementsByTagName("script")[0]);}("4O7Z0HE0XPNX");</script>
  <script type="application/ld+json">
${JSON.stringify(ldPost, null, 2)}
  </script>
  <script type="application/ld+json">
${JSON.stringify(ldCrumb, null, 2)}
  </script>
</head>
<body>

<div id="av-root" style="position:relative;min-height:100vh;overflow:hidden">

  <!-- instrument graph grid -->
  <div aria-hidden="true" style="position:fixed;inset:0;background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:10px 10px;pointer-events:none;z-index:0"></div>

  <!-- NAV -->
  <div id="scroll-progress" aria-hidden="true" style="position:fixed;top:0;left:0;height:2px;width:0;background:var(--accent);z-index:60;box-shadow:0 0 8px rgba(255,75,38,.55);transition:width .05s linear;will-change:width"></div>
  <script>
  (function(){
    var bar=document.getElementById("scroll-progress");
    function upd(){
      var h=document.documentElement, b=document.body;
      var st=h.scrollTop||b.scrollTop;
      var sh=(h.scrollHeight||b.scrollHeight)-h.clientHeight;
      bar.style.width=(sh>0?(st/sh)*100:0)+"%";
    }
    addEventListener("scroll",upd,{passive:true});
    addEventListener("resize",upd,{passive:true});
    upd();
  })();
  </script>
${NAV}

  <main style="position:relative;z-index:1;max-width:720px;margin:0 auto;padding:120px 24px 120px">
    <a href="/blog" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.02em;color:var(--text-3);padding:7px 12px;border-radius:0;border:1px solid var(--w10);background:transparent;transition:border-color .18s,color .18s;animation:fadeUp .5s ease both" data-hover="color:var(--heading);border-color:var(--accent)">← Back to writing</a>

    <article style="margin-top:0">
    <div style="display:flex;align-items:center;gap:10px;margin-top:30px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--faint)"><span>${escHtml(d.date || "")}</span><span style="opacity:.5">·</span><span>${escHtml(d.read || minutes + " min read")}</span></div>
    <h1 style="margin-top:14px;font-size:clamp(30px,5vw,46px);font-weight:500;letter-spacing:-.04em;line-height:1.08;color:var(--heading)">${escHtml(d.title)}</h1>
    <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:18px">${tagPills}</div>
    <div style="margin-top:32px;height:1px;background:linear-gradient(90deg,rgba(255,75,38,.5),transparent)"></div>

    <div class="article" style="margin-top:30px">${bodyHtml}</div>
    </article>

    <div style="margin-top:48px;padding-top:26px;border-top:1px solid var(--w08);display:flex;align-items:center;gap:14px"><img src="/assets/apoorva.jpg" alt="Apoorva Verma" width="46" height="46" style="width:46px;height:46px;border-radius:2px;object-fit:cover;border:1px solid var(--accent);display:block"><div style="flex:1"><div style="font-size:14px;font-weight:500;color:var(--text)">Apoorva Verma</div><div style="font-size:12.5px;color:var(--faint)">Software Engineer · Applied AI</div></div><div style="display:flex;gap:7px"><a href="https://github.com/apoorva-01" target="_blank" rel="noopener" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text-3);text-decoration:none;padding:6px 11px;border:1px solid var(--w10);border-radius:0;transition:border-color .18s,color .18s" data-hover="color:var(--heading);border-color:var(--accent)">GitHub</a><a href="https://www.linkedin.com/in/apoorva0510/" target="_blank" rel="noopener" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text-3);text-decoration:none;padding:6px 11px;border:1px solid var(--w10);border-radius:0;transition:border-color .18s,color .18s" data-hover="color:var(--heading);border-color:var(--accent)">LinkedIn</a></div></div>

${SUBSCRIBE_BLOCK}

    <div style="margin-top:40px"><a href="/blog" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.02em;color:var(--text-3);padding:7px 12px;border-radius:0;border:1px solid var(--w10);background:transparent;transition:border-color .18s,color .18s" data-hover="color:var(--heading);border-color:var(--accent)">← Back to writing</a></div>

  </main>

</div>

${PAGE_SCRIPT}
  <script src="/visit.js" defer></script>
</body>
</html>
`;
}

function cardHtml(post) {
  const d = post.data;
  const tags = (Array.isArray(d.tags) ? d.tags : [])
    .map(
      (t) =>
        `<span style="font-size:11px;color:var(--text-3);padding:3px 10px;border-radius:2px;background:rgba(255,75,38,.08);border:1px solid rgba(255,75,38,.2)">${escHtml(t)}</span>`
    )
    .join("");
  const href = `/posts/${d.slug}`;
  return (
    `<a data-reveal="1" href="${href}" class="logrow" style="display:grid;grid-template-columns:190px 1fr;gap:36px;align-items:start;text-decoration:none;color:inherit;padding:38px 8px;border-top:1px solid var(--w09);cursor:pointer;opacity:0;transform:translateY(24px);transition:background .2s" data-hover="background:var(--surface-hover)">` +
    `<div style="display:flex;flex-direction:column;gap:16px">` +
    `<div style="font-family:'IBM Plex Mono',monospace;font-size:12px;display:flex;flex-direction:column;gap:4px"><span style="color:var(--text-3)">${escHtml(d.date || "")}</span><span style="color:var(--faint)">${escHtml(d.read || "")}</span></div>` +
    `<div style="display:flex;flex-wrap:wrap;gap:6px">${tags}</div>` +
    `</div>` +
    `<div>` +
    `<h3 style="font-size:clamp(23px,2.7vw,31px);font-weight:500;letter-spacing:-.03em;line-height:1.16;color:var(--heading)">${escHtml(d.title)}</h3>` +
    `<p style="margin-top:15px;font-size:16px;line-height:1.65;color:var(--text-4);max-width:60ch">${escHtml(d.excerpt || "")}</p>` +
    `<span style="display:inline-flex;align-items:center;gap:8px;margin-top:22px;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.02em;color:var(--accent)">Read the note →</span>` +
    `</div>` +
    `</a>`
  );
}

function replaceBetween(src, startMark, endMark, inner) {
  const s = src.indexOf(startMark);
  const e = src.indexOf(endMark);
  if (s === -1 || e === -1) throw new Error(`marker not found: ${startMark}`);
  return src.slice(0, s + startMark.length) + inner + src.slice(e);
}

function writeBlogIndex(posts) {
  const file = join(ROOT, "blog.html");
  let html = readFileSync(file, "utf8");
  const cards = posts.map(cardHtml).join("");
  const count = posts.length + (posts.length === 1 ? " entry" : " entries");
  html = replaceBetween(html, "<!--BUILD:CARDS-->", "<!--/BUILD:CARDS-->", cards);
  html = replaceBetween(html, "<!--BUILD:COUNT-->", "<!--/BUILD:COUNT-->", count);
  writeFileSync(file, html);
}

function writeSitemap(posts) {
  const dates = posts.map((p) => String(p.data.updated || p.data.published)).filter(Boolean);
  const newest = dates.sort().at(-1) || "2026-07-08";
  const urls = [
    { loc: `${SITE}/`, lastmod: newest },
    { loc: `${SITE}/about`, lastmod: "2026-07-20" },
    { loc: `${SITE}/blog`, lastmod: newest },
    ...posts.map((p) => ({
      loc: `${SITE}/posts/${p.data.slug}`,
      lastmod: String(p.data.updated || p.data.published),
    })),
  ];
  const body = urls
    .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`)
    .join("\n");
  writeFileSync(
    join(ROOT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
  );
}

function main() {
  const posts = readPosts();
  mkdirSync(POSTS_OUT, { recursive: true });
  for (const post of posts) {
    writeFileSync(join(POSTS_OUT, `${post.data.slug}.html`), pageHtml(post));
    console.log(`  posts/${post.data.slug}.html`);
  }
  writeBlogIndex(posts);
  writeSitemap(posts);
  console.log(`Built ${posts.length} post(s), blog index, sitemap.`);
}

main();
