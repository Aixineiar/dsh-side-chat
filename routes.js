/**
 * The plugin's control route: one prefix handler on the Host web server that
 * authenticates the renderer, reads a small JSON body, and dispatches one action
 * to the thread operations. Nothing here touches a Session directly.
 */

import { appendFileSync } from 'node:fs';

/** Route prefix owned by this plugin. */
export const ROUTE = '/dsh-side-chat/api';

/** Largest request body accepted by the control route. */
const BODY_LIMIT = 256 * 1024;

/** A request body over {@link BODY_LIMIT}; the route answers 413. */
class BodyTooLargeError extends Error {
  constructor() {
    super('请求体过大');
    this.name = 'BodyTooLargeError';
  }
}

/** Read a small JSON request body. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > BODY_LIMIT) {
        if (!tooLarge) {
          tooLarge = true;
          chunks.length = 0;
          reject(new BodyTooLargeError());
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(text);
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {});
      } catch (error) {
        reject(new Error(`invalid JSON body: ${String(error?.message ?? error)}`));
      }
    });
    req.on('error', reject);
  });
}

/** Write one JSON response. */
function writeJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * Build the prefix handler.
 * @param ctx - Host plugin context, read for the connection fence.
 * @param actions - `{ open, close, prompt, cancel, model, sweep }` thread operations.
 * @returns the `(req, res)` handler.
 */
export function createRouteHandler(ctx, actions) {
  return async (req, res) => {
    const connection = ctx.get('connection');
    const rejection = typeof connection?.requestRejection === 'function' ? connection.requestRejection(req) : undefined;
    if (rejection !== undefined) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
      return;
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } });
      return;
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
    const action = pathname.startsWith(`${ROUTE}/`) ? pathname.slice(ROUTE.length + 1) : '';
    try {
      const payload = await readJson(req);
      if (action === 'open') {
        writeJson(res, 200, { ok: true, value: await actions.open(payload) });
        return;
      }
      if (action === 'close') {
        writeJson(res, 200, { ok: true, value: await actions.close(payload) });
        return;
      }
      if (action === 'prompt') {
        writeJson(res, 200, { ok: true, value: await actions.prompt(payload) });
        return;
      }
      if (action === 'cancel') {
        writeJson(res, 200, { ok: true, value: await actions.cancel(payload) });
        return;
      }
      if (action === 'model') {
        writeJson(res, 200, { ok: true, value: await actions.model(payload) });
        return;
      }
      if (action === 'log') {
        // The one write this half still performs by hand: a Client crash report
        // has nowhere else to go, and the file is ignored by version control.
        try {
          appendFileSync(
            new URL('./.client-error.log', import.meta.url),
            `${new Date().toISOString()} ${String(payload.message ?? '')}\n${String(payload.stack ?? '')}\n\n`,
          );
        } catch {
          /* diagnostics only */
        }
        writeJson(res, 200, { ok: true, value: { logged: true } });
        return;
      }
      if (action === 'sweep') {
        writeJson(res, 200, { ok: true, value: await actions.sweep(payload) });
        return;
      }
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown side-chat action "${action}"` } });
    } catch (error) {
      const status = error instanceof BodyTooLargeError ? 413 : 500;
      writeJson(res, status, {
        ok: false,
        error: { code: status === 413 ? 'request-too-large' : 'side-chat-error', message: error instanceof Error ? error.message : String(error) },
      });
    }
  };
}
