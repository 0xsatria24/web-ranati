# RANATI BELITUNG — Home Page
## GSAP / Framer Motion Animation Notes

Every animatable section is already tagged in the HTML with a
`data-animate="..."` attribute so GSAP can target it directly without
extra markup changes later.

```
data-animate="header"      → .site-header
data-animate="hero"        → .hero
data-animate="stats"       → .stats
data-animate="project"     → .project
data-animate="masterplan"  → .masterplan
data-animate="zones"       → .zones
data-animate="investment"  → .investment
data-animate="news"        → .news
```

General rules:
- Ease: `power3.out` for entrances, `power2.inOut` for scroll-linked moves.
- Duration: 0.8–1.2s for entrances, nothing longer than 1.4s.
- Stagger: 0.06–0.1s between repeated items (stats, zone cards, news cards).
- Respect `prefers-reduced-motion`: wrap every ScrollTrigger/timeline in
  `gsap.matchMedia()` and skip motion, or reduce to opacity-only, when the
  user has reduced motion enabled.

---

### 1. Header
- On load: `logo` and `.nav-link`s fade + drop in 12px, staggered 0.05s,
  after the hero title reveal starts (delay ~0.3s).
- On scroll: header stays `position: fixed`; no shrink needed since it
  already uses `mix-blend-mode: difference` to stay legible over both
  light and dark sections — don't animate background, only opacity of the
  underlying page state.

### 2. Hero
- Page load timeline (run once, `defer` until fonts ready):
  1. `.hero__media` clip-path reveals from `inset(0 0 100% 0)` → `inset(0)`,
     0.9s, `power4.inOut`.
  2. `.eyebrow` fades up 10px, 0.5s, starts at 0.2s.
  3. `.hero__title` — split into lines (`SplitText` or 4 manually wrapped
     spans), each line translateY(110%) → 0 with a 0.08s stagger, 0.9s
     `power3.out`, starts at 0.35s.
  4. `.hero__body` and `.btn` fade up 12px, 0.6s, starts at 0.75s.
  5. `.scroll-cue` fades in last, then loops a subtle 12px vertical pulse
     on `.scroll-cue__line` (yoyo, infinite, 1.4s).
- Parallax: `.hero__media img` translateY -4% → 4% tied to scroll via
  ScrollTrigger `scrub: true` for a slow depth effect. Keep the image
  itself larger than its frame (`scale(1.08)` at rest) so parallax never
  exposes an edge.

### 3. Floating Statistics
- ScrollTrigger start `top 85%`.
- `.stats__grid` translateY 40px → 0 + fade, 0.8s, `power3.out`.
- Each `.stats__value` counts up from 0 to its final number with a GSAP
  number tween (`innerText` via `snap`) over 1.2s, staggered 0.1s per
  item, only for numeric values (skip "World").
- `.stats__divider` scaleY 0 → 1 (transform-origin center), 0.6s,
  staggered with the values.

### 4. Featured Project
- `.project__media`: same clip-path reveal pattern as hero, but
  bottom-up (`inset(100% 0 0 0)` → `inset(0)`), triggered at `top 80%`.
- `.project__content` children (`eyebrow`, `h2`, `p`, `.btn`) fade up in
  sequence, 0.08s stagger, starting slightly after the media reveal
  begins (overlap ~0.3s) so text doesn't lag behind the image.

### 5. Masterplan Preview
- `.masterplan__media` scales from `1.04` → `1` while fading in,
  ScrollTrigger `scrub: 0.5` tied loosely to scroll position (subtle,
  not a full pin).
- `.masterplan__cta` slides in from the left 20px + fade, delayed 0.2s
  after the media starts revealing.
- Optional: on hover of `.masterplan__media`, scale image to `1.03` over
  0.6s `power2.out` to suggest interactivity before the zone pages exist.

### 6. Six Zones
- `.zones__list` items enter in a 3-column stagger: translateY 30px +
  fade, 0.7s `power3.out`, stagger 0.08s, grid-aware (use
  `ScrollTrigger.batch` so cards animate as they individually enter
  viewport rather than all at once — better for a 6-item grid users
  scroll past over 2+ rows).
- Hover (desktop only): `.zone-card__media` scale 0.98 (frame contracts
  slightly) while the inner `img` scales to 1.06 — creates a
  "window closing in, view expanding" effect. 0.5–0.7s `power2.out`.

### 7. Investment
- Because this section has a dark background, cross it with a
  `ScrollTrigger` that also fades the `.site-header` nav-links to a
  slightly higher opacity state if needed for contrast (usually not
  required since blend-mode handles it).
- `.investment__media` clip-path reveal left-to-right
  (`inset(0 100% 0 0)` → `inset(0)`), 1s, `power4.inOut`.
- `.investment__content` children fade up, staggered, starting after the
  media reveal is ~40% complete.

### 8. Latest News
- `.news__list` cards: same `ScrollTrigger.batch` stagger pattern as
  zones, but only 3 items so a single stagger (0.1s) on one trigger is
  fine.
- `.news-card__media img` gets a slow continuous Ken Burns
  (`scale(1) → scale(1.05)` over 8s, `linear`, no yoyo) once in view, to
  keep placeholders feeling alive before real renders are dropped in.

### 9. Footer
- `.site-footer__title` splits by line, same reveal pattern as the hero
  title but shorter stagger (0.06s) since there are only 2 lines.
- `.site-footer__nav a`: fade in with 0.05s stagger, no movement (footer
  motion should be the quietest in the page — it's the exit beat).

---

### Page-level orchestration
- Use one root GSAP `timeline` for the hero (runs on load, not scroll),
  and independent `ScrollTrigger`-based timelines for every section
  after it. Don't chain everything into a single master timeline — each
  section should animate independently as the user reaches it.
- Recommended global ScrollTrigger defaults:
  ```js
  ScrollTrigger.defaults({
    start: "top 82%",
    toggleActions: "play none none reverse",
  });
  ```
- For Framer Motion (if used for the fullscreen menu overlay
  specifically): stagger nav links in from `y: 24, opacity: 0` on menu
  open with `staggerChildren: 0.05` in the parent `variants`, and reverse
  on close — keep this separate from the GSAP scroll system since it's
  state-driven, not scroll-driven.
