import { createApp } from './app.js';
import { initialiseSchema } from './db/index.js';

/**
 * Server entry point. The app itself lives in app.ts.
 *
 * Schema creation is idempotent (CREATE TABLE IF NOT EXISTS) and is awaited
 * before the server accepts a request: without it, a deployment against a fresh
 * database passes its health check and then fails every query, because the seed
 * is not guaranteed to have been run against that database.
 */
await initialiseSchema();

const PORT = Number(process.env.PORT ?? 4000);

createApp().listen(PORT, () => {
  console.log(`Invoice approval desk API listening on http://localhost:${PORT}`);
});
