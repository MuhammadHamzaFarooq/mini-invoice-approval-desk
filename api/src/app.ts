import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { invoicesRouter } from './routes/invoices.js';
import { databaseStatus, DatabaseUnavailableError } from './db/index.js';

/**
 * The Express app, separate from the server entry point in index.ts.
 *
 * Splitting them means a test can build the app and make requests against it
 * without binding a port, while the entry point can start listening
 * unconditionally — which is what a platform running this file expects.
 */
export function createApp() {
  const app = express();

  /**
   * CORS_ORIGIN pins the API to one frontend origin when the two are deployed
   * separately. On Vercel they are one project behind one domain, so requests
   * are same-origin and this stays unset — which is also what you want while
   * developing behind the Vite proxy.
   */
  const origin = process.env.CORS_ORIGIN;
  app.use(cors(origin ? { origin } : {}));
  app.use(express.json());

  /**
   * Accept the routes with or without the /api prefix.
   *
   * Vercel routes `/api/(.*)` to this service. Whether the platform forwards
   * the matched path intact or strips the prefix before the service sees it is
   * a deployment detail, and guessing wrong means a 404 on every endpoint.
   * Normalising here costs one middleware and makes the service correct either
   * way. Locally nothing changes: /api/invoices still works, because it is
   * rewritten to /invoices before the router sees it.
   */
  app.use((req, _res, next) => {
    if (req.url === '/api') req.url = '/';
    else if (req.url.startsWith('/api/')) req.url = req.url.slice(4);
    next();
  });

  /**
   * Health deliberately does not depend on the database. It answers 200 while
   * the process is alive and reports the database separately, so a deployment
   * with a bad or missing database URL is distinguishable from one that is
   * simply down — the two have completely different fixes.
   */
  app.get('/health', async (_req, res) => {
    const db = await databaseStatus();
    res.json({ ok: true, database: db.ok ? 'ok' : 'unavailable', ...(db.ok ? {} : { detail: db.detail }) });
  });

  app.use('/invoices', invoicesRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'No such endpoint.' });
  });

  // Nothing below this point should leak a stack trace to the client.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DatabaseUnavailableError) {
      // A misconfiguration, not a bug in a request. Say so plainly: this
      // message is the fastest route to the fix, and it names no secrets.
      return res.status(503).json({ error: 'DATABASE_UNAVAILABLE', message: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong.' });
  });

  return app;
}
