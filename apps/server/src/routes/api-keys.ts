import { Hono } from "hono";
import { createHash, randomBytes } from "crypto";
import { MAX_API_KEYS_PER_USER } from "@cliphy/shared";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";

export const apiKeyRoutes = new Hono<AppEnv>();

apiKeyRoutes.use("*", authMiddleware);

// API keys can't manage API keys — JWT sessions only
apiKeyRoutes.use("*", async (c, next) => {
  if (c.get("authMethod") === "api_key") {
    return c.json({ error: "API keys cannot manage API keys" }, 403);
  }
  await next();
});

function toApiKey(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    name: row.name as string,
    keyPrefix: row.key_prefix as string,
    lastUsedAt: (row.last_used_at as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

// GET / — list keys (prefix only, never the key)
apiKeyRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  const { data: rows, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, last_used_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: "Failed to fetch API keys" }, 500);
  return c.json({ apiKeys: (rows ?? []).map(toApiKey) });
});

// POST / — create key; plaintext returned once
apiKeyRoutes.post("/", async (c) => {
  const userId = c.get("userId");

  let body: { name?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // empty body is fine
  }

  const { count } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((count ?? 0) >= MAX_API_KEYS_PER_USER) {
    return c.json({ error: `Maximum ${MAX_API_KEYS_PER_USER} API keys allowed` }, 422);
  }

  const key = `cliphy_sk_${randomBytes(24).toString("base64url")}`;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const keyPrefix = key.slice(0, 14);

  const { data: row, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: userId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name: body.name?.trim() || "Shortcut",
    })
    .select("id, name, key_prefix, last_used_at, created_at")
    .single();

  if (error || !row) return c.json({ error: "Failed to create API key" }, 500);

  return c.json({ apiKey: toApiKey(row), key }, 201);
});

// DELETE /:id — revoke
apiKeyRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: existing } = await supabase
    .from("api_keys")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (!existing) return c.json({ error: "API key not found" }, 404);

  await supabase.from("api_keys").delete().eq("id", id);
  return c.json({ deleted: true });
});
