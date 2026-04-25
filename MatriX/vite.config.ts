import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import type { Plugin, Connect } from 'vite';
import {defineConfig, loadEnv} from 'vite';

// ────────────────────────────────────────────────────────────
// Plugin: expone POST /api/subscribe y escribe public/subscribers.json
// Activo en `vite dev` y `vite preview`. Upsert por email.
// ────────────────────────────────────────────────────────────
function subscribersApiPlugin(): Plugin {
  const subsPath = path.resolve(__dirname, 'public', 'subscribers.json');

  type Subscriber = {
    nombre: string;
    email: string;
    provincia: string;
    cluster: string;
    informe_mensual: boolean;
    created_at: string;
    updated_at: string;
  };

  const readAll = (): Subscriber[] => {
    try {
      if (!fs.existsSync(subsPath)) return [];
      const raw = fs.readFileSync(subsPath, 'utf8').trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeAll = (list: Subscriber[]) => {
    fs.mkdirSync(path.dirname(subsPath), { recursive: true });
    fs.writeFileSync(subsPath, JSON.stringify(list, null, 2), 'utf8');
  };

  const readBody = (req: Connect.IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith('/api/subscribe')) return next();

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      res.end('Method Not Allowed');
      return;
    }

    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const nombre = String(payload?.nombre ?? '').trim();
      const email = String(payload?.email ?? '').trim().toLowerCase();
      const provincia = String(payload?.provincia ?? '').trim();
      const cluster = String(payload?.cluster ?? '').trim();
      const informe_mensual = payload?.informe_mensual === undefined
        ? true
        : Boolean(payload.informe_mensual);

      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!nombre || !email || !provincia || !cluster || !EMAIL_RE.test(email)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Campos inválidos o incompletos' }));
        return;
      }

      const list = readAll();
      const now = new Date().toISOString();
      const idx = list.findIndex((s) => s.email?.toLowerCase() === email);
      let updated = false;
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          nombre,
          email,
          provincia,
          cluster,
          informe_mensual,
          updated_at: now,
        };
        updated = true;
      } else {
        list.push({ nombre, email, provincia, cluster, informe_mensual, created_at: now, updated_at: now });
      }
      writeAll(list);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, updated, email, total: list.length }));
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: err?.message ?? 'Error interno' }));
    }
  };

  return {
    name: 'subscribers-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), subscribersApiPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
