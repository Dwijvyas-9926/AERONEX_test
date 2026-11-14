/*
  Regenerates the icon files in public/ from the brand mark.
  Run with:  node scripts/brand-icons.cjs   (needs Playwright's Chromium).
*/
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT = path.join(__dirname, "..", "public");
const BG = "#14213d";
const PAPER = "#f6f3ec";
const glyph = `
  <path d="M11.5 53 L28.2 10 H35.8 L52.5 53 H44 L32 21.5 L20 53 Z" fill="#f28c38"/>
  <path d="M4 40.5 H60" stroke="${BG}" stroke-width="9.6"/>
  <path d="M6.5 40.5 H57.5" stroke="#f4f2ec" stroke-width="4.2"/>`;

const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${BG}"/>${glyph}</svg>`;
// Full-bleed square for platforms that round the corners themselves.
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${BG}"/>${glyph}</svg>`;
// Maskable: the mark inside the central 60% safe zone.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${BG}"/><g transform="translate(32 32) scale(0.62) translate(-32 -32)">${glyph}</g></svg>`;

const social = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${PAPER}"/>
  <path d="M0 470 H1200" stroke="#dad3c4" stroke-width="2"/>
  <g transform="translate(96 150) scale(2.6)"><rect width="64" height="64" rx="14" fill="${BG}"/>${glyph}</g>
  <text x="300" y="268" font-family="'Saira Semi Condensed', 'Arial Narrow', sans-serif" font-weight="600" font-size="118" letter-spacing="6" fill="${BG}">AERONEX</text>
  <text x="304" y="328" font-family="'Saira Semi Condensed', 'Arial Narrow', sans-serif" font-weight="500" font-size="40" letter-spacing="2" fill="#56617a">Ground Station</text>
  <text x="96" y="540" font-family="Manrope, Arial, sans-serif" font-size="30" fill="#33405c">Design, set up, fly and review a Pixhawk drone from the browser.</text>
</svg>`;

(async () => {
  fs.writeFileSync(path.join(OUT, "favicon.svg"), tile + "\n");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fontDir = path.join(OUT, "vendor", "fonts");
  const fonts = fs.existsSync(fontDir)
    ? fs.readdirSync(fontDir).filter((f) => /saira.*600.*woff2$/i.test(f) || /saira.*500.*woff2$/i.test(f) || /manrope.*woff2$/i.test(f))
    : [];
  const face = fonts
    .map((f) => {
      const data = fs.readFileSync(path.join(fontDir, f)).toString("base64");
      const family = /manrope/i.test(f) ? "Manrope" : "Saira Semi Condensed";
      const weight = /manrope/i.test(f) ? "200 800" : /600/.test(f) ? "600" : "500";
      return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
    })
    .join("");
  const shoot = async (svg, w, h, file) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<style>${face}html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, file), omitBackground: true });
  };
  await shoot(tile, 32, 32, "favicon-32.png");
  await shoot(square, 180, 180, "apple-touch-icon.png");
  await shoot(tile, 192, 192, "icon-192.png");
  await shoot(tile, 512, 512, "icon-512.png");
  await shoot(maskable, 512, 512, "icon-maskable-512.png");
  await shoot(social, 1200, 630, "social-card.png");
  await browser.close();
  console.log("icons written to public/");
})();
