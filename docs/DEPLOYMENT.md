# Deployment record — exportframes.com

Written 2026-09-18 (CST). Facts below were observed on this machine unless a source
is named. Anything still open is listed at the end.

## Where it lives

| Thing | Value |
| --- | --- |
| Domain | `exportframes.com` (apex canonical; `www` also attached) |
| Registrar | Spaceship — registered 2026-09-17T17:08:10Z, expires 2027-09-17 |
| Nameservers | `aida.ns.cloudflare.com`, `drew.ns.cloudflare.com` (set through the Spaceship API) |
| DNS | Cloudflare zone `4f5741c5e90d2e9840b8c4d663497c8d` (account `Muke1838@gmail.com's Account`) |
| Site source | https://github.com/muke1838-cloud/exportframes.com (public) |
| Hosting | Cloudflare Pages project `exportframes`, direct upload (no Git auto-build) |
| Live | https://exportframes.com/ |

## What was actually done

1. **Zone created** through the Cloudflare API (`type: full`, `jump_start: false`). It came back
   `pending` with the `aida` / `drew` pair, the same pair every other zone in this account uses.
2. **Nameservers changed at Spaceship** through their API (`PUT /v1/domains/exportframes.com/nameservers`,
   `provider: custom`). Read-back confirmed the two Cloudflare hosts. Spaceship held zero DNS
   records for the domain, so nothing was lost in the switch. Zone went `active` in about 90 seconds;
   `dig @8.8.8.8 NS exportframes.com` and `@1.1.1.1` both return the Cloudflare pair.
3. **Pages project created** (`POST /accounts/{id}/pages/projects`) and the first deploy pushed with
   `npx wrangler pages deploy dist --project-name=exportframes --branch=main`.
   - The Git-connected variant of the same call fails with `8000011 — internal issue with your
     Cloudflare Pages Git installation`, so this project uses direct upload like the other projects
     in the account.
4. **Custom domains attached** (`exportframes.com`, `www.exportframes.com`). Cloudflare did **not**
   create the DNS records automatically for this zone — both stayed `pending` with an empty record
   list — so the two proxied CNAMEs to `exportframes.pages.dev` were created explicitly. Certificates
   then issued and both hostnames serve 200 over TLS (`ssl_verify_result=0`).
5. **HTTPS is forced already**: `http://exportframes.com/` and `http://www.exportframes.com/` both
   return `301` to their `https://` form. No zone setting had to be changed (the API token cannot
   read or write zone settings anyway — `always_use_https` returns code 9109/10000).
6. **Search Console**: the domain property was verified through the `siteVerification` API with
   `DNS_TXT`. Google returned the resource `dns://exportframes.com` with
   `owners: ["muke1838@gmail.com"]`. The TXT record
   (`google-site-verification=VmyFh6myQGkz6UsdbAqV5p-xASvHo7pY3PBr-r5arWk`) lives in the zone with a
   120 s TTL and is visible through Google's and Cloudflare's public resolvers.
   - Verifying alone did **not** make the property appear in Search Console: `sites.list` still had 11
     properties and the sitemap call returned `403 … insufficient permission for site`. The property
     appeared only after `PUT /webmasters/v3/sites/sc-domain%3Aexportframes.com` (the Search Console
     API's *add site* call) returned `204`.
   - Sitemap submitted with `PUT /webmasters/v3/sites/sc-domain%3Aexportframes.com/sitemaps/{feed}` →
     `204`. Read-back at 2026-09-17T17:40Z:
     `lastSubmitted 17:40:34Z`, `lastDownloaded 17:40:35Z`, `isPending false`, `errors 0`,
     `warnings 0`, `submitted 4`, `indexed 0`. Google fetched it; nothing is indexed yet and none is
     claimed.

## Verified after launch

Through Chrome (Playwright, `--host-resolver-rules` used only to bypass this Mac's stale negative
DNS cache) against `https://exportframes.com`:

- `/`, `/about/`, `/privacy/`, `/contact/` — all `200`, expected headings present, footer links to
  all four pages on every page.
- `/robots.txt` — `200`, exactly three lines, sitemap URL without a trailing slash.
- `/sitemap.xml` — `200`, four `<loc>` entries, each with `<lastmod>`.
- `/definitely-not-a-page-42` — real `404` (navigation `responseStatus = 404`) serving `404.html`,
  not a redirect home.
- The tool itself over the live domain: a 6 s 640×360 H.264 clip produced **6 stills**; a single PNG
  downloaded at 53,243 bytes with a valid PNG signature; the ZIP downloaded at 311,254 bytes.
- During that run the page made **7 requests, all `GET`, all to `exportframes.com`** — no POST and no
  third-party request, which is the behaviour the privacy page claims.
- `390 px` and `320 px`: horizontal overflow `0` on all four pages.
- No page or console errors except the ones caused by the deliberate 404 navigation.

Public reachability: fetched successfully through a third-party HTTP proxy (allorigins) which
returned the correct `<title>`, and directly against both Cloudflare anycast addresses
(`104.21.19.119`, `172.67.186.36`) with valid certificates.

## Still open

| Item | Why it is open | What closes it |
| --- | --- | --- |
| Cloudflare Web Analytics | Neither API token in `~/.hermes/.env` may create a Web Analytics site (`POST /accounts/{id}/rum/site_info` → `Authentication error`). The five existing Web Analytics sites in the account are bound to other zones; reusing one of their tokens here would mix two sites' numbers. | Dashboard: Web Analytics → Add a site → pick `exportframes.com` (auto-install, as the other five use), **or** a token with Account → Web Analytics → Edit. Then the beacon snippet goes into the four pages. |
| `contact@exportframes.com` | Email Routing is denied to both tokens (`/accounts/{id}/email/routing/addresses` and `/zones/{id}/email/routing` both `Authentication error`). The contact page therefore does not publish the address as working. | Dashboard: Email Routing on the `exportframes.com` zone → add the destination mailbox → click the verification mail → create the `contact@` rule. Then the address is added to the page. |
| `www` → apex redirect | A Redirect Rule needs zone ruleset permission, which neither token has. `_redirects` in Pages cannot match on hostname, so it cannot do this either. Currently both hostnames serve the site and the canonical tag points at the apex. | A token with Zone → Rules, or one redirect rule in the dashboard. |
| Git auto-deploy | Cloudflare's GitHub App installation for this account is broken (error `8000011`), so pushes do not build by themselves. | Reinstall the Cloudflare Pages GitHub App, then switch the project's source to the repo. |

## Commands worth keeping

```bash
cd /Users/Muke/Documents/Products/工具站/exportframes.com
node scripts/build.mjs
npx wrangler pages deploy dist --project-name=exportframes --branch=main
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from
`/Users/Muke/Documents/Products/Deploy/env/cloudflare.env`. Secrets are not stored in this repo.
