---
title: "Building a vector store on MySQL 9, and everything I refused to fake"
slug: mysql-vector-store-langchain
excerpt: "MySQL 9 gives you a VECTOR column and a distance function. No index, no relevance scores, nothing else. Here's what I learned building a real LangChain and LlamaIndex vector store on top of that, without pretending it had features it doesn't."
date: "Jul 2026"
read: "8 min read"
tags: ["Vector Search", "LangChain", "Open Source"]
published: "2026-07-15"
updated: "2026-07-15"
section: "Vector Search"
keywords: ["MySQL", "vector search", "LangChain", "LlamaIndex", "IVF", "RAG", "HeatWave"]
breadcrumb: "Building a vector store on MySQL 9"
---

MySQL 9 shipped a native VECTOR type. You store embeddings in a column, and a `DISTANCE()` function gives you cosine, dot, or euclidean. That is the entire toolbox. No approximate index, no relevance scoring, no filter helpers, none of the machinery a real vector database hands you on day one.

I wanted a LangChain vector store on top of it. If your data already lives in MySQL, spinning up a separate vector database just to do retrieval is a pile of moving parts you don't need. So I built one, `langchain-shannonbase` (it runs on ShannonBase, plain self-hosted MySQL 9, and HeatWave, which all expose the same VECTOR surface), and later a LlamaIndex sibling.

The building part was easy. The interesting part was every spot where the database couldn't do the thing, and deciding what to do about it. The easy move in those spots is to paper over the gap with code that looks like a feature and isn't. I tried hard not to. This post is mostly about the times I was tempted.

## The database has no index. Don't pretend it does.

Exact search on MySQL 9 is a full `DISTANCE` scan: every query compares your vector against every row. That is 100% recall and it is genuinely fine up to a few million vectors. It is also O(n), and past some size it tips over.

The thing a vector database gives you here is an approximate index, the HNSW and IVF family. MySQL 9 doesn't have one. Neither does ShannonBase (I read the source to be sure, more on that below).

So the temptation: emit some `CREATE INDEX ... USING HNSW`, wrap it in a `build_index()` method, and let it fail quietly on backends that don't support it. The library would look like it had ANN. It would demo great. It would be a lie.

I built the index in application code instead. IVF: run k-means over the stored vectors, keep the centroids, tag each row with its nearest one, and at query time only scan the handful of clusters closest to the query. Same idea as pgvector's IVFFlat, just done in Python because the database won't do it for me. Recall is approximate and you trade it against how many clusters you probe. The point is it actually runs, on a MySQL you can start in a container, and I can measure the recall and show you the curve. A fake `CREATE INDEX` can't be measured, because it was never real.

HeatWave is the exception, and I only learned this by reading the docs properly. Writing "here is when NOT to use my feature" into the README felt more honest than pretending my feature was always the answer.

> **If you're on HeatWave:** since 9.5 it builds an HNSW index automatically and uses it on ordinary `ORDER BY DISTANCE` queries. You get native ANN for free — don't call my IVF thing at all.

## When the docs are silent, read the source

MySQL's `DISTANCE` supports a `DOT` metric. I needed to know one specific thing: does dot-product distance come back as the raw inner product, or negated?

This matters more than it sounds. Vector stores sort ascending, smallest distance first. Cosine and euclidean are naturally smaller-is-closer. A dot product is the opposite, bigger-is-closer, so to make it act like a distance you negate it. If MySQL negates and I assume it doesn't, my dot-metric search returns results in exactly the wrong order. And no test against my in-memory fake would catch it, because I'd have written the fake with the same wrong assumption.

The MySQL and HeatWave docs list `DOT` as supported and say nothing about the sign. The web has plenty of confident secondhand answers. I didn't want secondhand for something that decides whether search works.

ShannonBase is open source and it's a MySQL fork, so its `DISTANCE` lives where MySQL's would. I found the function. It's four lines:

```cpp
double calculate_dot_distance(const float* a, const float* b, uint32 dim) {
  double dot = 0.0;
  for (uint32 i = 0; i < dim; i++) dot += a[i] * b[i];
  return -dot;  // negated, so smaller = closer
}
```

`return -dot`. Negated. My ascending sort is right, and now I can write a relevance score for the dot metric that isn't a guess. Ten minutes of reading source beat a day of arguing with search results, and I get to say "I checked" instead of "I think."

There is a version of me that ships a dot relevance score based on the top Stack Overflow answer and moves on. The version that read the source ships the same feature and actually knows it's correct. And before I confirmed the sign, I shipped relevance scoring for cosine and euclidean and deliberately left dot out, with a one-line note saying the sign wasn't nailed down yet. Shipping the gap honestly beats shipping a guess and hoping.

## Testing a database integration without the database

Here's a constraint: I don't want a running MySQL just to run the tests, and I certainly can't require a HeatWave instance, since that's a paid managed cloud. But not testing the thing isn't an option either.

The answer is an in-memory backend that mirrors the real one. Same distance math (I copied the three functions straight from the source I'd just been reading), same filtering, same behavior, in pure Python over a dict. The vector store talks to a small `Store` interface. In production that's MySQL; in tests it's the in-memory one. All the logic that matters, filtering, MMR, IVF, hybrid fusion, relevance scoring, is backend-agnostic, so exercising it against the fake exercises the real code path.

The payoff I like: LangChain ships a standard integration test suite that every vector store is supposed to pass. I run it against the in-memory backend in CI, offline, on every push. So "behaves like a real LangChain vector store" isn't a claim I'm making, it's a test that's passing.

> **Limitation, stated plainly:** the actual SQL and the async driver can't be verified without a real database, same as any DB client. I test them against the query builders — the honest limit is in the README, not buried in a footnote.

"Every claim measured" only holds if you're loud about the ones you've deferred.

## Hybrid search, and why I fuse ranks instead of scores

Vector search is good at meaning and bad at exact tokens. Ask it for an error code like `E4021` or a name like `O'Brien` and semantic similarity just shrugs. Keyword search is the reverse. Hybrid search runs both and merges the results, and MySQL already has `FULLTEXT` keyword search built in, so the parts were sitting right there.

The trick is merging a cosine distance with a FULLTEXT relevance score. Different scales, different meanings, and squashing them into a shared range is fiddly and a little arbitrary. So I don't. I use reciprocal rank fusion: drop the scores, keep the ranks, and give each document `1/(k + rank)` summed across both lists. A doc that's 2nd on vectors and 1st on keywords beats one that's 1st in a single list and absent from the other. It's simple, it never has to reconcile the two scales, and it's what a lot of real search stacks use. The best fix for "these numbers aren't comparable" turned out to be to stop comparing the numbers.

## Two packages, one backend, and not abstracting too early

Then I built the LlamaIndex version, because the same MySQL engine should be usable outside LangChain. LlamaIndex has its own vector-store interface, different enough that you can't just reuse the LangChain class. But the storage layer under it, the SQL, the filters, the IVF, the in-memory fake, is identical.

My rule is three duplications before you extract a shared thing. Two consumers isn't three. So I didn't spin up a shared "core" package and re-plumb the already-published LangChain one to depend on it. That's a lot of coordination for two callers, and LlamaIndex users would rather not pull `langchain-core` into their dependency tree anyway. I copied the four backend files into the LlamaIndex package, unchanged.

Copying is a smell, I know. The way you keep it honest is a CI check that byte-compares the copies against the originals and fails the build if they drift. One source of truth, enforced by a test, without the premature abstraction. If a third consumer ever shows up, that's when a shared core earns its rent.

## The through-line

None of this is fancy. A VECTOR column, a distance function, and a careful amount of Python around them. What stuck with me is how often the honest move and the impressive-looking move point in opposite directions. Faking the ANN index would have demoed better. Guessing the dot sign would have shipped faster. Skipping the offline tests would have looked tidier in the diff.

The library is better because I did none of those, and I can point at every claim it makes and tell you exactly how I know it holds, or say plainly where I haven't checked. For something people are going to `pip install` and trust with their retrieval, that second half is the actual job.

Both are on PyPI: `langchain-shannonbase` and `llama-index-vector-stores-shannonbase`. If you're on MySQL and tired of running a second database just to search vectors, they might save you a service.
