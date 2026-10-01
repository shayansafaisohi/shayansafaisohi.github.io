# shayansafaisohi.github.io

Personal portfolio — AI automation & full-stack development. Served by GitHub Pages from `main`.

## Structure

| Path | What it is |
| --- | --- |
| `index.html` | The whole site: markup, styles, translations (9 languages) and scripts |
| `assets/tailwind.css` | Prebuilt Tailwind utilities used by `index.html` |
| `assets/showcase.mp4`, `assets/showcase-poster.jpg` | Project showcase video and its poster frame |
| `assets/resume-en.pdf`, `assets/resume-fa.pdf` | One-page resume (English / Persian), linked from the nav |
| `assets/og-image.jpg` | Link-preview image (Open Graph / Twitter card) |
| `sitemap.xml`, `robots.txt` | For search engines |
| `tools/tailwind/` | Tailwind config and input for building `assets/tailwind.css` |
| `tools/showcase/` | Source scene and renderer for the showcase video |
| `tools/cv/` | HTML sources and build script for the resumes and the preview image |
| `tools/chat-worker/` | Cloudflare Worker behind the AI chat assistant |

## Rebuilding Tailwind

Tailwind is **not** loaded from a CDN — the utilities are prebuilt into `assets/tailwind.css`.
After adding or changing Tailwind classes in `index.html`, rebuild it from the repo root, otherwise the new classes get no styles:

```bash
npx tailwindcss@3 -c tools/tailwind/tailwind.config.js -i tools/tailwind/input.css -o assets/tailwind.css --minify
```

Custom (non-Tailwind) styles live in the `<style>` block of `index.html` and need no build step.

## Re-rendering the showcase video

The video is rendered frame-by-frame from `tools/showcase/scene.html` in headless Chrome and encoded with ffmpeg.
Needs Node.js, Google Chrome, `puppeteer-core` and an ffmpeg binary:

```bash
cd tools/showcase
npm install puppeteer-core@23
FFMPEG=/path/to/ffmpeg node render.js video ../../assets/showcase.mp4 30
```

`node render.js preview 2.5 9.4` writes PNG previews of single moments instead.

## Rebuilding the resumes and preview image

Edit `tools/cv/resume-en.html`, `tools/cv/resume-fa.html` or `tools/cv/og.html`, then from the repo root:

```bash
npm install puppeteer-core@23
node tools/cv/build.js
```

It writes the two PDFs and `assets/og-image.jpg`, and warns if a resume no longer fits on one page.

## AI chat assistant

The chat widget posts to a Cloudflare Worker (`tools/chat-worker/`) that runs a model on the free Workers AI allocation; no API key lives in the site.
The Worker only accepts requests from the site's origin and rate-limits per IP. Its system prompt holds the portfolio facts — update it when the content changes, then redeploy:

```bash
cd tools/chat-worker
npx wrangler login    # first time only
npx wrangler deploy
```

The Worker URL is set in `CHAT_ENDPOINT` inside `index.html`.

## Local preview

```bash
python -m http.server 5517
```

Then open http://localhost:5517.
