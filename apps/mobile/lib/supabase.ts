import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { DESKTOP } from "./desktop";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!DESKTOP && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — check .env");
}

// The Mac window never signs in (see lib/desktop.ts), but the client refuses
// to be made without an address, so it gets one that goes nowhere.
export const supabase = createClient(
  supabaseUrl || (DESKTOP ? "http://localhost" : ""),
  supabaseAnonKey || (DESKTOP ? "desktop" : ""),
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: !DESKTOP,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  },
);
