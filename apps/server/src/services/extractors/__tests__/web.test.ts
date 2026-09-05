import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { classifyAndBuild } from "../web.js";

const ARTICLE_HTML = `<!doctype html><html><head>
  <title>How to Brew Coffee</title>
  <meta property="og:site_name" content="Coffee Blog" />
  <meta property="og:image" content="https://cdn.test/hero.jpg" />
</head><body><article>
  <h1>How to Brew Coffee</h1>
  ${"<p>Grind the beans to a medium consistency and pour slowly over the filter in concentric circles for even extraction.</p>".repeat(12)}
</article></body></html>`;

const VISUAL_HTML = `<!doctype html><html><head>
  <title>Design Studio</title>
  <meta property="og:site_name" content="Studio" />
  <meta property="og:image" content="https://cdn.test/portfolio.jpg" />
  <meta name="description" content="A portfolio of brand systems." />
</head><body><main><div class="gallery"></div></main></body></html>`;

describe("web extractor classification", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Web Extraction");
  });

  it("classifies a text-dense page as an article with reading content", () => {
    const clip = classifyAndBuild(ARTICLE_HTML, "https://coffee.test/brew");
    expect(clip.kind).toBe("article");
    expect(clip.title).toBe("How to Brew Coffee");
    expect(clip.siteName).toBe("Coffee Blog");
    expect(clip.heroImageUrl).toBe("https://cdn.test/hero.jpg");
    expect(clip.content.length).toBeGreaterThan(200);
    expect(clip.readingTimeMin).toBeGreaterThanOrEqual(1);
  });

  it("classifies a sparse page as visual with an excerpt but no body content", () => {
    const clip = classifyAndBuild(VISUAL_HTML, "https://studio.test/");
    expect(clip.kind).toBe("visual");
    expect(clip.heroImageUrl).toBe("https://cdn.test/portfolio.jpg");
    expect(clip.excerpt).toBe("A portfolio of brand systems.");
    expect(clip.content).toBe("");
  });
});
