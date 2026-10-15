import type { ErrorRequestHandler } from 'express';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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
  const parserError = error as { type?: unknown; status?: unknown } | null;
  if (parserError?.type === 'entity.parse.failed' && parserError.status === 400) {
    res.status(400).json({ code: 'request/invalid-json', error: 'Request body must be valid JSON.' });
    return;
  }
  if (parserError?.type === 'entity.too.large' && parserError.status === 413) {
    res.status(413).json({ code: 'request/too-large', error: 'Request body exceeds the allowed size.' });
    return;
  }
  // Deliberately never serialize the thrown error: it may contain tokens,
  // IAM metadata, customer records or service-account details.
  console.error('[DreamStore V2] request failed', { code: safeBackendCategory(error) });
  res.status(503).json({ code: 'backend/unavailable', error: 'This service is temporarily unavailable.' });
};
