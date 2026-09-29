/**
 * @file functions/api/[[route]].js
 * @description Cloudflare Pages Functions catch-all API dispatcher.
 * Routes all incoming `/api/*` traffic to the corresponding WacPad backend handlers.
 */

import { adaptCloudflareRequest } from '../_adapter.js';

import createCheckoutSession from '../../api/create-checkout-session.js';
import getLicense from '../../api/get-license.js';
import webhook from '../../api/webhook.js';
import lookupLicense from '../../api/lookup-license.js';
import activate from '../../api/activate.js';
import deactivate from '../../api/deactivate.js';
import devices from '../../api/devices.js';

const ROUTE_TABLE = {
  '/api/create-checkout-session': createCheckoutSession,
  '/api/get-license': getLicense,
  '/api/webhook': webhook,
  '/api/lookup-license': lookupLicense,
  '/api/activate': activate,
  '/api/deactivate': deactivate,
  '/api/devices': devices,
};

/**
 * Cloudflare Pages Functions entry point matching any HTTP method for /api/*
 *
 * @param {object} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  // Normalize pathname by removing trailing slashes
  const pathname = url.pathname.length > 1 && url.pathname.endsWith('/')
    ? url.pathname.slice(0, -1)
    : url.pathname;

  const handler = ROUTE_TABLE[pathname];

  if (!handler) {
    return new Response(JSON.stringify({ error: 'Endpoint Not Found', pathname }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return adaptCloudflareRequest(context, handler);
}
