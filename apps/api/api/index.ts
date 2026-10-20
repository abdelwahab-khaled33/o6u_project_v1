import { createApp } from '../src/app';

// Vercel entry point: the Node runtime wraps this default-exported Express app as a
// serverless function. Every request Vercel routes here keeps its original URL
// (/api/v1/...), which is what the mounted routers in app.ts match on. Local development
// does not use this file — `npm run dev` still boots src/index.ts on a port.
// The import is extensionless on purpose so Vercel's bundler resolves it the same way
// our own tsconfig (moduleResolution: Bundler) does.
export default createApp();
