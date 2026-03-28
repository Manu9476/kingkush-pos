# KingKush POS

Production-ready VS Code project migrated from Google AI Studio and fully decoupled from Firebase.

## Architecture

- Frontend: React + Vite + TypeScript
- Data/Auth layer: Local structured adapter in `src/data.ts`
- Optional server layer: `server.ts` (Express + Vite middleware for unified runtime)

The project now runs independently in VS Code and is organized to support future backend API migration without rewriting UI workflows.

## Quick Start

Prerequisites:
- Node.js 20+

Install dependencies:

```bash
npm install
```

Run frontend development server:

```bash
npm run dev
```

Open:
- `http://localhost:5173`

## Available Scripts

- `npm run dev` - Vite frontend development server
- `npm run dev:server` - Express + Vite middleware runtime
- `npm run build` - Production build to `dist/`
- `npm run preview` - Preview production build
- `npm run start` - Production server (`server.ts`, static dist serving)
- `npm run lint` - TypeScript type-check

## Auth and Data Notes

- Default bootstrap user:
  - Username: `admin`
  - Password: `admin123`
- App data is persisted in browser `localStorage` through the adapter layer.
- Existing screens still use collection/doc/query semantics through the adapter API, so replacing with real HTTP services later is straightforward.

## Deployment Paths

### Static Frontend

Use when you only need client-side hosting.

```bash
npm run build
```

Deploy the `dist/` folder to Netlify, Vercel, Cloudflare Pages, S3+CloudFront, or Nginx.

### Node Runtime

Use when you want one process that serves the app.

```bash
npm run build
npm run start
```

`server.ts` serves static assets in production mode and can be extended with API routes cleanly.
