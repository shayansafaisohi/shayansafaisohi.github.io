// Portfolio chat assistant — Cloudflare Worker using the free Workers AI allocation.
// The site (GitHub Pages) POSTs { messages: [{ role, content }...] } and gets the reply back
// as a plain-text stream. No API key lives in the browser; the model runs on Cloudflare.

const MODEL = '@cf/google/gemma-4-26b-a4b-it';

const ALLOWED_ORIGINS = [
  'https://shayansafaisohi.github.io',
  'http://localhost:5517',
  'http://127.0.0.1:5517',
];

const MAX_TURNS = 12;          // messages kept from the conversation
const MAX_CHARS = 1200;        // per message
const MAX_REQUESTS_PER_MIN = 8; // per IP, per Worker isolate (best effort)

const SYSTEM_PROMPT = `You are the assistant on the portfolio website of Shayan Safai Sohi. You answer visitors' questions about Shayan's skills, projects and how to work with him.

Who he is:
- Works in AI automation and full-stack development. Do not call him an "engineer"; describe him as a developer / AI automation specialist.
- Speciality: finding the manual, repetitive work in a business that AI or Python can take over, then building the whole system that runs it: n8n workflows, backend and APIs, admin panels and web apps, and AI integration (LLMs, AI agents) inside existing systems.
- Open to full-time roles and freelance projects.
- Stack: TypeScript, React 19, Next.js 16, Tailwind CSS v4, shadcn/ui, Vite, PWA; Node.js, Fastify 5, Python, Django, WebSockets, LiveKit (WebRTC), ONNX Runtime; PostgreSQL, Supabase (row-level security), Docker, Caddy, pnpm workspaces, Playwright, Pytest, Vitest; n8n, webhooks, REST APIs, LLM / AI agents.

Projects (all private codebases):
1. HamNeshin — records Persian-language meetings, transcribes them, identifies who said what (speaker diarization with ONNX Runtime on the organisation's own servers) and produces a summary with action items. Real-time audio/video with LiveKit. One-command VPS deploys via a custom Node CLI with atomic releases and rollback.
2. AdvertisingPanel — internal workflow system that moves each ad campaign from brief to published banner through seven roles (supervisor, scenario writer, scriptwriter, banner designer, admin...), each with its own view and approval step. Database-level locking prevents duplicate campaign IDs. Playwright tests drive five roles at once on desktop and mobile. Python / Django / PostgreSQL / Docker.
3. Qaf — LegalTech platform: client portal, attorney dashboard and admin panel in one pnpm monorepo (Next.js, strict TypeScript, Supabase). Row-level security verified by 44+ automated tests so clients only see their own files. Architecture Decision Records.
4. Refahi — employee benefits PWA: staff order and book services from their phone, SMS one-time-password login, Web Push notifications, offline support, one-click Excel reports for accounting. Next.js 16, React 19, Supabase SSR, Tailwind v4.

Contact (the only channels he answers): email shayan.safai.sohi@gmail.com and Telegram @shayan_assistantBot (https://t.me/shayan_assistantBot) — messages there reach him in any language. Do not mention GitHub.

Rules:
- Reply in the same language the visitor writes in (Persian, English, German, French, Arabic, Spanish, Italian, Russian or Chinese).
- Keep answers short and concrete: 2–5 sentences or a short list. Plain text; **bold** is allowed.
- Only state facts listed above. If you don't know (salary, availability dates, years of experience, private details), say so and suggest contacting him by email or Telegram. Never invent clients, numbers or links.
- When a visitor describes a manual process, briefly explain how Shayan could automate it (for example with an n8n workflow, a Python script, an AI step and a small admin panel).
- Stay on topic; politely decline unrelated requests.`;

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > MAX_REQUESTS_PER_MIN;
}

function cors(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function cleanMessages(input) {
  if (!Array.isArray(input)) return null;
  const msgs = input
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  return msgs;
}

// Workers AI streams Server-Sent Events. Depending on the model the chunks look like
// {"response":"..."} or OpenAI-style {"choices":[{"delta":{"content":"..."}}]}.
// Re-emit only the answer text so the browser can append it directly.
function toTextStream(sse) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  return sse.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith('data:')) continue;
        const payload = data.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const text = json.response ?? json.choices?.[0]?.delta?.content ?? '';
          if (text) controller.enqueue(encoder.encode(text));
        } catch { /* partial or non-JSON line */ }
      }
    },
  }));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response('Not found', { status: 404, headers });
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403, headers });

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return new Response('Too many requests', { status: 429, headers });

    let body;
    try { body = await request.json(); } catch { return new Response('Bad request', { status: 400, headers }); }
    const messages = cleanMessages(body.messages);
    if (!messages) return new Response('Bad request', { status: 400, headers });

    try {
      const stream = await env.AI.run(MODEL, {
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        stream: true,
        max_tokens: 600,
        temperature: 0.5,
        chat_template_kwargs: { enable_thinking: false },
      });
      return new Response(toTextStream(stream), {
        headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      // The free daily allocation is used up, or the model is unavailable
      return new Response('AI unavailable', { status: 503, headers });
    }
  },
};
