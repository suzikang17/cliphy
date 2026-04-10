// Hermes doesn't have SharedArrayBuffer — some Supabase deps reference it
if (typeof globalThis.SharedArrayBuffer === "undefined") {
  globalThis.SharedArrayBuffer = ArrayBuffer;
}
