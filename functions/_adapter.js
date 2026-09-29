/**
 * @file functions/_adapter.js
 * @description Universal Cloudflare Pages Functions adapter for WacPad.
 * Translates Web Fetch API (Request / Response / EventContext) into standard Node.js
 * (req, res) format expected by existing WacPad API route handlers.
 *
 * Preserves 100% backwards compatibility with existing local testing, unit tests,
 * and Vercel serverless deployments without modifying any core business logic.
 */

import { Buffer } from 'node:buffer';

/**
 * Handles a Cloudflare Pages request by delegating to a Node.js (req, res) handler.
 *
 * @param {object} context - Cloudflare Pages EventContext
 * @param {Request} context.request - Web standard Request object
 * @param {object} context.env - Environment variables and secrets
 * @param {Function} handler - The Node.js style (req, res) handler function
 * @returns {Promise<Response>} Web standard Response object
 */
export async function adaptCloudflareRequest(context, handler) {
  const { request, env } = context;

  // 1. Polyfill process.env from Cloudflare context.env
  if (typeof process === 'undefined') {
    globalThis.process = { env: {} };
  } else if (!process.env) {
    process.env = {};
  }

  if (env && typeof env === 'object') {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') {
        process.env[key] = value;
      }
    }
  }

  // 2. Setup CORS headers
  const origin = request.headers.get('origin') || '*';
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, stripe-signature, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };

  // 3. Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // 4. Parse URL and query parameters
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());

  // 5. Parse headers into a lowercase-keyed object
  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key.toLowerCase()] = value;
  }

  // 6. Parse request body and preserve rawBody for Stripe Webhook signature verification
  let rawBody = null;
  let body = null;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const rawText = await request.text();
    if (rawText && rawText.length > 0) {
      rawBody = Buffer.from(rawText, 'utf8');
      const contentType = headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        try {
          body = JSON.parse(rawText);
        } catch {
          body = rawText;
        }
      } else {
        try {
          body = JSON.parse(rawText);
        } catch {
          body = rawText;
        }
      }
    }
  }

  // 7. Construct Node.js style `req` object
  const req = {
    method: request.method,
    url: url.pathname + url.search,
    pathname: url.pathname,
    query,
    headers,
    body,
    rawBody,
    // Emulate stream methods for any callers inspecting req
    async *[Symbol.asyncIterator]() {
      if (rawBody) {
        yield rawBody;
      }
    },
  };

  // 8. Construct Node.js style `res` object with status, headers, and body collectors
  let statusCode = 200;
  const responseHeaders = new Headers(corsHeaders);
  let responseData = null;

  const res = {
    statusCode: 200,
    setHeader(name, value) {
      responseHeaders.set(name, value);
      return res;
    },
    getHeader(name) {
      return responseHeaders.get(name);
    },
    status(code) {
      statusCode = code;
      res.statusCode = code;
      return res;
    },
    json(data) {
      responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
      responseData = JSON.stringify(data);
      return res;
    },
    send(data) {
      if (typeof data === 'object' && !Buffer.isBuffer(data) && data !== null) {
        responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
        responseData = JSON.stringify(data);
      } else {
        responseData = data;
      }
      return res;
    },
    end(data) {
      if (data !== undefined && data !== null) {
        responseData = data;
      }
      return res;
    },
  };

  // 9. Execute route handler safely
  try {
    await handler(req, res);
  } catch (err) {
    console.error('[Cloudflare Adapter Error]:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }

  // 10. Return standard Fetch Response
  return new Response(responseData, {
    status: statusCode,
    headers: responseHeaders,
  });
}
