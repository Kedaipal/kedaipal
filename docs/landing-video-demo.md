# Landing video demo — five sellers, one link, in two cuts

Branches `claude/landing-page-video-demo-ed64f9` (29 Aug, first clip) ·
`claude/landing-page-demo-video-4479f4` (13 Sep, this cut) · dev

The landing page argued the product in prose and stylised CSS mockups and
**never once showed the real thing moving**. The demo sits in the
[mobbin.com/mcp](https://mobbin.com/mcp) slot — directly under the hero (and
its seller-kinds marquee), ahead of every other section — and the encoding work
keeps it cheap for the page. Since landing v2 (`z8r3fdegej`) it is also the
page's "how it works": the timeline section that used to restate it is gone.

| Piece | Where |
|---|---|
| Section component | [`src/components/landing/video-demo.tsx`](../src/components/landing/video-demo.tsx) |
| Asset table + viewport rule | [`src/lib/demo-video.ts`](../src/lib/demo-video.ts) |
| Placement + `VideoObject` structured data | [`src/routes/index.tsx`](../src/routes/index.tsx) |
| Copy (en / ms / zh) | `messages/*.json`, `demo_video_*` keys |
| Encoded assets | `public/video/kedaipal-demo{,-portrait}.{webm,mp4}`, `public/img/landing/demo-poster{,-portrait}.webp` |
| Masters (not in the repo) | `~/Workspaces/Documents/Kedaipal/10_Assets/landing/` — `use-case-demo-desktop/use-case-demo-desktop.mp4` (16:9 + music), `Use Case Demo 9x16.mp4` (9:16, silent), `use-case-demo-desktop/use-case-demo-desktop.MP3` (the music bed) |
| Tests | `src/lib/demo-video.test.ts` (assets exist, transcript carries every beat, copy guards), `src/components/landing/video-demo.test.tsx` (cut per viewport, mute control) |

## The clip (13 Sep 2026)

The 29 Aug clip walked ONE order through the product (chat → link → storefront
→ cart → confirmation → dashboard). This cut argues the wider ICP instead: five
kinds of sellers, each with the pain line they'd say out loud, then the one
line Kedaipal answers with. Built in the Claude Design project "Storefront
UI/UX review" (`Use Case Demo 16x9.dc.html` / `9x16.dc.html`, shared scene
file), ~6.5 s a scene.

| ~t | Eyebrow | Burned-in caption (problem → answer) |
|---|---|---|
| 0s | — | *One link. Every order, out of the chat.* (title card; the masters fade it in from dark over 0.5 s, trimmed — see Encoding) |
| 3s | 01 · Cake & dessert | Custom orders lost in 40 messages? → **Sizes, flavours, lead time — picked, not asked.** |
| 9s | 02 · Frozen & reseller | Sold out but still taking orders? → **Live stock. It stops when you're out.** |
| 16s | 03 · Live selling | "Mine!" in the comments, then chaos? → **One link in the live. Orders, not screenshots.** |
| 22s | 04 · Services & booking | Booking by back-and-forth? → **Pick a slot. Confirmed.** |
| 28s | 05 · Fashion & prints | Which colour, which size, which one? → **Variants sorted. Order lands in WhatsApp.** |
| 32s | — | *One link. Every order, in Kedaipal.* · kedaipal.com (held to the end, no fade-out) |

Those twelve lines are pinned by `demo-video.test.ts` against
`demo_video_transcript`, so the transcript cannot silently describe a clip that
no longer exists.

**Positioning note, stated rather than hidden:** scene 02's eyebrow says
"Reseller" and scene 01 leads with cakes. The 8 Sep positioning lock
(`04_Brand/brand-taglines.md`) says not to lead with cakes and rules resellers
out of the ICP. The pixels are the owner's asset and ship as delivered; the
surrounding copy (`demo_video_sub`, `demo_video_label`) names the five
*patterns* — custom orders, stock-gated selling, live selling, bookings,
variants — and never the word reseller. If the clip is re-exported, that
eyebrow is the one to change.

## Two cuts, one edit — the mobile letterbox is finally a source fix

The 29 Aug doc measured and rejected a mobile centre-crop (the wide dashboard
shot spanned 95% of the frame) and said the real fix was **a second cut of the
source framed for phones, served by a JS source swap**. This cut ships that:

- `landscape` — 16:9, 1280×720, for `md` and up (the frame paints up to ~1000
  CSS px inside `max-w-5xl`).
- `portrait` — 9:16, 720×1280, below `md`. Same scenes, same soundtrack; the
  captions sit above the phone instead of beside it. At 375 px the frame is
  ~335×596 instead of the old 335×187 with a phone floating in navy.

**How the swap works, and why it is a remount.** `<source media="…">` inside
`<video>` is not honoured by modern Chrome, and a `<video>`'s `<source>` list
is read once at load — changing it in place does nothing without `load()`. So
`video-demo.tsx` reads `PORTRAIT_MEDIA_QUERY` (`(max-width: 767px)`, i.e.
Tailwind's `md`) through `useSyncExternalStore` and **keys the `<video>` on the
variant**: rotate a phone across 768 px and the element remounts with the other
cut, poster and observer re-armed.

**The server snapshot is `null`, on purpose.** Before hydration the viewport
is unknown. Guessing landscape would paint the 16:9 poster into a phone's 9:16
box for a frame and then swap it — a visible glitch on the one section that is
supposed to look finished. Instead the element renders with no poster and no
sources inside the same navy box; the box's ratio is pure CSS
(`aspect-[9/16] md:aspect-video`, capped at `max-w-[24rem]` on phones so a tall
frame stays inside one screen), so **nothing shifts** when the right cut
arrives a few hundred milliseconds later. The section is below the fold, so it
is never the LCP element and this costs no Core Web Vital.

## Encoding

Both masters are 1080p (the 16:9 export is 60 fps, the 9:16 is 30 fps). Both
outputs are **30 fps** (`fps=30` halves the frame count on the 16:9 master for
motion graphics that gain nothing from 60), **start 0.5 s into the master**
(`-ss 0.5`, see the poster decision below) and use the codec settings the
29 Aug bake-off settled (VP9 crf 46 beat AV1 on *size* for flat-shaded
content; H.264 crf 30 High for Safari).

| Output | Codec | Size | Role |
|---|---|---|---|
| `kedaipal-demo.webm` | VP9 1280×720 + Opus 64 kb/s, 34.4 s | 1.12 MB | md+, first `<source>` |
| `kedaipal-demo.mp4` | H.264 High 1280×720 + AAC 96 kb/s, `+faststart`, 34.4 s | 1.51 MB | md+, Safari / fallback |
| `kedaipal-demo-portrait.webm` | VP9 720×1280 + Opus 64 kb/s, 35.0 s | 1.16 MB | phones, first `<source>` |
| `kedaipal-demo-portrait.mp4` | H.264 High 720×1280 + AAC 96 kb/s, `+faststart`, 35.0 s | 1.37 MB | phones, Safari / fallback |
| `demo-poster.webp` / `demo-poster-portrait.webp` | WebP q72, frame 0 (the lit title card) | 15 KB / 14 KB | `poster` |

Reproduce (`$D` = the 16:9 master with music, `$P` = the 9:16 master, `$M` =
the MP3 music bed; the 9:16 export is silent, so its audio is muxed from `$M`,
trimmed by the same 0.5 s so it stays in sync):

```bash
VP9="-c:v libvpx-vp9 -crf 46 -b:v 0 -row-mt 1 -tile-columns 2 -deadline good -cpu-used 1 -g 60 -pix_fmt yuv420p"
X264="-c:v libx264 -profile:v high -level 4.0 -preset veryslow -crf 30 -pix_fmt yuv420p -movflags +faststart -g 60"
HEAD=0.5
ffmpeg -ss $HEAD -i "$D" -vf "fps=30,scale=1280:720:flags=lanczos" $VP9  -c:a libopus -b:a 64k -ac 2 public/video/kedaipal-demo.webm
ffmpeg -ss $HEAD -i "$D" -vf "fps=30,scale=1280:720:flags=lanczos" $X264 -c:a aac -b:a 96k -ac 2 public/video/kedaipal-demo.mp4
ffmpeg -ss $HEAD -i "$D" -frames:v 1 -vf "scale=1280:720:flags=lanczos" -c:v libwebp -quality 72 public/img/landing/demo-poster.webp
ffmpeg -ss $HEAD -i "$P" -ss $HEAD -i "$M" -map 0:v:0 -map 1:a:0 -vf "scale=720:1280:flags=lanczos" $VP9  -c:a libopus -b:a 64k -ac 2 public/video/kedaipal-demo-portrait.webm
ffmpeg -ss $HEAD -i "$P" -ss $HEAD -i "$M" -map 0:v:0 -map 1:a:0 -vf "scale=720:1280:flags=lanczos" $X264 -c:a aac -b:a 96k -ac 2 public/video/kedaipal-demo-portrait.mp4
ffmpeg -ss $HEAD -i "$P" -frames:v 1 -vf "scale=720:1280:flags=lanczos" -c:v libwebp -quality 72 public/img/landing/demo-poster-portrait.webp
```

Decisions worth keeping:

- **The music stays, at 64/96 kb/s.** The audio track was measured before the
  decision: continuous −27 dB mean, zero silence gaps across all 35 s — a
  music bed, no speech. Autoplay is muted regardless, so every play still
  downloads the audio bytes; a 96 kb/s Opus track was ~420 KB of that, 64 kb/s
  is ~280 KB and indistinguishable on a bed. Stripping it (the 29 Aug posture)
  was offered and declined (owner, 13 Sep) — the visitor can turn it on.
- **The 0.5 s fade-in is trimmed so frame 0 IS the poster.** Both masters
  open on a fade from dark (landscape luma 46 → 68 over 0.6 s; portrait 40 →
  73 over 0.5 s — the portrait's frame 0 is a plain navy gradient, a dead
  frame). The rule that the poster must be frame 0 still holds — any other
  frame jumps backwards on first play — so the head is trimmed instead: the
  poster is the lit "One link. Every order, out of the chat." card in both
  cuts (2.7 KB → 14 KB is the text arriving), and the loop cuts from one navy
  title card to another. The alternative measured and rejected: keep the fade
  and take the poster at 0.5 s — a visible blink to dark on every first play.
  The 35 s master becomes a 34.4 s clip; the eyebrow keeps saying
  "35-second" (the edit's length) while the `VideoObject` declares the exact
  `PT34S`.
- **1280×720 / 720×1280, not 1080p.** The frames paint at most ~1000 and ~400
  CSS px respectively; 1080p would roughly double the bytes for pixels no
  viewport asks for.
- **The portrait audio is a 35.0 s cut under a 34.4 s bed.** The 9:16 export
  holds the closing card 0.6 s longer than the 16:9 re-export the music was cut
  against (the two heads line up to within a frame — measured, not assumed),
  so the last 0.6 s of the portrait clip is silent — on the static closing
  card, under a bed that has already faded. If the 9:16 is ever re-exported
  *with* music from the design tool, drop the `-i "$M"` mux.
- **No AV1, no cropping, no `<source media>`** — all three were measured or
  tested and rejected in the 29 Aug pass; nothing about this cut changes
  those results.

## Loading posture

`preload="none"` + `poster` is the whole optimisation, and it is load-bearing:

- A visitor who bounces at the hero pays **~9 KB** (one poster), not 1.3 MB.
- The `<source>` elements are static once mounted — nothing is fetched until
  `play()` is called, which only happens once an `IntersectionObserver`
  (threshold 0.25) says the frame is actually on screen.
- Leaving the viewport **pauses**, so a demo playing three screens above the
  reader isn't burning battery (or, now, playing music to nobody).
- The `<video>` box is CSS-reserved before a byte arrives — zero CLS, including
  across the variant swap.

## Player behaviour

Autoplay-muted-loop is the Mobbin pattern, but a 35-second captioned piece is
more content than an ambient loop, so it gets controls — deliberately small
ones, in one cluster bottom-right:

- **Mute / unmute, then play / pause.** Both always visible while the clip is
  playable: a control you must hover to discover is a hidden control
  (CLAUDE.md § discoverability). Mute sits *left* of play/pause — it is the
  newer, less expected control, and the thumb lands on play/pause in the corner
  it has always been in. The mute button carries `aria-pressed` (on = sound on)
  and a named label in every locale (`demo_video_mute` / `demo_video_unmute`).
- **Playback starts muted, always.** That is what autoplay policy allows, and a
  landing page that starts making noise is the one thing worse than one that
  autoplays. Unmuting is a tap, which is also the only context a browser lets
  it happen in; the component writes `video.muted` directly rather than
  waiting on a state round-trip.
- **An explicit pause sticks.** `userPausedRef` means scrolling the section out
  and back does **not** resurrect playback. Pressing play clears it.
- **A mint progress rail** on the bottom edge, so the visitor can see it's 35
  seconds and not a 5-minute commitment.
- **`prefers-reduced-motion` never autoplays**, and drops `loop` so a manual
  play ends on the closing card instead of running forever.
- **A refused `play()` is handled, not ignored.** iOS Low Power Mode blocks
  even muted autoplay; that rejection (and reduced motion) both surface the
  same large centred play button over the poster, so the demo is never a dead
  frame.
- **A background-tab load re-arms on `visibilitychange`.** Found while
  verifying in a hidden preview pane: the observer fires while the document is
  hidden, `play()` resolves, the clip never advances, and nothing fires again
  when the tab is fronted — poster + Play button where the loop should be. The
  handler re-attempts under the observer's own guards (in view, not
  user-paused, currently paused), so a deliberate pause still sticks.

## Accessibility and i18n

The captions are **burned into the pixels**, so there is no track file and no
machine-readable copy of what the demo says. Two things cover that:

- `aria-label` on the `<video>` (`demo_video_label`) says what the clip is.
- `demo_video_transcript` is an `sr-only` paragraph carrying every caption
  beat, and it **translates with the page** even though the pixels don't
  (`demo-video.test.ts` pins the English one to the clip).

**Known limitation, stated plainly:** the on-screen captions are English in all
three locales (`demo_video_caption` now says so on the page). Malay and
Chinese captions need the source re-rendered per locale; the surrounding copy
is localised, and the transcript gives non-English screen-reader users the
content.

## SEO

`/`'s JSON-LD `VideoObject` points at the **landscape** cut (`contentUrl`,
`thumbnailUrl`); the portrait cut is a viewport rendition of the same edit, not
a second video, so it is not declared. `DEMO_UPLOAD_DATE` is a **pinned
constant, not a computed date** — a `uploadDate` that moves on every deploy is
precisely the signal Google treats as unreliable. Bump it only when the clip
is re-recorded, in the same change as the files in `public/video/`. The
duration constant lives beside the asset table in `src/lib/demo-video.ts` so
the two can't drift.

## When the video is replaced

1. Re-run the `ffmpeg` commands above over the new masters (both cuts).
2. Update `DEMO_UPLOAD_DATE` in `src/routes/index.tsx` and `DEMO_DURATION_ISO`
   in `src/lib/demo-video.ts` if the length changed.
3. Update `demo_video_transcript` in all three catalogs to the new captions,
   then the `CAPTION_BEATS` list in `demo-video.test.ts` — the test is the
   thing that makes a stale transcript fail instead of ship.
4. Re-check both posters: each must still be frame 0 of its own cut.
5. Re-read `demo_video_eyebrow` / `_label` for the length and the "silent" /
   "no sound" wording — `demo-video.test.ts` fails on the old phrasing, but
   only in English.
