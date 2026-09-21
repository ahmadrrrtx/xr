import puppeteer from "puppeteer";
const browser = await puppeteer.launch({headless:true, args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]});
const page = await browser.newPage();
page.setViewport({width:1440,height:900});
for (const [fn,title] of [["fix-memory","Memory"],["fix-agents","Agents"],["fix-library","Library"]]) {
  await page.goto("http://localhost:5173/",{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".rail-btn");
  for (const b of await page.$$(".rail-btn")) {
    const t = await b.evaluate(el => el.getAttribute("title")||"");
    if (t.includes(title)) { await b.click(); break; }
  }
  await new Promise(r=>setTimeout(r,500));
  await page.screenshot({path:"/tmp/xr-shots/"+fn+".png"});
  console.log("shot",fn);
}
await browser.close();
