# Landing video demo — the 30-second proof shot

Branch `claude/landing-page-video-demo-ed64f9` · dev

The landing page argued the product in prose and stylised CSS mockups and
**never once showed the real thing moving**. This adds the 30-second explainer
in the [mobbin.com/mcp](https://mobbin.com/mcp) slot — directly under the hero,
ahead of every other section — and does the encoding work so it costs the page
almost nothing.

| Piece | Where |
|---|---|
| Section component | [`src/components/landing/video-demo.tsx`](../src/components/landing/video-demo.tsx) |
| Placement + `VideoObject` structured data | [`src/routes/index.tsx`](../src/routes/index.tsx) |
| Copy (en / ms / zh) | `messages/*.json`, `demo_video_*` keys |
| Encoded assets | `public/video/kedaipal-demo.{webm,mp4}`, `public/img/landing/demo-poster.webp` |
| Master (not in the repo) | `~/Workspaces/Documents/Kedaipal/10_Assets/Kedaipal Explainer.mp4` |

## The gap this closes

Before this, `/` went **Hero → RealSellers → ProblemStrip → PaymentHandshake →
HowItWorks → …**. Every one of those sections *describes* the product; the only
imagery was `hero-device.tsx` and `how-it-works-mockups.tsx`, both hand-built
CSS approximations. A visitor could read the entire page and still never see a
single frame of the actual app — the first sight of real Kedaipal UI came
*after* signing up.

The clip walks the exact arc the page already argues:

| ~t | Burned-in caption | Section that argues the same thing in prose |
|---|---|---|
| 0s | *Live in 5 minutes* (title card) | `hero_trust` |
| 3s | Orders buried in WhatsApp chat? | `ProblemStrip` (`problem_1_title`) |
| 7s | Kedaipal replies to every customer with your store link | `HowItWorks` step 1 (SHARE) |
| 11s | They browse your storefront — no app, no login | step 2 (BROWSE) |
| 15s | *(cart + checkout)* | step 2/3 |
| 19s | The order lands back in WhatsApp — confirmed instantly | step 3 (CLOSE) |
| 23s | You track every order in one dashboard | step 4 (RUN) |
| 27s | *No Meta setup. No WABA. Just share your link.* | `hero_trust`, FAQ #1 |

That table is why it earns the slot **ahead of `RealSellers` and
`ProblemStrip`** rather than being folded into `HowItWorks`: it is the whole
pitch, moving, in 30 seconds. `HowItWorks` stays where it is as the scannable
version for the visitor who doesn't watch — the two are not redundant, they're
the same argument at two speeds.

## Encoding — 21.5 MB → 928 KB

The master is 1920×1080, 30 fps, 30.0 s, **h264 5.7 Mbps, 21.5 MB, no audio
stream at all**. Shipping that as-is would have been ~23× the weight of the
rest of the landing page's images combined.

| Output | Codec | Size | Role |
|---|---|---|---|
| `kedaipal-demo.webm` | VP9, 1280×720, `-crf 46 -b:v 0` | **928 KB** | first `<source>` |
| `kedaipal-demo.mp4` | H.264 High, 1280×720, `-crf 30 -preset veryslow`, `+faststart` | 1.17 MB | Safari / fallback |
| `demo-poster.webp` | WebP q72, 1280×720 | 8.7 KB | `poster`, frame 0 |

Reproduce with (`$V` = the master):

```bash
ffmpeg -i "$V" -an -vf "scale=1280:720:flags=lanczos" -c:v libvpx-vp9 -crf 46 -b:v 0 -row-mt 1 -tile-columns 2 -deadline good -cpu-used 1 -g 60 -pix_fmt yuv420p public/video/kedaipal-demo.webm
```

```bash
ffmpeg -i "$V" -an -vf "scale=1280:720:flags=lanczos" -c:v libx264 -profile:v high -level 4.0 -preset veryslow -crf 30 -pix_fmt yuv420p -movflags +faststart -g 60 public/video/kedaipal-demo.mp4
```

```bash
ffmpeg -ss 0 -i "$V" -frames:v 1 -vf "scale=1280:720:flags=lanczos" -c:v libwebp -quality 72 public/img/landing/demo-poster.webp
```

Decisions worth keeping:

- **`-an` on both.** The master genuinely has no audio stream. Stripping it
  explicitly also removes the "will muted autoplay be blocked?" ambiguity, and
  is why the player renders **no mute control** — we don't ship a control for a
  thing that doesn't exist.
- **1280×720, not 1920×1080.** The frame paints at most ~1000 CSS px
  (`max-w-5xl`). 1080p would have roughly doubled the bytes for pixels no
  viewport asks for.
- **VP9 beat AV1 here, and the CRF is high on purpose.** Candidates measured on
  this content: VP9 crf 36 → 1.94 MB, SVT-AV1 crf 36 → 1.35 MB, x264 crf 27 →
  1.58 MB, **VP9 crf 46 → 928 KB**. The clip is flat-shaded motion-graphics, so
  it survives a high CRF that would visibly wreck camera footage — the crops
  that decided it were the dashboard order rows (23 s) and the WhatsApp bubble
  text (19 s) at 2–4× zoom, both still crisp. AV1 was rejected on *size*, not
  support: it lost to VP9 on this source.
- **No separate mobile rendition.** `<source media="…">` inside `<video>` is
  not honoured by modern Chrome, so a phone-sized variant would need JS source
  swapping. At 928 KB behind an IntersectionObserver that isn't worth the
  machinery.

## Loading posture

`preload="none"` + `poster` is the whole optimisation, and it is load-bearing:

- A visitor who bounces at the hero pays **8.7 KB** (the poster), not 928 KB.
- The `<source>` elements are static — nothing is fetched until `play()` is
  called, which only happens once an `IntersectionObserver` (threshold 0.25)
  says the frame is actually on screen.
- Leaving the viewport **pauses**, so a demo playing three screens above the
  reader isn't burning battery.
- `aspect-video w-full` on the `<video>` reserves the box before a byte
  arrives — zero CLS.
- The poster is frame 0 (the title card), *not* a prettier mid-clip frame:
  playback starts at 0, so any other poster would visibly jump on first play.

### The 16:9 letterbox on mobile is a source problem, not a CSS one

At 375 px the frame paints ~335×187, and because the master centres a portrait
phone (and later a desktop window) inside a 16:9 canvas, a lot of that box is
empty background. **A mobile centre-crop was measured and rejected**: the
orders-dashboard shot at 21–27 s spans roughly 95% of the frame width (content
starts ~4.7% in from the left edge, measured by sampling all 30 seconds), so
even a mild 3:2 crop clips the browser window. `object-cover` with a taller
mobile aspect ratio would have looked like a win and quietly cut the payoff
shot.

The real fix is a **second cut of the source** framed 4:5 or 1:1 for phones,
served by a JS source swap — an asset decision, not a CSS one. Until then the
clip stays 16:9 everywhere, uncropped.

## Player behaviour

Autoplay-muted-loop is the Mobbin pattern, but a 30-second captioned explainer
is more content than an ambient loop, so it gets controls — deliberately small
ones:

- **An always-visible play/pause button**, bottom-right. Not hover-revealed:
  a control you must hover to discover is a hidden control
  (CLAUDE.md § discoverability). Clicking the frame itself toggles too, with
  the button as the keyboard path.
- **An explicit pause sticks.** `userPausedRef` means scrolling the section out
  and back does **not** resurrect playback — an autoplay that overrides a
  deliberate pause is the worst thing a hero video can do. Pressing play clears
  it.
- **A mint progress rail** on the bottom edge, so the visitor can see it's 30
  seconds and not a 5-minute commitment.
- **`prefers-reduced-motion` never autoplays**, and drops `loop` so a manual
  play ends on the closing card instead of running forever.
- **A refused `play()` is handled, not ignored.** iOS Low Power Mode blocks even
  muted autoplay; that rejection (and reduced motion) both surface the same
  large centred play button over the poster, so the demo is never a dead frame.

## Accessibility and i18n

The captions are **burned into the pixels**, so there is no track file and no
machine-readable copy of what the demo says. Two things cover that:

- `aria-label` on the `<video>` (`demo_video_label`) says what the clip is.
- `demo_video_transcript` is an `sr-only` paragraph carrying the full caption
  text, and it **translates with the page** even though the pixels don't.

**Known limitation, stated plainly:** the on-screen captions are English in all
three locales. Malay and Chinese captions need the source re-rendered and a
per-locale asset set; the surrounding copy (`demo_video_*`) is already
localised, and the transcript gives non-English screen-reader users the content.
Worth revisiting if BM traffic justifies a second render.

## SEO

`/`'s JSON-LD gains a `VideoObject` (`name`, `description`, `thumbnailUrl`,
`contentUrl`, `uploadDate`, `duration: PT30S`, `publisher`). `DEMO_UPLOAD_DATE`
is a **pinned constant, not a computed date** — a `uploadDate` that moves on
every deploy is precisely the signal Google treats as unreliable. Bump it only
when the clip is re-recorded, in the same change as the files in
`public/video/`.

## When the video is replaced

1. Re-run the three `ffmpeg` commands above over the new master.
2. Update `DEMO_UPLOAD_DATE` (and `DEMO_DURATION_ISO` if the length changed) in
   `src/routes/index.tsx`.
3. Update `demo_video_transcript` in all three catalogs to the new captions —
   a stale transcript is worse than none.
4. Re-check the poster: it must still be frame 0 of the new cut.
