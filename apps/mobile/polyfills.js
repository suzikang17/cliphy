// Hermes doesn't have SharedArrayBuffer — some Supabase deps reference it
if (typeof globalThis.SharedArrayBuffer === "undefined") {
  globalThis.SharedArrayBuffer = ArrayBuffer;
}

// Polyfill crypto.subtle for Supabase PKCE (needs SHA-256 code challenge)
const ExpoCrypto = require("expo-crypto");

const ALGO_MAP = {
  "SHA-1": ExpoCrypto.CryptoDigestAlgorithm.SHA1,
  "SHA-256": ExpoCrypto.CryptoDigestAlgorithm.SHA256,
  "SHA-384": ExpoCrypto.CryptoDigestAlgorithm.SHA384,
  "SHA-512": ExpoCrypto.CryptoDigestAlgorithm.SHA512,
};

if (!globalThis.crypto) {
  globalThis.crypto = {};
}
if (!globalThis.crypto.getRandomValues) {
  globalThis.crypto.getRandomValues = ExpoCrypto.getRandomValues;
}
if (!globalThis.crypto.subtle) {
  globalThis.crypto.subtle = {
    digest(algorithm, data) {
      const name = typeof algorithm === "string" ? algorithm : algorithm.name;
      const expoAlgo = ALGO_MAP[name];
      if (!expoAlgo) throw new Error(`Unsupported algorithm: ${name}`);
      return ExpoCrypto.digest(expoAlgo, data);
    },
  };
}
