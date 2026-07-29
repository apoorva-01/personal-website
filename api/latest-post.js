// api/latest-post.js
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content", "posts");
const SITE = "https://www.apoorvaverma.in";

function readLatestPost() {
  const files = readdirSync(CONTENT).filter((f) => f.endsWith(".md"));
  const posts = files.map((f) => matter(readFileSync(join(CONTENT, f), "utf8")).data);
  posts.sort((a, b) => String(b.published).localeCompare(String(a.published)));
  return posts[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const post = readLatestPost();
  if (!post) {
    res.status(404).json({ error: "No posts found." });
    return;
  }

  res.status(200).json({
    title: post.title,
    excerpt: post.excerpt || "",
    slug: post.slug,
    url: `${SITE}/posts/${post.slug}`,
  });
}
