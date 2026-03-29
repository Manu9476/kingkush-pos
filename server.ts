import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  if (process.env.NODE_ENV === 'development') {
    console.log('--- KingKush POS Server ---');
    console.log(`CWD: ${process.cwd()}`);
    console.log(`__dirname: ${__dirname}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  }

  // API Health Check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', env: process.env.NODE_ENV });
  });

  const distPath = path.resolve(process.cwd(), 'dist');
  const indexHtmlPath = path.resolve(distPath, 'index.html');
  
  const hasDist = fs.existsSync(distPath);
  if (process.env.NODE_ENV === 'development') {
    console.log(`Checking for dist at: ${distPath}`);
    console.log(`Dist exists: ${hasDist}`);
    if (hasDist) {
      console.log(`Checking for index.html at: ${indexHtmlPath}`);
      console.log(`index.html exists: ${fs.existsSync(indexHtmlPath)}`);
    }
  }

  // If we have a dist folder, we prefer serving it (Production behavior)
  // This ensures that even in dev mode, if we built the app, we can see the production version.
  // But for AI Studio, we want the dev URL to use Vite middleware for HMR-like behavior.
  
  const useVite = process.env.NODE_ENV !== 'production' && !process.env.USE_DIST;

  if (useVite) {
    if (process.env.NODE_ENV === 'development') {
      console.log('Using Vite middleware (Development Mode)');
    }
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    
    app.get('*', (req, res, next) => {
      if (req.url.startsWith('/api')) return next();
      res.sendFile(path.resolve(process.cwd(), 'index.html'));
    });
  } else {
    if (process.env.NODE_ENV === 'development') {
      console.log('Serving static files (Production Mode)');
    }
    if (!hasDist) {
      console.error('ERROR: dist folder missing! Attempting to serve root index.html as fallback (likely to fail assets)');
      app.use(express.static(process.cwd()));
      app.get('*', (_req, res) => {
        res.sendFile(path.resolve(process.cwd(), 'index.html'));
      });
    } else {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(indexHtmlPath);
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`Server listening on http://0.0.0.0:${PORT}`);
    }
  });
}

startServer().catch((err) => {
  console.error('FATAL ERROR STARTING SERVER:', err);
  process.exit(1);
});
