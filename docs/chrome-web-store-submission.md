# Chrome Web Store Submission — Cliphy

Everything you need to fill out the Chrome Web Store developer dashboard.

---

## 1. Account Setup (one-time)

- [ ] Pay $5 registration fee at https://chrome.google.com/webstore/devconsole
- [ ] Verify developer email
- [ ] Enable 2-Step Verification on your Google account

---

## 2. Store Listing

**Name:** Cliphy

**Short description** (132 char max):

> Queue YouTube videos and get AI-powered summaries with key points, action items, and timestamps.

**Detailed description:**

> Cliphy saves you time by summarizing YouTube videos with AI. Click a YouTube video, hit "Summarize", and get a clean summary in seconds — no need to watch the whole thing.
>
> HOW IT WORKS
>
> 1. Navigate to any YouTube video
> 2. Click the Cliphy icon to open the side panel
> 3. Hit "Summarize" to add the video to your queue
> 4. Get a summary with key points, action items, and clickable timestamps
>
> FEATURES
>
> - AI-powered summaries using Claude by Anthropic
> - Key points, action items, and clickable timestamps
> - Click timestamps to jump to that point in the video
> - Queue multiple videos and summarize them in the background
> - Copy summaries as plain text or Markdown
> - Tag and organize your summaries in Cliphub, your full-page archive
> - ✨ AI auto-tagging: select summaries and let AI suggest tags from your existing tags or create new ones (Pro)
> - Search, filter by tag, and sort your summary history
> - Right-click any YouTube video to add it from the context menu
> - Keyboard shortcut: press "A" to quickly add the current video
> - Real-time status updates as summaries are processed
> - Track how much time you've saved
>
> FREE PLAN
>
> - 5 summaries per month
> - 7-day summary history
> - Up to 3 tags
>
> PRO PLAN
>
> - 100 summaries per month
> - Unlimited history
> - Unlimited tags
> - ✨ AI auto-tagging
>
> Cliphy only runs on YouTube — it does not access any other websites or track your browsing.

**Category:** Productivity

**Language:** English

---

## 3. Image Assets

### Required

| Asset          | Dimensions          | Status                                  |
| -------------- | ------------------- | --------------------------------------- |
| Extension icon | 128x128 PNG         | Have it (`public/icons/icon-128.png`)   |
| Screenshot 1   | 1280x800 or 640x400 | **NEED** — side panel showing a summary |
| Screenshot 2   | 1280x800 or 640x400 | **NEED** — dashboard with queue items   |
| Screenshot 3   | 1280x800 or 640x400 | **NEED** — context menu "Add to Cliphy" |

### Optional (recommended for discoverability)

| Asset            | Dimensions       | Status                 |
| ---------------- | ---------------- | ---------------------- |
| Small promo tile | 440x280 PNG/JPG  | **NEED**               |
| Marquee promo    | 1400x560 PNG/JPG | Optional, skip for now |

**Screenshot tips:**

- Use a clean Chrome window, no other extensions visible
- Show real content (a popular public YouTube video)
- Dark mode off for maximum readability
- Crop to exact dimensions — CWS rejects mismatched sizes

---

## 4. Privacy Practices (Dashboard Questionnaire)

### Single Purpose Description

> Cliphy summarizes YouTube videos using AI. It reads video metadata (title, channel, duration) and sends transcripts to an AI service to generate summaries with key points, action items, and timestamps.

### Permission Justifications

| Permission     | Justification                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`      | Stores authentication tokens and user preferences locally.                                                                                                                                     |
| `tabs`         | Detects when the user navigates to or switches to a YouTube video so the extension can activate. Also used to send messages to the content script and open new tabs for summary pop-out views. |
| `identity`     | Used for Google OAuth sign-in to authenticate the user.                                                                                                                                        |
| `contextMenus` | Adds a right-click "Add to Cliphy" option on YouTube video pages.                                                                                                                              |
| `sidePanel`    | The extension's main UI is rendered as a Chrome side panel.                                                                                                                                    |

### Host Permissions

| Pattern                     | Justification                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `https://www.youtube.com/*` | Content script runs only on YouTube to detect video pages and extract metadata (title, channel, duration). No other websites are accessed. |

### Data Collection Disclosure

**Does your extension collect or transmit user data?** Yes

**Data types collected:**

- [x] Personally identifiable information — Email address (via Google OAuth, for authentication only)
- [x] Website content — YouTube video metadata (title, channel, video ID, duration) for videos the user explicitly summarizes
- [x] Authentication information — OAuth tokens stored locally

**Data types NOT collected:**

- [ ] Health information
- [ ] Financial / payment information (handled entirely by Stripe, never touches the extension)
- [ ] Location
- [ ] Web browsing history (only YouTube video IDs for explicitly summarized videos)
- [ ] User activity monitoring

### Data Usage Disclosure

| Question                                                                   | Answer                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Is data sold to third parties?                                             | No                                                                                                                             |
| Is data used for purposes unrelated to the extension's core functionality? | No                                                                                                                             |
| Is data used for creditworthiness or lending purposes?                     | No                                                                                                                             |
| Is data transferred to third parties?                                      | Yes — video transcripts are sent to Anthropic's Claude API for AI summary generation. Payment processing is handled by Stripe. |

### Remote Code

**Does your extension execute remote code?** No

### Privacy Policy URL

`https://cliphy.vercel.app/privacy`

---

## 5. Limited Use Certification

Paste this in the certification field:

> Cliphy's use of data complies with the Chrome Web Store's Limited Use policy. Data collected through Chrome APIs is used solely to provide the video summarization service. Data is not used for advertising, credit assessments, or any purpose unrelated to the extension's core functionality.

---

## 6. Distribution

| Field      | Value                                            |
| ---------- | ------------------------------------------------ |
| Visibility | Unlisted                                         |
| Regions    | All regions                                      |
| Pricing    | Free (Pro upgrade handled externally via Stripe) |

**Note on Unlisted:** The extension won't appear in search results but anyone with the direct link can install it. Good for early testing / sharing with friends before going public.

---

## 7. Pre-Submission Checklist

### Code

- [x] Manifest V3
- [x] No remote code execution
- [x] Permissions are minimal and justified
- [x] `activeTab` removed (redundant with `tabs`)
- [x] Host permissions scoped to YouTube only
- [ ] Build production zip: `pnpm --filter extension build` then zip `.output/chrome-mv3/`

### Assets

- [x] 128x128 icon
- [ ] 3+ screenshots at 1280x800
- [ ] Small promo tile 440x280

### Privacy

- [x] Privacy policy page live
- [x] No sensitive data in extension storage (only OAuth tokens)
- [x] All API calls over HTTPS
- [x] No data sold or used for advertising

### Listing

- [ ] Fill out all fields in developer dashboard
- [ ] Upload screenshots
- [ ] Set visibility to Unlisted
- [ ] Submit for review

---

## 8. Review Timeline

- **Typical review:** 1-3 business days for new extensions
- **If rejected:** You'll get an email with the specific policy violation. Fix and resubmit.
- **Common rejection reasons for new extensions:**
  - Missing or inadequate privacy policy
  - Permission justifications not detailed enough
  - Screenshots don't match actual functionality
  - Description contains keyword stuffing
