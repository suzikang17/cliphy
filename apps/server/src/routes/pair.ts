import { Hono } from "hono";
import { createHash, randomBytes, randomInt } from "crypto";
import type { AppEnv } from "../env.js";
import { supabase } from "../lib/supabase.js";

// Pairing the Mac helper with an account, without copying an API key by hand.
//
//   1. The Mac (not signed in) asks for a code and shows it.
//   2. The owner types the code into the phone, which is signed in.
//   3. The Mac, polling with a secret only it holds, receives a new API key
//      and the account's email to show before it uploads anything.
//
// The code is the only thing a stranger could guess, and guessing it only
// attaches a Mac to the guesser's own account, which the Mac then names.

/** No 0/O, 1/I/L: the code is read off one screen and typed into another. */
export const PAIR_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const TTL_MS = 10 * 60_000;
/** Codes waiting at once, across everyone; start is open to the internet. */
const MAX_WAITING = 200;
export const HELPER_KEY_NAME = "Mac helper";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const normalizeCode = (raw: string): string => raw.replace(/[\s-]/g, "").toUpperCase();

function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += PAIR_CODE_ALPHABET[randomInt(PAIR_CODE_ALPHABET.length)];
  }
  return code;
}

/** Open routes, used by the Mac before it has a key. */
export const pairRoutes = new Hono<AppEnv>();

pairRoutes.post("/start", async (c) => {
  const now = new Date();
  // Expired codes are cleared here; nothing else needs them gone.
  await supabase.from("coach_pairings").delete().lt("expires_at", now.toISOString());
  const { count } = await supabase
    .from("coach_pairings")
    .select("id", { count: "exact", head: true })
    .gt("expires_at", now.toISOString());
  if ((count ?? 0) >= MAX_WAITING) return c.json({ error: "Try again in a few minutes" }, 429);

  const code = newCode();
  const pollToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
  const { error } = await supabase
    .from("coach_pairings")
    .insert({ code, poll_hash: sha(pollToken), expires_at: expiresAt });
  if (error) return c.json({ error: "Could not start pairing" }, 500);

  return c.json({ code: `${code.slice(0, 4)}-${code.slice(4)}`, pollToken, expiresAt }, 201);
});

pairRoutes.post("/poll", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { pollToken?: unknown };
  if (typeof body.pollToken !== "string" || !body.pollToken) {
    return c.json({ error: "pollToken is required" }, 400);
  }

  const { data: row } = await supabase
    .from("coach_pairings")
    .select("id, user_id, expires_at")
    .eq("poll_hash", sha(body.pollToken))
    .maybeSingle();
  const pairing = row as { id: string; user_id: string | null; expires_at: string } | null;
  if (!pairing || new Date(pairing.expires_at).getTime() <= Date.now()) {
    return c.json({ error: "This code has expired. Start again." }, 410);
  }
  if (!pairing.user_id) return c.json({ status: "waiting" });

  // Use the pairing up first: whichever poll deletes the row gets the key.
  const { data: used } = await supabase
    .from("coach_pairings")
    .delete()
    .eq("id", pairing.id)
    .not("user_id", "is", null)
    .select("id, user_id");
  const mine = ((used as { id: string; user_id: string }[] | null) ?? [])[0];
  if (!mine) return c.json({ error: "This code has already been used." }, 410);

  // One Mac helper key per account; pairing again replaces it.
  await supabase.from("api_keys").delete().eq("user_id", mine.user_id).eq("name", HELPER_KEY_NAME);
  const key = `cliphy_sk_${randomBytes(24).toString("base64url")}`;
  const { error } = await supabase
    .from("api_keys")
    .insert({
      user_id: mine.user_id,
      key_hash: sha(key),
      key_prefix: key.slice(0, 14),
      name: HELPER_KEY_NAME,
    })
    .select("id")
    .single();
  if (error) return c.json({ error: "Could not finish pairing. Start again." }, 500);

  const { data: user } = await supabase
    .from("users")
    .select("email")
    .eq("id", mine.user_id)
    .maybeSingle();
  return c.json({
    status: "paired",
    apiKey: key,
    account: (user as { email?: string } | null)?.email ?? null,
  });
});

/** Signed-in route, mounted under /coach: the phone confirms the code. */
export const pairClaimRoutes = new Hono<AppEnv>();

pairClaimRoutes.post("/claim", async (c) => {
  // A key must not be able to mint another key for itself.
  if (c.get("authMethod") === "api_key") {
    return c.json({ error: "Sign in on the phone to connect a Mac" }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? normalizeCode(body.code) : "";
  if (code.length !== CODE_LENGTH) return c.json({ error: "Enter the 8-character code" }, 400);

  const now = new Date().toISOString();
  const { data } = await supabase
    .from("coach_pairings")
    .update({ user_id: c.get("userId"), claimed_at: now })
    .eq("code", code)
    .is("user_id", null)
    .gt("expires_at", now)
    .select("id");
  if (!((data as unknown[] | null) ?? []).length) {
    return c.json({ error: "Code not found or expired" }, 404);
  }
  return c.json({ paired: true });
});
