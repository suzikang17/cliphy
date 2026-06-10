import { getShareExtensionKey } from "expo-share-intent";

/**
 * expo-router native-intent handler.
 *
 * When a user shares to Cliphy, iOS/Android cold-launch the app at the
 * share-extension deep link (e.g. `com.cliphy.app://dataUrl=com.cliphy.appShareKey`).
 * expo-router can't match that path and would render its "Unmatched Route"
 * screen. We intercept the share-extension URL here and redirect to the root
 * route — the `useShareIntent` hook in `app/_layout.tsx` then reads the shared
 * payload from native storage and enqueues it.
 *
 * Any other deep link is passed through unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
      return "/";
    }
    return path;
  } catch {
    return "/";
  }
}
