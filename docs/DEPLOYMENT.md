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

## Measurement: GA4, installed 2026-09-18

The owner changed the measurement rule for this site on 2026-09-18 from "Cloudflare Web Analytics
only" to **GA4 only**. What was done:

- **Property created through the Analytics Admin API** under the `工具站` account
  (`accounts/407092253`): property `554799614` "Export Frames", `Asia/Shanghai`, `USD`,
  `TECHNOLOGY` — the same shape as `My Chord Finder` and `WatchToText`. Web data stream
  `properties/554799614/dataStreams/15797880124` for `https://exportframes.com`, measurement ID
  **`G-X1L2MKTHPT`**.
- Retention was read back for all three properties in the account: event data `TWO_MONTHS`,
  user data `FOURTEEN_MONTHS`, `resetUserDataOnNewActivity: true`. The new property matches; nothing
  was changed.
- **`public/analytics.js`** carries the tag, following the pattern in `chord-tools/src/analytics.ts`:
  consent gate first, tag loaded only after **Allow analytics**, decline remembered in local storage,
  `allow_google_signals: false`, `allow_ad_personalization_signals: false`, and `page_location`
  reduced to origin + path so query strings are never sent.
  One deliberate difference from chord-tools: a visitor who already allowed on an earlier visit is
  measured immediately on later page loads instead of waiting for a first interaction or an 8 s
  timeout.
- The tool itself is untouched: `app.js` is still byte-identical to the local build
  (`md5 337e8058cb4347e83de6d61385f7599e`), and no funnel events were added, so this site measures
  page views only. The privacy page was rewritten to describe GA4, its cookies, its retention and the
  consent behaviour before this shipped.

**Region-gated, changed 2026-09-18 (owner's rule: the gate should only appear where it is needed).**
`functions/api/geo.js` returns `{"country":"XX"}` from `request.cf.country` — Cloudflare's own
reading of the connection, so no third-party geolocation is involved and nothing about the
visitor is sent anywhere. `analytics.js` asks it once per session, then:

| Visitor country | Behaviour |
| --- | --- |
| EEA (EU 27, Iceland, Liechtenstein, Norway), UK, Switzerland | Consent notice; no Google request and no cookie until **Allow analytics** |
| Any other known country | Measured without a notice (no prior consent required there) |
| `XX` (Cloudflare could not tell, e.g. Tor) or the geo call fails | Falls back to asking |

Tested locally against a mock geo endpoint before shipping: DE, FR, GB, CH → notice shown with 0
Google requests before the choice; US, JP → no notice and measurement running; XX → notice; geo
endpoint returning 500 → notice. The frame extractor still produced 6 stills with the notice on
screen. (Local run 2026-09-18; the deployed behaviour was then checked through the live
`/api/geo`.)

Verified in Chrome against the built site (2026-09-18):

| Check | Result |
| --- | --- |
| First visit, no choice made yet | Consent bar shown; **0** requests to `googletagmanager.com` / `google-analytics.com`; **0** cookies |
| After "No thanks" | Still 0 Google requests, 0 cookies; the bar does not return after reload |
| After "Allow analytics" | `GET gtag/js?id=G-X1L2MKTHPT` then `POST https://www.google-analytics.com/g/collect?v=2&tid=G-X1L2MKTHPT…`; `_ga` and `_ga_X1L2MKTHPT` then appear |
| Query string | Loading `/?utm_source=should-not-appear` produced one collect hit with `dl=http://…/` — no query string in the payload |
| Returning allowed visitor | No bar, tag loads on page load |
| Tool with the bar on screen | 6 stills, PNG download 53,243 bytes, valid signature |

The Google Analytics dashboard itself was not inspected; the claims above come from the network
traffic the page produced, not from reports.

## Mail records (added 2026-09-18)

Following the working pattern on `findkeybpm.com`, which receives through Spaceship forwarding
while its DNS lives on Cloudflare, the same records were added to this zone:

| Type | Name | Content | Priority |
| --- | --- | --- | --- |
| MX | `exportframes.com` | `mx1.efwd.spaceship.net` | 10 |
| MX | `exportframes.com` | `mx2.efwd.spaceship.net` | 20 |
| TXT | `exportframes.com` | `v=spf1 include:spf.efwd.spaceship.net ~all` | — |

Receiving needs only the alias to exist at Spaceship. Sending *as* the address is a separate,
later job (Brevo SMTP + Gmail send-as was how findkeybpm did it).

## What the sibling sites actually do (checked 2026-09-18)

Looked at how the other sites in this workspace handle the same two problems, before choosing a
route here:

- **Mail**: `findkeybpm.com` publishes `contact@findkeybpm.com` and receives it through Spaceship
  forwarding. `mychordfinder.com` publishes `contact@mychordfinder.com` but its zone has **no MX
  record at all**, so that address cannot currently receive mail.
- **Measurement**: the account has five Cloudflare Web Analytics sites
  (`dressmaker.wiki`, `honeycombworldbeyond.wiki`, `mistriafans.com`, `mychordfinder.com`,
  `tinyeden.wiki`), all with `auto_install: true`. Fetching those four live domains returns **no
  `cloudflareinsights` beacon in the served HTML**, and every Pages project in the account has
  `build_config.web_analytics_tag: null` — the field Cloudflare uses to inject the beacon into a
  Pages site. So the existing Web Analytics sites are not collecting anything today. `watchtotext.com`
  ships Google Tag Manager instead, and `mychordfinder.com` runs consent-gated GA4 from its bundle.
  This is why the beacon is being wired manually here rather than relying on auto-install.

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

Nothing is currently blocked on the owner.

## Mail: contact@exportframes.com — configured and delivery-tested

- Records live in the Cloudflare zone (see the table above).
- The forwarding rule was created in the Spaceship dashboard (Domain Manager → `exportframes.com` → Email forwarding → alias `contact` → destination `muke1838@gmail.com`), the same mechanism `findkeybpm.com` uses. Spaceship exposes no API for aliases.
- **End-to-end delivery was tested, not assumed**: a message was sent from `contact@findkeybpm.com` through Resend (id `01a0b09f-4d39-70ed-b289-ecb8a8588ead`) to `contact@exportframes.com`, and the Gmail API then found it in the destination inbox with header `Delivered-To: muke1838@gmail.com` (received Thu, 17 Sep 2026 18:27:05 +0000). Only after that did the contact page publish the address.
- Cloudflare's zone-level **Email Address Obfuscation** (Scrape Shield) rewrote the `mailto:` link into `/cdn-cgi/l/email-protection#…` and rendered `[email protected]` for non-JavaScript visitors. The address is now wrapped in `<!--email_off-->` … `<!--/email_off-->`, the documented opt-out, so the served HTML carries the plain address like `findkeybpm.com` does.
- Still not done: **sending as** the address. Replying currently comes from the Gmail account.

### Sending as contact@exportframes.com — in progress (2026-09-18)

Goal: a reply leaves Gmail with `contact@exportframes.com` in the From line, the way
`findkeybpm.com` does it. What the sibling site actually uses was read from Gmail's
**Send mail as** page and from public DNS:

| Piece | findkeybpm.com | exportframes.com now |
| --- | --- | --- |
| Gmail alias | `contact@findkeybpm.com`, relay `smtp-relay.brevo.com:587`, TLS | not created yet |
| SPF | `v=spf1 include:spf.efwd.spaceship.net ~all` | same |
| Brevo code (TXT @) | `brevo-code:62d3a95592f458746154ffcf5c2c4eac` | added, same value (account-level) |
| DKIM 1 (CNAME) | `brevo1._domainkey` → `b1.findkeybpm-com.dkim.brevo.com` | `brevo1._domainkey` → `b1.exportframes-com.dkim.brevo.com`, added |
| DKIM 2 (CNAME) | `brevo2._domainkey` → `b2.findkeybpm-com.dkim.brevo.com` | `brevo2._domainkey` → `b2.exportframes-com.dkim.brevo.com`, added |
| DMARC (TXT _dmarc) | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | added, same value |

State of the Brevo side: `exportframes.com` is added in the Brevo account (Try3AM) through the
"Add domain" wizard, set up as **Manual** so the records are written here rather than letting Brevo
into the DNS account. Brevo's own check reported **DKIM 2 ✅ and DMARC ✅** and **DKIM 1 mismatch** —
that check ran before the correct `brevo1` name was used (the first attempt wrote `brevo._domainkey`,
which was wrong and has been deleted). Both DKIM CNAMEs **now resolve from public DNS**
(re-checked 2026-09-19 03:40 CST), so Brevo's re-check should pass; it had been reading a cached
"no such record" answer while the records were minutes old.

Also note for whoever continues: Resend is **not** an option without paying — the account is at its
3-domain limit and adding a fourth needs the $20/month Pro plan. That was left alone.

Remaining steps, in order: re-run **Verify records** / **Authenticate domain** in Brevo; copy the
SMTP key from Brevo → SMTP & API; add the alias in Gmail (Send mail as → `contact@exportframes.com`,
`smtp-relay.brevo.com`, port 587, TLS) and click the confirmation link that arrives at
`contact@exportframes.com` (it forwards to the Gmail inbox, so the link can be read from the Gmail
API); then send a real message from the alias and read the `Authentication-Results` header to prove
SPF/DKIM.
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
