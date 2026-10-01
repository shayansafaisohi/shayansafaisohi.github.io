// Renders scene.html frame-by-frame in headless Chrome and pipes JPEG frames into ffmpeg.
// Usage: node render.js preview 1.0 7.5 ...   -> writes preview PNGs at given seconds
//        node render.js video <out.mp4> [fps]
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = process.env.FFMPEG;

(async () => {
  const [mode, ...args] = process.argv.slice(2);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message));
  await page.goto('file:///' + path.resolve(__dirname, 'scene.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await page.evaluate(() => window.ready);

  if (mode === 'preview') {
    for (const s of args) {
      await page.evaluate(t => window.render(t), +s);
      await page.screenshot({ path: path.resolve(__dirname, `prev-${s}.png`) });
      console.log('frame', s);
    }
  } else {
    const out = args[0];
    const fps = +(args[1] || 30);
    const total = await page.evaluate(() => window.TOTAL);
    const frames = Math.round(total * fps);
    const ff = spawn(FFMPEG, ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let f = 0; f < frames; f++) {
      await page.evaluate(t => window.render(t), f / fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (f % 60 === 0) console.log(`frame ${f}/${frames}`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
  }
  await browser.close();
})();
