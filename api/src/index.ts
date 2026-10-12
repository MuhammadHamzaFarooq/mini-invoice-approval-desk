import { createApp } from './app.js';

/**
 * Server entry point. The app itself lives in app.ts.
 *
 * Nothing touches the database here. Schema creation happens lazily on the
 * first request that needs it (see db/index.ts): doing it at module scope means
 * a database problem crashes the process before it can serve anything, which on
 * a serverless host surfaces as an opaque invocation failure on every route —
 * including the health check that would otherwise tell you what went wrong.
 */
const PORT = Number(process.env.PORT ?? 4000);

createApp().listen(PORT, () => {
  console.log(`Invoice approval desk API listening on http://localhost:${PORT}`);
});
