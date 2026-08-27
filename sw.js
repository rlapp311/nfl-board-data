/* GCIndycate board — offline shell.
 *
 * Two caches, two policies:
 *   SHELL  the board itself and its icons. Cache-first, because the HTML is
 *          one self-contained 850KB file that only changes when we publish.
 *   DATA   the snapshot JSONs. Network-first with a cached fallback, so a
 *          phone with no signal still shows the last numbers it saw and the
 *          board can stamp them as stale.
 *
 * The pool card is deliberately NOT cached: picks are the one thing where a
 * stale answer is worse than no answer.
 */
const VERSION = "v3";
const SHELL = "gci-shell-" + VERSION;
const DATA = "gci-data-" + VERSION;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(SHELL)
      // addAll is all-or-nothing; one 404 would leave nothing cached.
      .then(c => Promise.all(SHELL_FILES.map(f => c.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

const isData = url => /-snapshot\.json/.test(url) || /\/nfl-board-data\//.test(url);

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = req.url;

  // Never touch the pool endpoint -- always live, never cached.
  if (url.indexOf("script.google.com") >= 0) return;

  if (isData(url)) {
    e.respondWith(
      fetch(req)
        .then(res => {
          // Only a real answer is worth keeping. Without this an error page --
          // a 404 for a file that was never published, say -- got stored and
          // then served back forever as the "offline fallback".
          if (res && res.ok) {
            // Cache under a cache-buster-free key so the fallback is findable.
            const key = url.split(/[?&]_cb=/)[0];
            const copy = res.clone();
            caches.open(DATA).then(c => c.put(key, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.open(DATA)
            .then(c => c.match(url.split(/[?&]_cb=/)[0]))
            .then(hit => hit || new Response("{}", { headers: { "Content-Type": "application/json" } }))
        )
    );
    return;
  }

  // The board document: network-first, so a republished board lands on the very
  // next reload rather than the one after it. The cache is the offline fallback,
  // not the default answer.
  const isDoc = req.mode === "navigate" || /\/(index\.html)?(\?|$)/.test(new URL(url).pathname + (new URL(url).search || ""));
  if (isDoc) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // Icons and manifest: cache first, refresh in the background.
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) {
        fetch(req).then(res => {
          if (res && res.ok) caches.open(SHELL).then(c => c.put(req, res)).catch(() => {});
        }).catch(() => {});
        return hit;
      }
      return fetch(req).catch(() => caches.match("./index.html"));
    })
  );
});
