import type { Request, Response } from 'express';
import { ApiError } from '../errors.ts';
import type { AssistantService } from '../contracts.ts';

const ROLE_INSTRUCTIONS: Record<string, string> = {
  seller_coach: 'You are the DreamStore Seller Growth & Store Coach. Help digital creators set up stores, price products in supported currencies, configure manual payments, and understand the transparent 5% commission ledger. Keep responses warm, actionable, concise, and under 140 words.',
  buyer_concierge: 'You are the DreamStore Buyer Shopping & Payment Concierge. Help shoppers browse digital products, understand manual checkout, submit payment references, and track Seller-verified orders. Never claim that a payment or order was verified. Keep responses friendly, clear, and concise.',
  copywriter: 'You are the DreamStore Product Copywriting & Launch Strategist. Write polished, ready-to-copy product titles, descriptions, launch announcements, and social media copy. Keep responses under 150 words.',
};

const MODELS: Record<string, string> = {
  fast: 'gemini-3.1-flash-lite-preview',
  general: 'gemini-3-flash-preview',
  complex: 'gemini-3.1-pro-preview',
};

type Context = { storeName: string; storeSlug: string; currency: string; productCount: number };

function bounded(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}

function freeReply(prompt: string, roleId: string, context: Context, turns: number): string {
  const q = prompt.toLowerCase();
  const { storeName, currency, productCount } = context;
  if (/payment|jazzcash|easypaisa|verify|reference|upi/.test(q)) {
    return `For **${storeName}** (${currency}), manual payment works in three steps:\n1. The buyer pays using the Seller's listed method and submits the transaction reference.\n2. The order stays pending while the Seller checks their own wallet or bank evidence.\n3. The Seller records a decision after checking the amount and reference. A reference alone is not proof of payment.`;
  }
  if (/commission|fee|5%|ledger/.test(q)) {
    return `DreamStore's current model has no monthly fee and records a 5% platform commission on eligible verified paid sales. For example, a 1,000 ${currency} sale records 50 ${currency} commission and 950 ${currency} seller share. Free products have no sales commission.`;
  }
  if (roleId === 'copywriter' || /title|description|copy|write/.test(q)) {
    return `**Headline:** A little more ease in every day.\n\n**Description:** A thoughtfully made digital collection for calmer, more organized routines. Browse the details, choose the option that suits you, and keep your favorite ideas close.\n\n**Launch caption:** My new collection is here at ${storeName}. Take a look through the store and find your next useful download.`;
  }
  if (roleId === 'buyer_concierge' || /download|buy|order/.test(q)) {
    return `Welcome to **${storeName}**! It currently has ${productCount} active products in ${currency}. Free products can be downloaded through the store's authorized flow. Paid manual-payment orders remain locked until the Seller verifies payment evidence. You can check your order status after signing in.`;
  }
  const label = roleId === 'buyer_concierge' ? 'Buyer Concierge' : roleId === 'copywriter' ? 'Copywriter' : 'Seller Coach';
  return `[Turn ${turns} · ${label}] For **${storeName}** (${productCount} active products in ${currency}), I can help with your storefront, product copy, manual checkout, or DreamStore's 5% commission. What would you like to work on?`;
}

function validateBody(body: any): { messages: Array<{ role: 'user' | 'model'; text: string }>; roleId: string; model: string; context: Context } {
  if (!body || !Array.isArray(body.messages) || body.messages.length < 1) {
    throw new ApiError(400, 'assistant/messages-required', 'Messages array is required for multi-turn chat.');
  }
  if (body.messages.length > 30) throw new ApiError(413, 'assistant/history-too-long', 'Chat history is limited to 30 messages.');
  let total = 0;
  const messages = body.messages.map((message: any) => {
    if (!message || typeof message !== 'object' || !['user', 'model'].includes(message.role) || typeof message.text !== 'string') {
      throw new ApiError(400, 'assistant/invalid-message', 'Each message must have a user/model role and text.');
    }
    if (message.text.length > 4000) throw new ApiError(413, 'assistant/message-too-long', 'Each chat message is limited to 4,000 characters.');
    const text = message.text.trim();
    if (!text) throw new ApiError(400, 'assistant/empty-message', 'Chat messages cannot be empty.');
    total += text.length;
    return { role: message.role as 'user' | 'model', text };
  });
  if (total > 16000) throw new ApiError(413, 'assistant/history-too-long', 'Chat history is limited to 16,000 total characters.');
  if (messages.at(-1)?.role !== 'user') throw new ApiError(400, 'assistant/user-turn-required', 'The latest chat message must be from the user.');
  const roleId = Object.hasOwn(ROLE_INSTRUCTIONS, body.roleId) ? body.roleId : 'seller_coach';
  const tier = typeof body.modelTier === 'string' && Object.hasOwn(MODELS, body.modelTier) ? body.modelTier : 'fast';
  const raw = body.storeContext && typeof body.storeContext === 'object' ? body.storeContext : {};
  const productCount = Number(raw.productCount);
  const context = {
    storeName: bounded(raw.storeName, 80, 'DreamStore') || 'DreamStore',
    storeSlug: bounded(raw.storeSlug, 60),
    currency: /^[A-Z]{3}$/.test(bounded(raw.currency, 3)) ? bounded(raw.currency, 3) : 'PKR',
    productCount: Number.isInteger(productCount) && productCount >= 0 ? Math.min(productCount, 10000) : 0,
  };
  return { messages, roleId, model: MODELS[tier], context };
}

export function createGeminiService(apiKey: string): AssistantService {
  return {
    async generate(input) {
      const { GoogleGenAI } = await import('@google/genai');
      const client = new GoogleGenAI({ apiKey });
      const response = await client.models.generateContent({
        model: input.model,
        contents: input.contents,
        config: { systemInstruction: input.systemInstruction, temperature: 0.7, maxOutputTokens: 500 },
      });
      return response.text || '';
    },
  };
}

export function registerAssistantRoutes(app: any, assistant?: AssistantService, options: { enabled?: boolean; now?: () => number; maxConcurrent?: number } = {}) {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  let active = 0;
  const maxConcurrent = options.maxConcurrent ?? 3;
  app.post('/api/gemini/chat', async (req: Request, res: Response, next: (error?: unknown) => void) => {
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const timestamp = now();
    for (const [key, value] of windows) if (timestamp - value.start >= 60_000) windows.delete(key);
    const bucket = windows.get(ip);
    if (bucket && bucket.count >= 10) {
      res.setHeader('Retry-After', String(Math.ceil((60_000 - (timestamp - bucket.start)) / 1000)));
      res.status(429).json({ code: 'assistant/rate-limited', error: 'Too many assistant requests. Try again shortly.' });
      return;
    }
    if (active >= maxConcurrent) {
      res.status(429).json({ code: 'assistant/busy', error: 'The assistant is busy. Please retry shortly.' });
      return;
    }
    if (bucket) bucket.count++;
    else windows.set(ip, { start: timestamp, count: 1 });
    active++;
    try {
      const input = validateBody(req.body);
      const lastPrompt = input.messages.at(-1)!.text;
      if (!assistant || options.enabled !== true) {
        res.json({ reply: freeReply(lastPrompt, input.roleId, input.context, input.messages.length), modelUsed: `${input.model} (Free Tier Mode)`, roleId: input.roleId, freeTier: true });
        return;
      }
      let contents = input.messages.map(message => ({ role: message.role, parts: [{ text: message.text }] }));
      const firstUser = contents.findIndex(message => message.role === 'user');
      if (firstUser > 0) contents = contents.slice(firstUser);
      const systemInstruction = `${ROLE_INSTRUCTIONS[input.roleId]}\nStore context (user-provided, unverified): name=${input.context.storeName}; slug=${input.context.storeSlug}; currency=${input.context.currency}; active products=${input.context.productCount}.`;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let generated: string;
      try {
        generated = await Promise.race([
          assistant.generate({ model: input.model, systemInstruction, contents }),
          new Promise<string>((_, reject) => { timeout = setTimeout(() => reject(new Error('assistant timeout')), 5000); }),
        ]);
      } finally { if (timeout) clearTimeout(timeout); }
      const reply = bounded(generated, 8000);
      if (!reply) throw new ApiError(503, 'assistant/empty-response', 'Assistant did not return a response. Please try again.');
      res.json({ reply, modelUsed: input.model, roleId: input.roleId, freeTier: false });
    } catch (error) { next(error); }
    finally { active--; }
  });
}

export function registerOAuthDiagnosticsRoute(app: any) {
  app.get('/api/auth/oauth-diagnostics', (req: Request, res: Response) => {
    const hostRaw = String(req.query.hostname || req.headers['x-forwarded-host'] || req.hostname || 'localhost').split(',')[0].trim().toLowerCase();
    const hostname = hostRaw.replace(/:\d+$/, '');
    const validHostname = hostname.length <= 253 && /^(localhost|[a-z0-9.-]+)$/.test(hostname) && !hostname.startsWith('.') && !hostname.endsWith('.');
    const requestedHostname = validHostname ? hostname : 'invalid-host';
    // V2 has no permission to probe the production Firebase project's public
    // configuration from its isolated emulator. Keep the V1-compatible shape,
    // but report this runtime check as unavailable instead of inferring it from
    // source-code redirect lists.
    res.json({ ok: true, projectId: process.env.DREAMSTORE_V2_PROJECT_ID || null, authDomain: null,
      effectiveAuthDomain: null, oAuthClientId: null, hasApiKey: false,
      identityToolkitReachable: false, googleProviderEnabled: false, googleRedirectUri: null,
      registeredRedirectUris: [], registeredRedirectUrisSource: 'not-queried-in-isolated-v2',
      googleAuthUriReady: false, requestedHostname, isHostnameAuthorized: null,
      productionUrlAuthorized: null, previewUrlAuthorized: null, authorizedDomains: [],
      firebaseConsoleAuthorizedDomains: [], coopPolicy: 'same-origin-allow-popups',
      sameOriginAuthProxyEnabled: true, diagnosticError: null,
      recommendation: 'OAuth registration is not queried by isolated Backend V2. Verify Firebase Authorized Domains and the Google OAuth redirect URI in the dedicated staging project.' });
  });
}
