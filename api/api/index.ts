import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/index.js';
import { initialiseSchema } from '../src/db/index.js';

/**
 * Vercel serverless entry point.
 *
 * The Express app is created once per cold start and reused across warm
 * invocations. Schema creation is kicked off once here, not awaited at module
 * scope, and every request waits on the same promise — so a cold start cannot
 * serve a query against a database whose tables do not exist yet, and warm
 * requests pay nothing for the check.
 */
const ready = initialiseSchema();
const app = createApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ready;
  return app(req, res);
}
