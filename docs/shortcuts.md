# "Add to Cliphy" Apple Shortcut

Adds a YouTube link to the Cliphy queue from the share sheet, Action Button,
back-tap, or Siri — without opening the app. Works by POSTing to the public API
with a personal API key (`cliphy_sk_…`).

## Build recipe (Shortcuts app, one-time)

1. New Shortcut → rename **Add to Cliphy**.
2. Shortcut settings (ⓘ) → enable **Show in Share Sheet**; accepted types: **URLs, Text**.
3. Add an **Import Question** (Shortcut settings → Import Questions):
   "Paste your Cliphy API key (Cliphy app → Subscriptions → Add from anywhere)"
   targeting the Text action below.
4. **Text** action holding the API key (filled by the import question) → rename variable `ApiKey`.
5. **If** *Shortcut Input* *has any value* → **Set Variable** `VideoUrl` = Shortcut Input.
   **Otherwise** → **Get Clipboard** → **Set Variable** `VideoUrl` = Clipboard. **End If**.
6. **Get Contents of URL**:
   - URL: `https://api.cliphy.app/api/queue`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <ApiKey>` (concatenate), `Content-Type` = `application/json`
   - Request Body (JSON): `videoUrl` = `VideoUrl`
7. **Get Dictionary from Input** → **If** *Dictionary* has `error` →
   **Show Notification** "Cliphy: ⟨error⟩". **Otherwise** → **Show Notification**
   "Added to Cliphy ✓". **End If**.
8. Share → **Copy iCloud Link** → paste it into `SHORTCUT_INSTALL_URL` in
   `packages/shared/src/constants.ts` and rebuild the clients (the mobile app
   hides its Install button while the constant is empty).

## Using it

- **Share sheet:** YouTube → Share → Add to Cliphy.
- **Action Button (iPhone 15 Pro+):** Settings → Action Button → Shortcut → Add to Cliphy
  (copies the current clipboard link).
- **Back tap:** Settings → Accessibility → Touch → Back Tap → assign the shortcut.
- **Siri:** "Run Add to Cliphy" (with a link on the clipboard).

## Notes

- API keys are created in the mobile app (Subscriptions tab → "Add from anywhere"
  card) or via `POST /api/keys`. The key is shown once and revocable via
  `DELETE /api/keys/:id`; only a sha256 hash is stored.
- Monthly plan limits apply — the queue route returns a 4xx whose `error`
  message surfaces in the failure notification.
