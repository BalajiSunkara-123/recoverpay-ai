/**
 * RecoverPay Server Entry Point
 * Express 4 + Vite Middleware running on port 3000
 * Imports unified app from server/app.ts
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { app } from './server/app.ts';

const PORT = 3000;

async function startServer() {
  // --- VITE MIDDLEWARE SETUP ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[RecoverPay] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[RecoverPay] Startup error:', err);
  process.exit(1);
});

export default app;
