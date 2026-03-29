import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(process.cwd(), 'api');

function resolveApiHandlerFile(urlPath: string) {
  const cleanPath = urlPath.split('?')[0].replace(/^\/+/, '');
  if (!cleanPath.startsWith('api/')) {
    return null;
  }

  const relativePath = cleanPath.slice(4);
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return null;
  }

  const resolveCandidate = (target: string) => {
    if (!target.startsWith(apiRoot)) {
      return null;
    }
    return fs.existsSync(target) ? target : null;
  };

  const exactTarget = resolveCandidate(path.resolve(apiRoot, `${segments.join(path.sep)}.ts`));
  if (exactTarget) {
    return exactTarget;
  }

  if (segments.length >= 2) {
    return resolveCandidate(path.resolve(apiRoot, ...segments.slice(0, -1), '[action].ts'));
  }

  return null;
}

async function loadApiHandler(handlerFile: string) {
  const moduleUrl = `${pathToFileURL(handlerFile).href}?v=${fs.statSync(handlerFile).mtimeMs}`;
  const module = await import(moduleUrl);
  if (typeof module.default !== 'function') {
    throw new Error(`API handler "${handlerFile}" does not export a default function.`);
  }
  return module.default;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

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

  app.all('/api/*', async (req, res, next) => {
    if (req.path === '/api/health') {
      return next();
    }

    try {
      const handlerFile = resolveApiHandlerFile(req.path);
      if (!handlerFile) {
        return res.status(404).json({ error: 'API route not found' });
      }

      const handler = await loadApiHandler(handlerFile);
      return handler(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API runtime error';
      return res.status(500).json({ error: message });
    }
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
