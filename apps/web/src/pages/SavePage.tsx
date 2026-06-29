import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth-context";
import { addClip } from "../lib/api";

function parseTweetUrl(url: string): { author: string; tweetId: string } | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)\/status\/(\d+)/);
  if (!match) return null;
  return { author: `@${match[1]}`, tweetId: match[2] };
}

export function SavePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const url = params.get("url") ?? "";
  const text = params.get("text") ?? "";
  const title = params.get("title") ?? undefined;

  useEffect(() => {
    if (loading) return;

    if (!user) {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      navigate(`/login?redirect=${redirect}`, { replace: true });
      return;
    }

    if (status !== "idle") return;

    const tweet = parseTweetUrl(url);
    if (!tweet) {
      setErrorMsg("Only tweet URLs are supported right now.");
      setStatus("error");
      return;
    }

    setStatus("saving");
    addClip({
      sourceType: "tweet",
      sourceUrl: url,
      content: text || undefined,
      author: tweet.author,
      title,
      sourceMetadata: { tweetId: tweet.tweetId },
    })
      .then(() => setStatus("done"))
      .catch((err: Error) => {
        setErrorMsg(err.message);
        setStatus("error");
      });
  }, [loading, user, status]);

  if (loading || status === "saving") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-gray-500">Saving to Cliphy…</p>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-sm font-medium">Saved to Cliphy</p>
        <a href="/dashboard" className="text-sm text-blue-600 underline">
          View your clips
        </a>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-sm text-red-600">{errorMsg}</p>
        <a href="/dashboard" className="text-sm text-blue-600 underline">
          Go to dashboard
        </a>
      </div>
    );
  }

  return null;
}
