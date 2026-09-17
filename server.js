import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env if present
dotenv.config({ path: path.join(__dirname, '.env') });

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
};

// Lazy-load API routes
const apiRoutes = {
  '/api/create-checkout-session': () => import('./api/create-checkout-session.js'),
  '/api/get-license': () => import('./api/get-license.js'),
  '/api/webhook': () => import('./api/webhook.js'),
  '/api/lookup-license': () => import('./api/lookup-license.js'),
  '/api/activate': () => import('./api/activate.js'),
  '/api/deactivate': () => import('./api/deactivate.js'),
  '/api/devices': () => import('./api/devices.js'),
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  // Handle trailing slashes on API routes (strip trailing '/' before matching)
  const normalizedPathname = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  // Configurable CORS origins
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((o) => o.trim())
    : [process.env.BASE_URL || `http://localhost:${PORT}`];

  const reqOrigin = req.headers.origin;
  if (reqOrigin && (allowedOrigins.includes('*') || allowedOrigins.includes(reqOrigin))) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
  } else if (process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin || '*');
  }

  // Standard security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, stripe-signature');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Handle API Routes
  if (apiRoutes[normalizedPathname]) {
    try {
      const module = await apiRoutes[normalizedPathname]();
      const handler = module.default;

      // Augment req with query params
      req.query = Object.fromEntries(parsedUrl.searchParams.entries());

      // Read body with max body size enforcement
      if (req.method !== 'GET') {
        const MAX_BODY_SIZE = normalizedPathname === '/api/webhook' ? 1024 * 1024 : 100 * 1024;
        let totalSize = 0;
        const bodyBuffer = await new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', (c) => {
            totalSize += c.length;
            if (totalSize > MAX_BODY_SIZE) {
              req.destroy();
              reject(new Error('Payload Too Large'));
              return;
            }
            chunks.push(c);
          });
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', (err) => reject(err));
        });

        req.rawBody = bodyBuffer;
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            req.body = JSON.parse(bodyBuffer.toString('utf8'));
          } catch {
            req.body = {};
          }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(bodyBuffer.toString('utf8'));
          req.body = Object.fromEntries(params.entries());
        } else {
          req.body = bodyBuffer;
        }
      }

      // Augment res with helper methods matching Vercel/Express
      res.status = (statusCode) => {
        res.statusCode = statusCode;
        return res;
      };
      res.json = (data) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
      };
      res.send = (text) => {
        res.end(text);
      };

      await handler(req, res);
      return;
    } catch (err) {
      console.error(`[API Error on ${normalizedPathname}]:`, err);
      const isPayloadTooLarge = err.message === 'Payload Too Large';
      res.writeHead(isPayloadTooLarge ? 413 : 500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: isPayloadTooLarge ? 'Payload Too Large' : 'Internal Server Error' }));
    }
  }

  // Static file serving: safe iterative URI decoding up to 3 passes
  let safePathname = pathname;
  try {
    for (let i = 0; i < 3; i++) {
      const decoded = decodeURIComponent(safePathname);
      if (decoded === safePathname) break;
      safePathname = decoded;
    }
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    return res.end('<h1>400 Bad Request</h1>');
  }

  // Reject null bytes to prevent poisoning fs APIs
  if (safePathname.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    return res.end('<h1>400 Bad Request</h1>');
  }

  let filePath = path.join(PUBLIC_DIR, safePathname === '/' ? 'index.html' : safePathname);

  // Path traversal guard: ensure resolved path is strictly within PUBLIC_DIR
  const resolvedPath = path.resolve(filePath);
  const resolvedPublic = path.resolve(PUBLIC_DIR);
  const resolvedPublicWithSep = resolvedPublic.endsWith(path.sep) ? resolvedPublic : resolvedPublic + path.sep;

  if (resolvedPath !== resolvedPublic && !resolvedPath.startsWith(resolvedPublicWithSep)) {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    return res.end('<h1>403 Forbidden</h1>');
  }

  // If path doesn't have an extension, try appending .html
  if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) {
    filePath += '.html';
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Not Found</h1><p>The requested file does not exist.</p><a href="/">Return Home</a>');
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  🚀 WacPad Site & Payment Service running on:`);
  console.log(`     http://localhost:${PORT}`);
  console.log(`======================================================`);
  console.log(`  • Landing Page:   http://localhost:${PORT}/`);
  console.log(`  • Mock Checkout:  POST http://localhost:${PORT}/api/create-checkout-session`);
  console.log(`  • Success Demo:   http://localhost:${PORT}/success.html?session_id=mock_demo&mock=true`);
  console.log(`  • License Lookup: http://localhost:${PORT}/lookup.html`);
  console.log(`======================================================\n`);
});

export { server };
export default server;

