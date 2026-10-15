import type { ErrorRequestHandler } from 'express';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function safeBackendCategory(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[a-z][a-z0-9-]{0,31}\/[a-z][a-z0-9-]{0,63}$/.test(code)
    ? code
    : 'unclassified';
}

export const handleApiError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof ApiError) {
    res.status(error.status).json({ code: error.code, error: error.message });
    return;
  }
  // Deliberately never serialize the thrown error: it may contain tokens,
  // IAM metadata, customer records or service-account details.
  console.error('[DreamStore V2] request failed', { code: safeBackendCategory(error) });
  res.status(503).json({ code: 'backend/unavailable', error: 'This service is temporarily unavailable.' });
};
