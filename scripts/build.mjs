#!/usr/bin/env node
// Build: copy public/ to dist/ and regenerate sitemap.xml from the pages on disk.
// lastmod comes from the last git commit that touched each page, falling back to
// the file's mtime when git history is unavailable.
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const distDir = join(root, "dist");
const ORIGIN = "https://exportframes.com";

async function gitDate(file) {
  try {
    const { stdout } = await run("git", ["log", "-1", "--format=%cs", "--", relative(root, file)], {
      cwd: root,
    });
    const value = stdout.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value, source: "git" };
  } catch {
    // git missing or no history yet
  }
  const info = await stat(file);
  return { date: info.mtime.toISOString().slice(0, 10), source: "mtime" };
}

async function findPages(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await findPages(full, out);
    } else if (entry.name === "index.html") {
      out.push(full);
    }
  }
  return out;
}

function urlFor(pageFile) {
  const rel = relative(distDir, pageFile).split(sep).join(posix.sep);
  const dir = posix.dirname(rel);
  return dir === "." ? "/" : `/${dir}/`;
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(publicDir, distDir, { recursive: true });

  const pages = (await findPages(distDir)).sort((a, b) => {
    const aDepth = relative(distDir, a).split(sep).length;
    const bDepth = relative(distDir, b).split(sep).length;
    return aDepth - bDepth || a.localeCompare(b);
  });

  const entries = [];
  for (const page of pages) {
    const { date, source } = await gitDate(page);
    entries.push({ loc: ORIGIN + urlFor(page), lastmod: date, source });
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of entries) {
    lines.push("  <url>");
    lines.push(`    <loc>${entry.loc}</loc>`);
    lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
    lines.push("  </url>");
  }
  lines.push("</urlset>", "");
  await writeFile(join(distDir, "sitemap.xml"), lines.join("\n"), "utf8");

  for (const entry of entries) {
    console.log(`  ${entry.loc}  lastmod=${entry.lastmod} (${entry.source})`);
  }
  console.log(`wrote dist/sitemap.xml with ${entries.length} pages`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
