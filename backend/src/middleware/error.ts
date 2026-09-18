import { NextFunction, Request, Response } from 'express';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = err?.status ?? 500;
  const message = status >= 500 ? 'Unexpected server error' : err.message;
  (req as any).log?.error?.({ err, requestId: req.requestId }, 'request failed');
  res.status(status).json({ error: message, requestId: req.requestId });
}
