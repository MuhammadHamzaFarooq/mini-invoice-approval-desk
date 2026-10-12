import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { invoicesRouter } from './routes/invoices.js';
import { initialiseSchema } from './db/index.js';

export function createApp() {
  const app = express();

  /**
   * CORS_ORIGIN pins the API to one frontend origin in a deployment, e.g.
   * https://invoice-desk.vercel.app. Unset — the local default — allows any
   * origin, which is what you want while developing.
   */
  const origin = process.env.CORS_ORIGIN;
  app.use(cors(origin ? { origin } : {}));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/invoices', invoicesRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'No such endpoint.' });
  });

  // Nothing below this point should leak a stack trace to the client.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong.' });
  });

  return app;
}

const PORT = Number(process.env.PORT ?? 4000);

// Only listen when run directly, so tests can import createApp() without
// binding a port.
const entry = process.argv[1] ?? '';
if (entry.endsWith('index.ts') || entry.endsWith('index.js')) {
  // Idempotent CREATE TABLE IF NOT EXISTS. Without this a fresh deployment
  // starts against an empty database and every query fails — the seed script
  // is not guaranteed to have run against this database.
  await initialiseSchema();

  createApp().listen(PORT, () => {
    console.log(`Invoice approval desk API listening on http://localhost:${PORT}`);
  });
}
