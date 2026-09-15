/**
 * Test helpers and mocks for WacPad website test suite.
 */

/**
 * Creates a mock HTTP request object compatible with Node HTTP and Vercel serverless.
 * Provides async iterable support for handlers that read the raw request stream.
 *
 * @param {object} [options]
 * @param {string} [options.method='POST'] - HTTP method
 * @param {object} [options.query={}] - Parsed query string
 * @param {any} [options.body={}] - Parsed or raw request body
 * @param {object} [options.headers={}] - HTTP headers
 * @param {Buffer|string|null} [options.rawBody=null] - Raw payload buffer
 * @returns {object} Mock request
 */
export function createMockReq({
  method = 'POST',
  query = {},
  body = {},
  headers = {},
  rawBody = null,
} = {}) {
  const normalizedHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    normalizedHeaders[k.toLowerCase()] = v;
  }

  const computedRawBody =
    rawBody !== null
      ? (Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody))
      : (method !== 'GET' ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : Buffer.alloc(0));

  const req = {
    method,
    query: { ...query },
    body,
    rawBody: computedRawBody,
    headers: normalizedHeaders,
    socket: {
      remoteAddress: normalizedHeaders['x-forwarded-for']?.split(',')[0]?.trim() || '127.0.0.1',
    },
    async *[Symbol.asyncIterator]() {
      yield computedRawBody;
    },
  };
  return req;
}

/**
 * Creates a mock HTTP response object recording status, headers, and body.
 *
 * @returns {object} Mock response
 */
export function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    redirectUrl: null,
    ended: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      res.headers['content-type'] = 'application/json';
      res.ended = true;
      return res;
    },
    send(text) {
      res.body = text;
      res.ended = true;
      return res;
    },
    setHeader(k, v) {
      res.headers[k.toLowerCase()] = v;
    },
    writeHead(code, headers = {}) {
      res.statusCode = code;
      for (const [k, v] of Object.entries(headers)) {
        res.headers[k.toLowerCase()] = v;
        if (k.toLowerCase() === 'location') {
          res.redirectUrl = v;
        }
      }
      return res;
    },
    end(data) {
      if (data !== undefined) {
        res.body = data;
      }
      res.ended = true;
      return res;
    },
  };
  return res;
}

/**
 * Helper to run an async block with temporary environment variable overrides.
 *
 * @param {Record<string, string|undefined>} tempEnv
 * @param {() => Promise<void>} fn
 */
export async function withEnvAsync(tempEnv, fn) {
  const originalEnv = {};
  for (const key of Object.keys(tempEnv)) {
    originalEnv[key] = process.env[key];
    if (tempEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = tempEnv[key];
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(tempEnv)) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
}
