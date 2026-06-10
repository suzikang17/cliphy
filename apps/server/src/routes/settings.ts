import { Hono } from "hono";
import { SUMMARY_LANGUAGES } from "@cliphy/shared";
import type { SummaryLanguageCode } from "@cliphy/shared";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";

const settings = new Hono<AppEnv>();

settings.use("/*", authMiddleware);

/** GET /settings — return user settings (defaults if no row exists) */
settings.get("/", async (c) => {
  const userId = c.get("userId");

  const { data } = await supabase
    .from("user_settings")
    .select("summary_language, auto_discover_playlists")
    .eq("user_id", userId)
    .single();

  return c.json({
    summaryLanguage: (data?.summary_language as SummaryLanguageCode) ?? "en",
    autoDiscoverPlaylists: (data?.auto_discover_playlists as boolean) ?? true,
  });
});

/** PATCH /settings — update user settings */
settings.patch("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ summaryLanguage?: string; autoDiscoverPlaylists?: boolean }>();

  const update: Record<string, unknown> = {};

  if (body.summaryLanguage !== undefined) {
    if (!(body.summaryLanguage in SUMMARY_LANGUAGES)) {
      return c.json({ error: "Invalid language code" }, 400);
    }
    update.summary_language = body.summaryLanguage;
  }

  if (body.autoDiscoverPlaylists !== undefined) {
    if (typeof body.autoDiscoverPlaylists !== "boolean") {
      return c.json({ error: "autoDiscoverPlaylists must be a boolean" }, 400);
    }
    update.auto_discover_playlists = body.autoDiscoverPlaylists;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: userId, ...update }, { onConflict: "user_id" });

    if (error) {
      return c.json({ error: "Failed to update settings" }, 500);
    }
  }

  // Return the effective settings after the update
  const { data } = await supabase
    .from("user_settings")
    .select("summary_language, auto_discover_playlists")
    .eq("user_id", userId)
    .single();

  return c.json({
    summaryLanguage: (data?.summary_language as SummaryLanguageCode) ?? "en",
    autoDiscoverPlaylists: (data?.auto_discover_playlists as boolean) ?? true,
  });
});

export { settings as settingsRoutes };
