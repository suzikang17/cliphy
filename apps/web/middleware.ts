const BOT_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Discordbot|WhatsApp|TelegramBot|Googlebot|bingbot|yandex|Baiduspider/i;

export const config = {
  matcher: "/summary/:id",
};

export default async function middleware(request: Request) {
  const ua = request.headers.get("user-agent") ?? "";

  if (!BOT_UA.test(ua)) {
    // Real user — let the SPA handle it
    return;
  }

  // Bot — fetch summary data and return OG meta tags
  const url = new URL(request.url);
  const id = url.pathname.split("/summary/")[1];
  if (!id) return;

  const apiUrl = process.env.API_URL || "https://api.cliphy.app";

  try {
    const res = await fetch(`${apiUrl}/api/summaries/${id}`);
    if (!res.ok) return;

    const { summary } = (await res.json()) as {
      summary: {
        videoId: string;
        videoTitle?: string;
        videoChannel?: string;
        summaryJson?: { summary: string };
      };
    };

    const title = summary.videoTitle || "Video Summary";
    const description = summary.summaryJson?.summary || "AI-powered YouTube video summary";
    const thumbnail = `https://i.ytimg.com/vi/${summary.videoId}/hqdefault.jpg`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} — Cliphy</title>
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="${escapeAttr(description)}" />
  <meta property="og:image" content="${thumbnail}" />
  <meta property="og:url" content="${url.href}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Cliphy" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttr(title)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  <meta name="twitter:image" content="${thumbnail}" />
</head>
<body>
  <p>${escapeHtml(title)}</p>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch {
    // If API call fails, let the SPA handle it
    return;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
