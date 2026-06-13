import { chromium } from "playwright";

const scenes = [
  { scene: "large-tile",    width: 920,  height: 680, out: "promo-tile-920x680.png" },
  { scene: "marquee",       width: 1400, height: 560, out: "promo-marquee-1400x560.png" },
  { scene: "shot3",         width: 1280, height: 800, out: "screenshot-3-howitworks.png" },
  { scene: "web-dashboard", width: 1280, height: 800, out: "screenshot-4-dashboard.png" },
  { scene: "mobile",        width: 1280, height: 800, out: "screenshot-5-mobile.png" },
];

const browser = await chromium.launch({ channel: "chrome" });

for (const { scene, width, height, out } of scenes) {
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`http://localhost:5179/?scene=${scene}`, { waitUntil: "networkidle" });
  // wait for YouTube thumbnails to load
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `../../../docs/store-assets/${out}`, clip: { x: 0, y: 0, width, height } });
  console.log(`✓ ${out} (${width}×${height})`);
  await page.close();
}

await browser.close();
