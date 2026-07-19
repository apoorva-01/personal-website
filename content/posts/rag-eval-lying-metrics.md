---
title: "I graded 50 RAG answers with a hand-built harness. Half the metrics were lying to me."
slug: rag-eval-lying-metrics
excerpt: "Faithfulness sat at 1.0 across every config I tried. That number told me nothing, and here's the one I actually trust instead."
date: "Jul 2026"
read: "6 min read"
tags: ["RAG", "LLM Evaluation"]
published: "2026-07-01"
updated: "2026-07-08"
section: "LLM Evaluation"
keywords: ["RAG", "LLM evaluation", "retrieval", "NDCG", "citation faithfulness"]
ogImage: "/assets/og-rag-eval.png"
breadcrumb: "I graded 50 RAG answers with a hand-built harness"
twitterTitle: "I graded 50 RAG answers. Half the metrics were lying to me."
twitterDescription: "Faithfulness sat at 1.0 across every config. That number told me nothing, and here's the one I actually trust instead."
---

I built a RAG system over 15 arXiv papers, the usual chat-with-your-documents thing. Then I did the part most people skip: I wrote an evaluation harness, made a gold set of 50 questions, and graded every single answer across every config I could think of. Retrieval ladder, chunking strategies, two embedding models, the works.

The point wasn't the chatbot. The chatbot is a weekend. The point was to find out which knobs actually matter, with numbers, instead of shipping on vibes.

Most of the numbers lied to me. Here's how I figured out which ones.

## The metrics that saturate tell you nothing

First thing I ran was the generation matrix: two chunking strategies crossed with two embedding models, scored with DeepEval on faithfulness, answer relevance, context precision, context recall. Four configs, four grounding-quality metrics each.

Faithfulness came back at 1.0. On every config. Citation precision, same story, 1.0 across the board.

For about ten minutes I felt great. Then it clicked that a metric which reads 1.0 no matter what you feed it isn't measuring your config. It's measuring the generator. Claude, handed a decent prompt and some numbered sources, basically doesn't make things up. That's a fact about the model, not about my fixed-vs-semantic chunking decision. If I'd picked a config based on faithfulness I would have been reading tea leaves.

So the first lesson is boring and important: a metric that's already pinned at the ceiling has no opinion. It can't separate your options. Drop it from the comparison and go find one that moves.

## The numbers that actually moved

Two things moved, and they're where all the real signal was.

Retrieval was the big one. I ran a ladder from naive to senior:

| retriever | NDCG@5 | Recall@5 | MRR |
|---|--:|--:|--:|
| dense (single-vector) | 0.333 | 0.44 | 0.299 |
| + BM25 hybrid (RRF) | 0.433 | 0.58 | 0.384 |
| + cross-encoder rerank | 0.618 | 0.76 | 0.570 |

<figure class="chart"><div style="overflow-x:auto"><svg viewBox="0 0 660 360" role="img" aria-label="Bar chart of NDCG at 5 across three retrievers: dense 0.33, plus BM25 hybrid 0.43, plus cross-encoder rerank 0.62" style="width:100%;height:auto;font-family:'IBM Plex Sans',system-ui,sans-serif"><defs><linearGradient id="ndcgbar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="var(--accent)"></stop><stop offset="1" stop-color="var(--accent)"></stop></linearGradient></defs><text x="0" y="22" fill="var(--heading)" font-size="16" font-weight="500">Retrieval ladder: NDCG@5 across 50 questions</text><g stroke="var(--w09)" stroke-width="1"><line x1="60" y1="310" x2="636" y2="310"></line><line x1="60" y1="241" x2="636" y2="241"></line><line x1="60" y1="173" x2="636" y2="173"></line><line x1="60" y1="104" x2="636" y2="104"></line></g><g fill="var(--faint)" font-size="11" text-anchor="end"><text x="50" y="314">0.0</text><text x="50" y="245">0.2</text><text x="50" y="177">0.4</text><text x="50" y="108">0.6</text></g><rect x="96" y="196" width="120" height="114" rx="5" fill="url(#ndcgbar)" opacity="0.55"></rect><rect x="288" y="161" width="120" height="149" rx="5" fill="url(#ndcgbar)" opacity="0.78"></rect><rect x="480" y="98" width="120" height="212" rx="5" fill="url(#ndcgbar)"></rect><g fill="var(--heading)" font-size="15" font-weight="600" text-anchor="middle"><text x="156" y="184">0.33</text><text x="348" y="149">0.43</text><text x="540" y="86">0.62</text></g><g fill="var(--text-3)" font-size="12" text-anchor="middle"><text x="156" y="332">dense</text><text x="348" y="332">+ BM25 hybrid</text><text x="540" y="332">+ cross-encoder rerank</text></g><text x="540" y="68" fill="var(--accent)" font-size="13" font-weight="600" text-anchor="middle">+86% vs naive dense</text></svg></div><figcaption>The whole retrieval ladder. The cross-encoder is the single biggest rung (0.43 to 0.62).</figcaption></figure>

Naive dense to hybrid-plus-rerank is NDCG@5 0.33 to 0.62. That's an 86% lift, and it's monotonic, every rung helps. The single biggest jump is the cross-encoder (0.43 to 0.62). If you have one afternoon to spend on your RAG stack, spend it there, not on a bigger generation model.

The other thing that moved was context precision, and it was the only generation metric that did. It went 0.754 to 0.846 across the matrix, and the winner was semantic chunking with e5-large. Worth knowing e5-large costs about 3x the embedding compute of bge-small, so that 0.09 is a real tradeoff, not a free lunch. There's also one config (semantic chunking with bge-small) that quietly trades recall down to 0.733 to buy precision, which is the kind of thing you only see when you grade the whole grid instead of one happy-path run.

Everything else was flat. Four metrics, one of them told me anything.

## The honest part: I don't fully trust my own gold set

Here's the bit I could have hidden and didn't.

My gold set is synthetic. I had Claude generate each question and reference answer from a chunk, then lightly filtered. Which means for retrieval it's structurally circular: every question's only ground truth is the exact chunk it was born from, so that chunk tends to rank well under any retriever you throw at it. I de-lexicalized the questions so they don't just echo keywords from their source passage, and you can see that biting in the numbers (dense alone only hits 0.33 because paraphrase kills pure embedding match). But de-lexicalizing fixes keyword leakage, not the structural coupling. Single-positive ground truth also deflates Recall@k whenever some other chunk was also relevant and I never labeled it.

So those retrieval absolutes are conservative lower bounds. The 86% lift is real because it's a relative comparison on the same flawed gold set, and the flaws cancel. The absolute 0.62 is a number I'd argue with.

This is the trap with eval work. You build a measuring stick, and then you forget the stick itself has error bars. A benchmark you generated from the thing you're testing is going to flatter the thing you're testing.

## So I built a metric that never touches the gold set

If I don't fully trust the gold set, I shouldn't lead with a metric that depends on it. So the number I actually put my name behind is a custom citation-faithfulness metric, framed the way the attribution-eval (ALCE) literature does it, and it's gold-independent by design. It audits the answer against its own cited sources and never looks at the gold set at all.

Two parts. Citation precision: of the claims that carry a `[n]`, what fraction are actually stated by the source they cite. When you cite, are you right? Citation recall: of all the factual claims in the answer, what fraction carry at least one citation. Do you cite everything you assert, or just some of it?

The detail I care about most: honest refusals ("the sources don't cover this") have no claims to cite, so they're excluded, not scored zero. A model that correctly says "I don't know" shouldn't get punished by your eval for being honest. That's the difference between measuring grounding and measuring confidence.

And because "the metric said 1.0" is exactly the kind of claim you shouldn't take on faith, the behavior is pinned down by tests. A correctly-cited answer scores 1.0 / 1.0. An answer that cites the wrong source and leaves one claim uncited scores precision 0.0 and recall 0.5, by construction. The metric is graded before I let it grade anything else.

## What I'd tell you to take from this

Grade the whole grid, not the happy path. The interesting failures live in the cells you didn't bother to run.

When a metric reads the same everywhere, that's not your system being perfect. That's the metric being blind to the difference you care about. Go find one that can see it.

And be suspicious of any eval built on data you generated yourself. Ask what the metric depends on, and prefer the one that depends on the least. In my case the bottleneck turned out to be retrieval, not generation, and the only score I'd defend in a code review is the one that doesn't lean on a gold set I can't fully verify.

The harness, the custom metric, the tests, and every number above are in the repo: [github.com/apoorva-01/rag-eval-harness](https://github.com/apoorva-01/rag-eval-harness). Run `python eval/run_matrix.py` and it regenerates the tables. If your numbers come out different, I'd genuinely like to know why.
