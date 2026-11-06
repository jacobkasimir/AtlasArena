import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]
  ))).flat();
}
const files = (await walk("dist")).filter(f => !f.endsWith("/sw.js"));
const urls = files.map(f => "/" + f.slice(5));
const hash = createHash("sha256");
for (const f of files.sort()) hash.update(await readFile(f));
const name = "atlas-static-" + hash.digest("hex").slice(0, 16);

await writeFile("dist/sw.js", `
const CACHE = ${JSON.stringify(name)};
const ASSETS = ${JSON.stringify(urls)};
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener("message", e => {
  if (e.data === "ACTIVATE") self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys())
      if (k.startsWith("atlas-static-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", e => {
  const r = e.request;
  const u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== self.location.origin) return;
  if (u.pathname.startsWith("/api/") || r.headers.has("authorization")) return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).catch(() => caches.match("/index.html")));
    return;
  }
  if (ASSETS.includes(u.pathname) && !u.search) {
    e.respondWith(caches.match(u.pathname).then(cached => cached || fetch(r)));
  }
});
`);
