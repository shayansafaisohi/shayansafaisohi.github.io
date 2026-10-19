// Portfolio chat assistant — Cloudflare Worker.
// The site (GitHub Pages) POSTs { messages: [{ role, content }...] } and gets the reply back
// as a plain-text stream. No API key lives in the browser.
// Replies come from Claude (CLAUDE_MODEL / CLAUDE_EFFORT in wrangler.toml, key in the
// ANTHROPIC_API_KEY secret); if Claude is unreachable or no key is set, the free Workers AI
// model answers instead.

import Anthropic from '@anthropic-ai/sdk';

const FALLBACK_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const encoder = new TextEncoder();

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

// Streams Claude's answer text. The first event is awaited before returning, so a bad key, an
// outage or a rate limit throws here and the caller can still fall back to Workers AI.
async function claudeStream(env, messages) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const events = client.messages.stream({
    model: env.CLAUDE_MODEL || 'claude-haiku-5-5', // default if the variable is missing
    max_tokens: 2000, // thinking counts toward this too
    system: SYSTEM_PROMPT,
    messages,
    output_config: { effort: env.CLAUDE_EFFORT || 'medium' },
  })[Symbol.asyncIterator]();
  const first = await events.next();

  let wrote = false;
  // Returns the bytes to send for one event, or null. Only answer text is forwarded;
  // thinking blocks arrive empty and are skipped.
  const bytesOf = event => {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      wrote = true;
      return encoder.encode(event.delta.text);
    }
    if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal' && !wrote) {
      return encoder.encode('Sorry, I can\'t help with that here. You can reach Shayan by email (shayan.safai.sohi@gmail.com) or on Telegram (@shayan_assistantBot).');
    }
    return null;
  };

  let pending = first;
  return new ReadableStream({
    // Keep reading until there is something to send: a pull that enqueues nothing stalls the stream.
    async pull(controller) {
      try {
        for (;;) {
          const { value, done } = pending || await events.next();
          pending = null;
          if (done) return controller.close();
          const bytes = bytesOf(value);
          if (bytes) return controller.enqueue(bytes);
        }
      } catch (err) {
        console.error('Claude stream broke:', err.message);
        controller.close();
      }
    },
    cancel() {
      events.return?.();
    },
  });
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

    const textHeaders = { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
    if (env.ANTHROPIC_API_KEY) {
      try {
        return new Response(await claudeStream(env, messages), { headers: textHeaders });
      } catch (err) {
        console.error('Claude failed, falling back to Workers AI:', err.message);
      }
    }

    try {
      const stream = await env.AI.run(FALLBACK_MODEL, {
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        stream: true,
        max_tokens: 600,
        temperature: 0.5,
        chat_template_kwargs: { enable_thinking: false },
      });
      return new Response(toTextStream(stream), { headers: textHeaders });
    } catch (err) {
      // The free daily allocation is used up, or the model is unavailable
      return new Response('AI unavailable', { status: 503, headers });
    }
  },
};
