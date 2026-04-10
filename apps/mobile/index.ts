// Polyfills must run before any imports that use them
if (typeof globalThis.SharedArrayBuffer === "undefined") {
  // @ts-expect-error — Hermes doesn't have SharedArrayBuffer, Supabase needs it
  globalThis.SharedArrayBuffer = ArrayBuffer;
}

// Now load expo-router
import "expo-router/entry";
