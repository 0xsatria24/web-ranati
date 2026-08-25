# Conversation Log — RANATI Admin Panel & Website

Date: 2026-08-18

## 1. Admin panel registration — how it works

- Registration (`POST /api/register`) only works **once** — as soon as one admin account exists, the endpoint locks itself with `403 Registrasi ditutup`.
- After the first admin exists, new admins are added from inside the panel via `POST /api/users` (requires being logged in already).
- Recommendation: register the first admin immediately after deploying, since the register endpoint is open to whoever gets there first.

## 2. Industry-standard registration patterns discussed

- Invite-only / admin-provisioned accounts (no public self-register).
- Mandatory email verification.
- MFA (TOTP/email OTP).
- Stronger password policy (breach list check, bcrypt/argon2).
- Audit logging of auth events.
- Decision: implement **email verification** first, appropriate for current project scale.

## 3. Implemented: Email verification

- `db.js`: added `verified`, `verify_token`, `verify_expires` columns to `users` table (via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- `mail.js` (new): sends verification email via Resend API if `RESEND_API_KEY` is set; otherwise logs the verification link to console (dev fallback).
- `server.js`:
  - `/api/register` and `/api/users` now create accounts with `verified=false` and send a verification email instead of returning a login token immediately.
  - `GET /api/verify-email?token=...` — marks the account verified (24h token expiry).
  - `POST /api/resend-verification` — rate-limited resend, response doesn't leak whether an email exists.
  - `/api/login` rejects with `403` if the account isn't verified yet.
- `admin.html`: after registering, UI shows "check your email" message instead of auto-login.
- Fixed a real bug found during testing: an unhandled promise rejection inside the `readJson` async callbacks was crashing the entire Node process (not just failing the one request). Refactored `readJson(req, cb)` → `readJson(req, res, cb)` so errors are caught and turned into a clean `500` response instead of taking the server down. Updated all ~10 call sites in `server.js`.

## 4. Email delivery setup

- Installed `dotenv`, added `require("dotenv").config()` at the top of `server.js`.
- Created `.env` (gitignored) with the user's Resend API key.
- Explained Resend's sandbox restriction: without a verified domain, emails can only be sent **to** the Resend account owner's own email address, from `onboarding@resend.dev`. To send to arbitrary recipients, the user needs to verify their own domain in Resend and set `EMAIL_FROM` accordingly.
- Security note given to user: avoid pasting API keys directly into chat in the future.

## 5. Implemented: Gallery section

User requested a new "Gallery" section on the site, input entirely through the admin panel, with sub-sections chosen freely by the admin (not fixed categories).

- `server.js`: added `"gallery"` to `ALLOWED_COLLECTIONS` (reusing the existing generic `/api/collections/:name` CRUD), added gallery count to `/api/stats`.
- `admin.html`: new "Galeri" nav item + view, `COLLECTIONS` config entry with fields `subsection`, `title`, `desc`, `media` — reuses the existing generic CRUD list/form renderer used by Zones/News.
- `index.html`: new `#/galeri` page with nav links (desktop + mobile), added to the router's `known` pages array, empty `#gallery-groups` container for dynamic content.
- `site-content.js`: fetches `/api/collections/gallery`, groups items by `subsection` (free text, falls back to "Lainnya" if empty), renders each group as a heading + 3-column card grid.
- Verified via curl: `/api/collections/gallery` returns `[]`, nav links present in served HTML, `data-view="gallery"` present in admin.html.

## 6. Local dev server issues

- Repeated `EADDRINUSE :::5000` errors caused by a previous background `node server.js` instance still holding the port (once from an unhandled-rejection crash that didn't fully release the socket, once from a background task started by the assistant).
- Resolved each time via `netstat -ano | grep :5000` → `taskkill //PID <pid> //F`.
- User asked to kill the currently running server so they could start their own — done, port 5000 freed.

## Files touched this session (part 1)

- `db.js`
- `mail.js` (new)
- `server.js`
- `admin.html`
- `index.html`
- `site-content.js`
- `.env` (new, gitignored)
- `package.json` / `package-lock.json` (added `dotenv` dependency)

---

# Session 2026-08-18/19 — Security cleanup, Gallery follow-ups, Zona rework, SEO

## 7. Critical: leaked secrets in public GitHub repo

- Found `db-config.json` (DB password) and `users.json` (password hash + a still-valid session token) tracked in git and publicly readable via raw.githubusercontent.com (repo `0xsatria24/web-ranati` is public).
- Removed both from git tracking (`git rm --cached`), added to `.gitignore` (also added `node_modules`), committed and pushed.
- Flagged to user: files still exist in old git history unless history is rewritten; credentials/token should be rotated. User deferred that follow-up.

## 8. Code review pass — bugs found & fixed

- `db.js`: `ALTER TABLE users ADD COLUMN verified BOOLEAN NOT NULL DEFAULT false` would retroactively set `verified=false` on **pre-existing** admin accounts too, locking them out since login now requires `verified=true`. Fixed with a one-time backfill: `UPDATE users SET verified=true WHERE verified=false AND verify_token IS NULL` (targets only rows that never went through the new verify flow).
- `server.js` upload endpoint: added a MIME whitelist (`UPLOAD_EXT`: jpg/png/gif/webp/mp4/webm/ogg only) to block SVG/HTML uploads that could be stored-XSS same-origin; added a 100MB size cap (bumped up from an initial 15MB at user's request, since it's meant for video) and a per-admin upload rate limit.
- Found `contact.js` existed but was **never `<script>`-included** in `index.html` — the contact form silently did nothing. Added the script tag; contact form → `/api/messages` → admin inbox now works end-to-end.
- Found `admin.html`'s "Zona"/"Berita" CRUD collections only ever fed a small homepage preview grid (`home-zones-grid`/`home-news-grid`), and would **fully replace** the curated 6/3-card static homepage grids the moment any real item existed — the dedicated `#/zona` and `#/berita` listing pages were 100% hardcoded HTML, never reading from the database. This is why "adding a Zona" looked broken/disconnected. Fixed: homepage grids now stay permanently static (no more collection override); the dedicated listing pages (`#/zona`, `#/berita`) now render from the real collections instead.
- Found a caching bug: `site-content.js`/`contact.js` were served with `Cache-Control: public, max-age=3600`, so browsers kept running stale JS after every fix — user kept seeing old behavior ("ADD ZONA BELUM MUNCUL"). Fixed by excluding `.js` (not just `.html`) from long-lived caching in `serveStatic()`.

## 9. Per-zone detail pages (replacing the single hardcoded "Zona 1" page)

- User wanted each Zona item to have its own real page with content, not all rows linking to the one static Zona-1 page.
- Extended the hash router (`routeFromHash`/`show` in the `DCLogic` component class in `index.html`) to support a dynamic route pattern `#/zona/<id>`, mapped internally to a `data-page="zonaDetail"` template.
- Added the `zonaDetail` `<main>` template (hero title + gallery + description) and `renderZonaDetail(id)` in `site-content.js`, exposed as `window.renderZonaDetail` so the router can call it on navigation.
- `zona-list-full` rows and the homepage-adjacent zona slider now link to `#/zona/<id>` per item instead of a hardcoded `#/zona1`.

## 10. 3D ring carousel → simple slider

- User showed a screenshot of the old drag-to-rotate 3D ring carousel on `#/zona` (used `rotateY`/`translateZ` transforms) — side panels rendered mirrored/backwards, looked broken, and the ring never reflected real Zona data.
- Removed the ring entirely: state (`ringAngle`/`ringTarget`), `initRing()` method, the ring's per-frame update block inside `tick()`, and the `ringPrev`/`ringNext` handlers.
- Replaced with a plain horizontal `overflow-x:auto; scroll-snap-type:x` slider (`id="zona-slider"`), with `slidePrev`/`slideNext` handlers that just call `scrollBy()`. Made it dynamic too (`renderCollection("zona-slider", collections.zones, zonaSliderCard)`), so it now also reflects real admin-managed zones.

## 11. Zona detail image layout — no more cropped hero

- User's screenshot showed the zona-detail hero image as a full-bleed cropped background (like a typical hero banner) — they wanted media shown uncropped in the body instead, "berlaku untuk semuanya" (applies to all such cases).
- Reworked the `zonaDetail` template: title moved to plain text above the fold (no image behind it), media now rendered inside the content body at natural aspect ratio (`height:auto`, not `object-fit:cover`).

## 12. Zona content was static demo data, not real DB rows — seeded properly

- After the homepage-grid/collection-override fix (§8), the 6 previously-hardcoded zone cards "disappeared" once the user started adding real Zona entries, because the site now shows *only* real DB rows once any exist (no partial merge with the old static demo cards). This confused the user ("kenapa konten di zona ilang semua").
- Explained this is expected behavior (real data always fully replaces demo placeholders, same pattern as Berita/Gallery), then — per user's explicit request "isi konten2nya semuanya jangan hardcode lagi" — wrote a one-off `seed-zones.js` script (run once via `node seed-zones.js`, then deleted) that inserted the 6 original zone cards (Marina Bay, Hunian Eksklusif, Rekreasi, Traditional Market, Agro-Tourism, Komunitas) as real rows in the `collections` table, replacing a leftover test row. These are now fully editable from the admin panel instead of being baked into HTML.

## 13. Zona media: single image/video → multi-media gallery

- User: "di dalam isi zona nya bisa upload video dan gambar (media)" — wanted multiple photos/videos per zone, not just one.
- Changed the `zones` collection's `media` field from a single string to an array. Backward-compatible everywhere (`Array.isArray(item.media) ? item.media : (item.media ? [item.media] : [])`) so the 6 seeded zones (still single strings) keep working.
- `admin.html`: new field type `"gallery"` — renders all current media as thumbnails with a small ✕ remove button each, plus a `<input type="file" multiple>` "+ Tambah foto/video" control that uploads all selected files (via `Promise.all`, reusing the existing `prepareUpload()` client-side compressor) and appends their URLs to the array.
- `site-content.js`: `zonaSliderCard`/thumbnail rendering use `media[0]` as the cover image; `renderZonaDetail()` renders **all** media items in the detail page body (custom markup, not the shared `mediaTag()` helper, since that helper hardcodes `position:absolute`/`object-fit:cover` for video which would collapse a non-fixed-height wrapper — needed natural `height:auto` here per §11).
- `mediaPrev()` in `admin.html` was only detecting video via `data:video/` prefix; extended to also detect by file extension since gallery items are now real uploaded URLs, not always base64 data URIs.

## 14. Zona: added a real "body content" field, not just short description

- User: "di bagian zona harus ada text isi nya bukan deskripsi doang" — the existing `desc` field is short (used in preview cards/slider); needed a separate longer content field for the detail page.
- Added `body` field (`type:"area", rows:8`) to the zones config in `admin.html`, kept `desc` as-is for previews.
- `site-content.js` `renderZonaDetail()`: splits `item.body` on blank lines into `<p>` paragraphs, rendered in a new `#zonaDetail-body` container below the short description in the `zonaDetail` template (`index.html`).
- Also gave the generic `area` textarea renderer an optional `rows` config (`f.rows || 3`) since it previously always rendered a default-height single-purpose textarea regardless of expected content length.

## 15. English translation toggle

- User chose the **Google Website Translator widget** approach (not hand-written EN copy) for cost/speed reasons.
- Added an EN/ID toggle button (desktop navbar + mobile menu) that sets/clears the `googtrans` cookie and reloads the page; Google's translate script (`translate.google.com/translate_a/element.js`) does the actual translation. Google's own UI (banner, highlight) is hidden via CSS, leaving just the custom toggle button.

## 16. Upload size limits raised for video

- Initial upload validation used a 15MB cap; user said "batas ukurannya lebihin deh, buat video soalnya" → raised `UPLOAD_MAX_BYTES` to 100MB and the raw request-body cap in `readBody()` to 140MB (to account for ~1.37x base64 overhead on top of the 100MB binary limit).
- Flagged to user (not yet acted on): if this ever gets deployed to Vercel serverless, Vercel's own function body-size limit (much smaller than 100MB) would reject large uploads before this code even runs; true large-file support there would need direct-to-Vercel-Blob client uploads instead of routing bytes through the server. User hasn't confirmed Vercel vs. self-hosted deployment target yet.

## 17. SEO quick-win pass (sitemap/robots/meta)

- Explained the real constraint first: the site uses hash routing (`#/zona`, `#/berita`, …), so Google treats all of it as a single URL — a sitemap listing hash fragments would be misleading. User chose the "realistic quick win" option over restructuring routing to real paths.
- Added to `index.html` `<head>`: `<title>`, meta description, Open Graph tags, Twitter card tags, `canonical` link, `theme-color`, and a placeholder inline-SVG favicon (no real logo asset exists in the project yet). All URLs use an obvious `https://YOUR-DOMAIN.example/` placeholder pending a real production domain (user hasn't deployed/chosen one yet).
- New `robots.txt` (allow all + sitemap pointer) and `sitemap.xml` (deliberately just the one root URL, with an XML comment explaining why — hash fragments aren't separately crawlable).
- `server.js` `MIME` table was missing `.xml`/`.txt` entries (would've served as `application/octet-stream`) — added `application/xml`/`text/plain`.
- Added `PAGE_META` map + `updateMeta()` in the router (`index.html`) so `document.title`/meta-description change per route (helps browser tab + social share previews, not Google indexing per the constraint above). `renderZonaDetail()` in `site-content.js` also overrides title/description with the actual zone name once loaded.

## Local dev server notes (recurring throughout this session)

- Server was killed/restarted many times across the session (port 5000 conflicts, code changes to `server.js` requiring restart since Node doesn't hot-reload). Standard fix each time: `netstat -ano | grep :5000` → `taskkill //PID <pid> //F` → `node server.js` again.

## User instruction: keep this log updated going forward

- User asked (2026-08-19-ish): "setiap ada perubahan dan penambahan code auto save conversation ini ke conversation-log.md" — i.e., update this file after every code change from now on, not just on request.

## Files touched this session (part 2)

- `index.html` (router, zonaDetail page, homepage grid decoupling, slider, SEO head tags, PAGE_META)
- `site-content.js` (zonaFullRow/zonaSliderCard/renderZonaDetail, gallery media-array support, SEO title/meta sync)
- `admin.html` (gallery media field type, body field, textarea rows, mediaPrev extension detection)
- `server.js` (upload MIME whitelist + size limits + rate limit, JS no-cache fix, xml/txt MIME types, verified-account login gate)
- `db.js` (verified-column backfill for pre-existing accounts)
- `.gitignore` (added `db-config.json`, `users.json`, `node_modules`)
- `robots.txt`, `sitemap.xml` (new)
- `seed-zones.js` (temporary, created and deleted — one-off DB seed script)
- Removed from git tracking: `db-config.json`, `users.json`

---

## 18. Zona: added a real "body content" field (not just short description)

- User: "di bagian zona harus ada text isi nya bukan deskripsi doang" — added a separate `body` field (`type:"area", rows:8`) to the zones config in `admin.html`, kept `desc` for previews/cards.
- `site-content.js` `renderZonaDetail()` splits `item.body` on blank lines into `<p>` paragraphs into a new `#zonaDetail-body` container in the `zonaDetail` template (`index.html`).
- Gave the generic `area` textarea renderer an optional `rows` config (`f.rows || 3`).

## 19. Code review fixes: dead code + register rollback-on-email-failure

Ran `/code-review` against the accumulated working-tree diff. Two of three findings were fixed per user's explicit choice (third — `.ogv`/`.ogg` MIME mismatch for Ogg video — left as-is, low priority):

- **Dead code removed** (`index.html`): `componentWillUnmount()` still had `if (this.onResize) window.removeEventListener("resize", this.onResize)`, but `this.onResize` was only ever set inside `initRing()`, which had already been deleted when the 3D ring carousel was replaced with the slider (§10). The guard made it harmless but permanently unreachable — removed the line.
- **Register/add-admin rollback on email failure** (`server.js`): previously, `/api/register` and `/api/users` POST inserted the user row *then* sent the verification email — if the email send threw (Resend down/misconfigured), the row was already committed, so retrying registration for that email hit `409 Email sudah terdaftar` forever with no link ever received. Fixed by adding `createUserWithVerification(req, email, salt, derived)`: inserts the row, tries to send verification, and on failure `DELETE`s the just-inserted row before rethrowing — so a failed send now surfaces as a clean error and the email is immediately retryable. Both call sites (`/api/register`, `POST /api/users`) now use this helper instead of duplicating the insert+send logic.

## 20. Full website + admin panel critique

User asked for a broad critique of the live site and admin panel. Checked live state via API: `zones` had 6 seeded items, but `news`, `gallery`, and `content` (homepage text) were all empty (0 items/keys) — Berita and Galeri pages render as empty placeholders to real visitors. Also confirmed via grep: no security headers (`Content-Security-Policy`/`X-Frame-Options`/etc.) anywhere in `server.js`, no test script beyond the `package.json` placeholder, no search/filter/pagination anywhere in `admin.html`, 6 images still have empty `alt=""`, and the EN/ID toggle has a hard dependency on `translate.google.com` with no fallback if that's blocked.

Findings grouped and prioritized (not yet acted on, pending user's next pick):
- **Critical**: Berita/Gallery/homepage-text content still empty; Investasi/Kontak pages are still 100% hardcoded (never wired to the CMS); `YOUR-DOMAIN.example` placeholders (4 spots) still need a real domain before deploy.
- **Medium**: missing security headers; Google Translate CDN dependency with no fallback; empty alt text on 6 images; env vars need to be set on the hosting platform (not just local `.env`) before deploy.
- **Low**: hash-routing SEO tradeoff (already discussed/accepted); admin panel had no search/filter (this is what got picked next, see §21), no pagination on `/api/messages` or collections, no automated tests, no draft/incomplete-item badges, no "view on site" shortcut per item, destructive actions still use bare `confirm()`, multi-file gallery upload has no per-file progress/error UI, no activity log, WhatsApp contact number in footer is empty so the floating WA button never shows.

## 21. Admin panel: search/filter added

User picked search/filter as the next fix from §20's list.

- `admin.html`: added a search `<input>` (`data-search="<collection>"`) above each of the four list views — Pesan Masuk, Zona, Berita, Galeri — plus a small result-count hint span (`searchCount-<name>`) next to each.
- Added `searchState` (module-level map of collection name → current query) and `matchesSearch(item, cfg, q)`, which checks the item's `titleField` plus every non-media/non-gallery field value (case-insensitive substring match). `renderList(cfg)` now filters `colState[cfg.name]` through this before rendering — filtering is purely client-side over data already fetched, no new API calls per keystroke. Because `renderList` already gets called by every existing mutation path (`createItem`/`persistItem`/`deleteItem`/`fetchCollection`), the search filter automatically stays in sync without touching those call sites.
- `loadMessages()` was split into a fetch step (populates a new `messagesState` array) and a `renderMessages()` step that applies the same kind of filter (matches name/email/phone/body) — needed a separate path since messages aren't part of the generic `COLLECTIONS`/`colState` system.
- Empty states are now distinguished: "belum ada X sama sekali" vs. "tidak ada yang cocok dengan pencarian" when a filter yields zero results but the underlying list isn't actually empty.

---

# Session 2026-08-25 — Full-project bug sweep, two P0 fixes

## 22. Full-project bug sweep (16 findings)

User asked to "find the bugs in this project" and chose a **whole-codebase sweep** over the pending-diff review — the working tree only held a stray blank line in `setup-db.js`, so `/code-review` alone would have come back empty. Both ran: the sweep by hand over `server.js`, `db.js`, `setup-db.js`, `mail.js`, `contact.js`, `site-content.js`, `admin.html`, `vercel.json`; `/code-review` in parallel, which widened its own scope to the last commit and contributed finding §23.2 plus three minor items.

16 findings, ranked. Two P0 (fixed, see §23). P1: `setup-db.js` connecting to the wrong server under `DATABASE_URL`; `readBody` multibyte corruption; spoofable `X-Forwarded-For`; `vercel.json` likely not deploying the backend at all. P2 (10 items): plaintext `verify_token`, auto-verify race in `init()`, `GET /%` returning 500, `"[object Object]"` content values, unservable upload filenames, SSL only applied to `connectionString`, `/api/stats` asset count meaningless on Vercel, per-email limiter enabling admin lockout, attacker-triggerable global `rlHits.clear()`, possibly-missing `style-src` origin for Google Translate.

Full report kept out of the repo (scratchpad only) — the durable record is this log plus the commit.

## 23. Fixed: two P0 bugs (`server.js`, commit `992944d`)

Branch `fix/p0-verifikasi-email-dan-token-sesi`, pushed to origin. Only `server.js` committed — the unrelated blank-line change in `setup-db.js` was deliberately left uncommitted.

**23.1 — Email verification page was dead JavaScript, locking out the first admin.**
The inline `<script>` on `GET /api/verify-email` never closed its `onclick` function: the trailing `;});});` is fully consumed by `function(b)`, `.then(`, `function(r)`, and `.then(`, leaving nothing to close `onclick=function(){`. The whole block was a `SyntaxError: Unexpected end of input`, so the handler was never attached and the "Verifikasi sekarang" button did nothing. Since `POST /api/login` rejects `verified=false` accounts, **no admin could ever complete verification through that page** — the flow added back in §3 had been broken the whole time. This explains the still-unverified `muhammadsatria2412@gmail.com` row in the DB. Fix: append `};`. Confirmed by extracting the script from the route's real HTTP response and running `node --check` (fails before, passes after).

**23.2 — Session-token hashing provided zero protection (found by `/code-review`).**
`userFromToken()` had a "legacy session upgrade" path: on a hash miss it ran `UPDATE tokens SET token=sha256(cookie) WHERE token=cookie RETURNING ...`. Because the stored value *is* the hash H, an attacker who could read the `tokens` table — the exact threat the hashing was introduced for (backups, logs, DB console; see the comment added in commit `5d8bdcf`) — only had to send H itself as the cookie: `sha256(H)` misses, the raw-match then hits row `token = H`, and they are authenticated as admin. Two side effects: the `UPDATE` rewrote the row to `sha256(H)`, silently breaking the legitimate owner's session, and every junk cookie triggered an unauthenticated DB write.

Removed the fallback entirely; matching is now hash-only. Trade-off accepted: pre-hashing sessions stop working and their owners must log in again — the DB did contain one such legacy row (a 48-hex raw token). Left an explicit comment warning against reintroducing the path.

Verified against a running server: stored-hash-as-cookie → `401` (would have been `200` as admin); legacy raw token → `401`; a valid cookie (inserted as a temporary row, then deleted) → `200`. Deliberately did *not* run the pre-fix code against the real DB, since the vulnerable `UPDATE` would have mutated live token rows.

## 24. Deployment status clarified

User confirmed the site is **not yet deployed to Vercel** — corroborated by `YOUR-DOMAIN.example` still sitting in `sitemap.xml`/`robots.txt` and `.env` holding only `RESEND_API_KEY` (no `DATABASE_URL`; local Postgres via `db-config.json`). This reframes P1: `vercel.json` and `setup-db.js` are not live vulnerabilities but first-deploy landmines — on deploy they would produce 404s on every `/api/*` **and** serve `server.js`/`db.js` as static source, bypassing the `PUBLIC_FILES` allowlist built in commit `2bfc23a`. Likely root cause: `api/index.js` is referenced in the `server.js:719` comment but `git log --all -- api/` shows it was never created, and `vercel.json` has no `rewrites`. `server.js` already ends with `module.exports = handler`, so the fix should be small. Not yet acted on.

## Files touched this session

- `server.js` (verify-email inline script closure; removed raw-token match in `userFromToken`)
- `conversation-log.md` (this entry)
- Not committed: `setup-db.js` (pre-existing stray blank line, unrelated)
