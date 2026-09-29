/**
 * @file worker.js
 * @description Cloudflare Worker entry point for WacPad.
 * Serves static assets from public/ and dispatches /api/* traffic to the universal Pages adapter.
 */

import { onRequest } from './functions/api/[[route]].js';

export default {
  /**
   * Cloudflare Worker fetch event handler.
   *
   * @param {Request} request - Web standard Request object
   * @param {object} env - Cloudflare environment variables and bindings
   * @param {object} ctx - Execution context (e.g. waitUntil)
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Dispatch API routes through our universal adapter router
    if (url.pathname.startsWith('/api/')) {
      return onRequest({ request, env, ctx });
    }

    // 2. Fallback to static assets via env.ASSETS binding if worker runs first
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
