import puppeteer from "puppeteer";
import fs from "node:fs";

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
page.setViewport({ width: 1440, height: 900 });
fs.mkdirSync("/tmp/xr-shots", { recursive: true });

// Screenshot home, then dispatch a synthetic area switch via titlebar clicks.
// Use labels map — simpler: press ⌘K to open palette and type each area name.
await page.goto("http://localhost:5173/", { waitUntil: "networkidle2" });
await page.screenshot({ path: "/tmp/xr-shots/01-home.png" });
console.log("shot home");

// Click each rail bottom button by title
const railTitles = ["Workbench","Research","Agents","Library","Memory","Runs history","Diagnostics","Settings"];
for (let i = 0; i < railTitles.length; i++) {
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".rail-btn");
  const btns = await page.$$(".rail-btn");
  for (const b of btns) {
    const t = await b.evaluate(el => el.getAttribute("title") || "");
    if (t.includes(railTitles[i])) { await b.click(); break; }
  }
  await new Promise(r => setTimeout(r, 500));
  const fn = railTitles[i].toLowerCase().replace(/[^a-z0-9]/g,"-");
  await page.screenshot({ path: `/tmp/xr-shots/${String(i+2).padStart(2,"0")}-${fn}.png` });
  console.log("shot", fn);
}

await browser.close();
console.log("done");
