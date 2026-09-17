# exportframes.com

Source for **Export Frames** — a browser-only tool that pulls still frames out of a
local video file. The video is decoded in the visitor's tab and is never uploaded.

Live: <https://exportframes.com> (custom domain attached to the Cloudflare Pages
project `exportframes`).

## Pages

| URL | File |
| --- | --- |
| `/` | `public/index.html` — the frame extractor |
| `/about/` | `public/about/index.html` |
| `/privacy/` | `public/privacy/index.html` |
| `/contact/` | `public/contact/index.html` |
| `/robots.txt` | `public/robots.txt` |
| `/sitemap.xml` | generated into `dist/` at build time |
| any unknown path | `public/404.html`, served with a real 404 status |

## Layout

```
public/            static files, copied to dist/ as-is
public/analytics.js  GA4 behind a consent gate (no tag and no cookie before consent)
scripts/build.mjs  copies public/ → dist/ and regenerates sitemap.xml
```

`app.js` is the frame extractor and is byte-identical to the local build it came from —
measurement deliberately sits in its own file so the tool itself is untouched.

`/sitemap.xml` is not hand-maintained: `scripts/build.mjs` walks every
`index.html` under `public/`, so adding a page adds its URL on the next build.
Each entry's `lastmod` is the date of the last git commit that touched that page
(file mtime when git history is unavailable).

## Build

```bash
node scripts/build.mjs      # writes dist/
```

No dependencies, no framework. Node 18+.

## Preview locally

```bash
node scripts/build.mjs
python3 -m http.server 5405 --bind 127.0.0.1 --directory dist
# open http://127.0.0.1:5405/
```

Serve `dist/`, not `public/`: the sitemap only exists after a build, and 404
handling only matches production when the server is given a real 404 page.

## Deploy

```bash
node scripts/build.mjs
npx wrangler pages deploy dist --project-name=exportframes --branch=main
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment.
The deploy goes to the `exportframes` Pages project; `exportframes.com` is attached
to that project, and zone-level **Always Use HTTPS** is on.

## Notes

- The tool page's behaviour is intentionally unchanged from the local build it grew
  out of. Only page chrome (canonical URL, favicon, footer links) and the shared
  stylesheet were touched when it moved here.
- Decoding is whatever the visitor's browser already supports. The tool reports a
  clear error for containers it cannot play instead of guessing.
- Measurement is Google Analytics 4 only (`public/analytics.js`, measurement ID
  `G-X1L2MKTHPT`). The consent gate appears **only where a choice is required** — EEA,
  UK, Switzerland — where nothing is fetched or stored until the visitor presses
  **Allow analytics**. Elsewhere the page is measured without a notice. The country
  comes from `functions/api/geo.js`, which reports Cloudflare's own view of the
  connection; no third-party lookup is involved. An unknown country or a failing geo
  lookup falls back to asking. No other analytics or ad scripts are present, and no
  Cloudflare Web Analytics beacon is installed.
- Deployment facts, verification evidence and the open items live in
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
