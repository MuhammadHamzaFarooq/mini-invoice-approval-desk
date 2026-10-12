import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { invoicesRouter } from './routes/invoices.js';

export function createApp() {
  const app = express();

  app.use(cors());
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
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  createApp().listen(PORT, () => {
    console.log(`Invoice approval desk API listening on http://localhost:${PORT}`);
  });
}
