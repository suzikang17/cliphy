import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const API_URL = (import.meta.env.VITE_API_URL as string) ?? "";
const REMEMBERED = "cliphy:has-coach";

/**
 * Whether this account has the coach, so the nav can link to it. The coach's
 * screens are a separate app served beside this one at /chat and /projects.
 * Asked once per browser tab; most accounts do not have it.
 */
export function useHasCoach(signedIn: boolean): boolean {
  const [has, setHas] = useState(() => sessionStorage.getItem(REMEMBERED) === "yes");

  useEffect(() => {
    if (!signedIn || sessionStorage.getItem(REMEMBERED)) return;
    let live = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch(`${API_URL}/api/coach/health`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        // 403 is the plain answer "not on this account"; anything else is asked again later.
        if (res.status !== 200 && res.status !== 403) return;
        sessionStorage.setItem(REMEMBERED, res.ok ? "yes" : "no");
        if (live) setHas(res.ok);
      } catch {
        // No link this time.
      }
    })();
    return () => {
      live = false;
    };
  }, [signedIn]);

  return signedIn && has;
}
