// Polyfills must run before any imports that use them.
// Using require() instead of import so this executes BEFORE module loading
// (ES import statements are hoisted and run first regardless of position).
if (typeof globalThis.SharedArrayBuffer === "undefined") {
  // @ts-expect-error — Hermes doesn't have SharedArrayBuffer, Supabase needs it
  globalThis.SharedArrayBuffer = ArrayBuffer;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("expo-router/entry");
