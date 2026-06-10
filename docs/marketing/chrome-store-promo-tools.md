# Chrome Web Store Promo Asset Tools

Research on tools for producing Chrome Web Store promotional assets (icon 128×128, small
promo tile 440×280, marquee/screenshots 1280×800) and listing copy. Compiled 2026-06-07.

Companion to [`chrome-web-store-submission.md`](chrome-web-store-submission.md), which holds
the actual listing copy, permission justifications, and dashboard checklist.

## Purpose-built for Chrome Web Store (exact dimensions — best fit)

These output the exact required sizes, so you don't fight aspect ratios.

| Tool                                                                                                                                                                            | What it does                                                                                                                                                                                                             | Price       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| [GetAppAssets](https://chromewebstore.google.com/detail/getappassets-promo-image/moclhcdbjdbaikbheilnmdfloibjaaah) (Chrome ext)                                                 | Purpose-built for extension devs. Smart gradient/auto-color backgrounds, one-click CWS presets (1280×800, 440×280), browser/iPhone/Mac frames, layer editor, PNG/WebP export. Updated Jan 2026 (v0.4.2, small userbase). | Free tier   |
| [Chrome Extension Image Generator](https://appicongenerator.org/chrome-extension-image-generator)                                                                               | Upload one source image → outputs icon + 440×280 tile + 1280×800 marquee. Auto browser frame + shadow, text overlay for name/tagline. 100% browser-side, nothing uploaded.                                               | Free        |
| [Hotpot.ai — marquee](https://hotpot.ai/templates/chrome-promotional-marquee) / [screenshot](https://hotpot.ai/templates/chrome-screenshot)                                     | Templated, drag-n-drop, handcrafted templates.                                                                                                                                                                           | Free + paid |
| [appscreenshots.net](https://appscreenshots.net/chrome-store-screenshot-generator) / [rapidtoolset.com](https://rapidtoolset.com/en/tool/chrome-web-store-screenshot-generator) | Free CWS screenshot generators: preset 1280×800, macOS browser frames, headline/subtitle text, gradient backgrounds, local processing.                                                                                   | Free        |
| [ExtensionBooster](https://extensionbooster.com/blog/extensionbooster-free-developer-tools/)                                                                                    | "Screenshot Makeup" (frames, gradients, feature callouts) + "Tile Cropper" (exact-pixel crop w/ aspect lock).                                                                                                            | Free tools  |
| [CWS Kit](https://cwskit.khanakia.com/sizes/chrome-web-store-small-promo-tile)                                                                                                  | Not a generator — a spec/tips reference for the 440×280 tile. Handy gut-check.                                                                                                                                           | Free        |

## General screenshot beautifiers (need manual sizing, but prettier output)

| Tool                                                                                                                              | What it does                                                                                  | Price                          |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------ |
| [Shots.so](https://shots.so/)                                                                                                     | Best free general mockup tool; browser/device frames, shadows, gradients, custom frame sizes. | Free + ~$4–5/mo                |
| [Screely](https://screely.com/)                                                                                                   | Instant browser-window mockup, in-browser, PNG/PDF export.                                    | Free                           |
| [Previewed](https://previewed.app/mockups/web-browser/google-chrome/)                                                             | Web/device mockups + promo banners.                                                           | Free Lite, $9.99 one-time Plus |
| [Pika.style](https://pika.style/)                                                                                                 | Polished, template library, Chrome capture extension.                                         | $15/mo                         |
| [BrandBird](https://www.brandbird.app/tools/screenshot-beautifier) / [Screenhance](https://screenhance.com/screenshot-beautifier) | Frames + (Screenhance) animated exports.                                                      | Free + paid                    |

## Listing copy

Skip the dedicated "AI product description" extensions — they're tuned for Amazon/Etsy/Shopify,
not browser extensions. The listing copy already lives in `chrome-web-store-submission.md`; use
Claude to revise it rather than a generic generator.

## Recommendation (solo dev, fast path)

1. **GetAppAssets** or **appicongenerator.org** — both give exact CWS dimensions from one
   screenshot. Start with the free appicongenerator one; zero friction, browser-side.
2. **Shots.so** if you want screenshots to look more premium than the auto-framers.
3. **Claude** for the copy — no tool needed.

## Fast workflow (~30 min)

1. Capture 2–3 clean screenshots of the Cliphy side panel doing a summary (real content, not
   empty state).
2. Run each through appicongenerator.org → 1280×800 framed screenshots + the 440×280 tile.
3. Tile rule (Google's own guidance): ≤5–7 words of large text + simplified UI, **not** a full
   screenshot.
4. Revise the description + permission justifications in `chrome-web-store-submission.md`.

References: [Chrome — Supplying Images](https://developer.chrome.com/docs/webstore/images) ·
[Chrome — Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing)
