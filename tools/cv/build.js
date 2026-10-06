// Builds assets/resume-<lang>.pdf (one per site language) and assets/og-image.jpg from the HTML templates here.
// Needs puppeteer-core and Google Chrome:  npm install puppeteer-core@23  then  node tools/cv/build.js  (from repo root)
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = f => path.resolve(__dirname, '../../assets', f);
const src = f => 'file:///' + path.resolve(__dirname, f).replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();

  for (const lang of ['en', 'fa', 'de', 'fr', 'ar', 'es', 'it', 'ru', 'zh']) {
    await page.goto(src(`resume-${lang}.html`), { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: out(`resume-${lang}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true });
    const gap = await page.evaluate(() => document.querySelector('footer').getBoundingClientRect().top - [...document.querySelectorAll('.proj')].pop().getBoundingClientRect().bottom);
    console.log(`resume-${lang}.pdf`, gap < 4 ? `WARNING: content runs into the footer (${gap.toFixed(0)}px)` : `ok (${gap.toFixed(0)}px spare)`);
  }

  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto(src('og.html'), { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out('og-image.jpg'), type: 'jpeg', quality: 88 });
  console.log('og-image.jpg ok');

  await browser.close();
})();
