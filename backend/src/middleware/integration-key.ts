import { NextFunction, Request, Response } from 'express';

export function requireIntegrationKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.SAP_INBOUND_API_KEY;
  if (!expected) return res.status(503).json({ error: 'SAP inbound integration key is not configured' });
  const supplied = req.header('x-mes-integration-key');
  if (!supplied || supplied !== expected) return res.status(401).json({ error: 'Invalid integration key' });
  next();
}
