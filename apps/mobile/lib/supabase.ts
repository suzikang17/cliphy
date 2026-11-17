import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { MAC_WINDOW } from "./desktop";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!MAC_WINDOW && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — check .env");
}

// The Mac window never signs in (see lib/desktop.ts), but the client refuses
// to be made without an address, so it gets one that goes nowhere.
export const supabase = createClient(
  supabaseUrl || (MAC_WINDOW ? "http://localhost" : ""),
  supabaseAnonKey || (MAC_WINDOW ? "desktop" : ""),
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: !MAC_WINDOW,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  },
);
