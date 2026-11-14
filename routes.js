/**
 * The plugin's control route: one prefix handler on the Host web server that
 * authenticates the renderer, reads a small JSON body, and dispatches one action
 * to the thread operations. Nothing here touches a Session directly.
 *
 * Every failure leaves this file as a stable `code` plus its HTTP status, and
 * the Client half owns the wording: a raw Host message must never reach the
 * sidebar, and a retryable failure must be distinguishable from a bad request.
 */

import { appendFileSync } from 'node:fs';

/** Route prefix owned by this plugin. */
export const ROUTE = '/dsh-side-chat/api';

/** Largest request body accepted by the control route. */
const BODY_LIMIT = 256 * 1024;

/** Largest client crash report the `log` action keeps. */
const LOG_LIMIT = 8 * 1024;

/**
 * Stable failure codes. The Client half maps each one to its own localized
 * sentence, so changing a message here never changes what a user reads.
 */
export const ERROR = Object.freeze({
  /** A required field was absent or malformed (400). */
  badRequest: 'side-chat/bad-request',
  /** The named Session is not a thread this plugin owns (403). */
  notOwned: 'side-chat/not-owned',
  /** The thread (or its main Session) has no live Agent any more (409). */
  agentGone: 'side-chat/agent-gone',
  /** The main Session has committed nothing the child could inherit (409). */
  noContext: 'side-chat/no-context',
  /** The artifact could not be disposed or deleted; a retry may succeed (500). */
  io: 'side-chat/io',
  /** The request body exceeded {@link BODY_LIMIT} (413). */
  bodyTooLarge: 'side-chat/body-too-large',
  /** The connection layer refused the renderer (403). */
  forbidden: 'side-chat/forbidden',
  /** The action was called with a method other than POST (405). */
  method: 'side-chat/method-error',
  /** No action has that name (404). */
  notFound: 'side-chat/not-found',
});

/** HTTP status of every code, so a thrown failure is never answered as a bare 500. */
const STATUS_OF = Object.freeze({
  [ERROR.badRequest]: 400,
  [ERROR.notOwned]: 403,
  [ERROR.agentGone]: 409,
  [ERROR.noContext]: 409,
  [ERROR.io]: 500,
  [ERROR.bodyTooLarge]: 413,
  [ERROR.forbidden]: 403,
  [ERROR.method]: 405,
  [ERROR.notFound]: 404,
});

/**
 * One control-route failure: a stable code, its HTTP status, and a detail string
 * for the log. The Client half renders the code, not the detail.
 */
export class SideChatError extends Error {
  /**
   * @param code - one of {@link ERROR}.
   * @param detail - operator-facing detail; never shown as the user's sentence.
   * @param details - optional structured extras returned to the Client.
   */
  constructor(code, detail, details) {
    super(detail);
    this.name = 'SideChatError';
    this.code = code;
    this.status = STATUS_OF[code] ?? 500;
    this.details = details ?? {};
  }
}

/** A request body over {@link BODY_LIMIT}; the route answers 413. */
class BodyTooLargeError extends Error {
  constructor() {
    super('request body too large');
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
      if (tooLarge) return;
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(text);
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {});
      } catch (error) {
        reject(new SideChatError(ERROR.badRequest, `invalid JSON body: ${String(error?.message ?? error)}`));
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

/** Write one failure in the envelope the Client half parses. */
function writeError(res, code, detail, details) {
  writeJson(res, STATUS_OF[code] ?? 500, {
    ok: false,
    error: { code: code, message: detail, details: details ?? {} },
  });
}

/**
 * Build the prefix handler.
 * @param ctx - Host plugin context, read for the connection fence.
 * @param actions - `{ open, close, mode, prompt, cancel, model, sweep }` thread operations.
 * @returns the `(req, res)` handler.
 */
export function createRouteHandler(ctx, actions) {
  return async (req, res) => {
    const connection = ctx.get('connection');
    const rejection = typeof connection?.requestRejection === 'function' ? connection.requestRejection(req) : undefined;
    if (rejection !== undefined) {
      writeError(res, ERROR.forbidden, 'forbidden');
      return;
    }
    if (req.method !== 'POST') {
      writeError(res, ERROR.method, 'method not allowed');
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
      if (action === 'mode') {
        writeJson(res, 200, { ok: true, value: await actions.mode(payload) });
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
          const message = String(payload.message ?? '').slice(0, LOG_LIMIT);
          const stack = String(payload.stack ?? '').slice(0, LOG_LIMIT);
          appendFileSync(new URL('./.client-error.log', import.meta.url), `${new Date().toISOString()} ${message}\n${stack}\n\n`);
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
      writeError(res, ERROR.notFound, `unknown side-chat action "${action}"`);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        writeError(res, ERROR.bodyTooLarge, error.message);
        return;
      }
      if (error instanceof SideChatError) {
        writeError(res, error.code, error.message, error.details);
        return;
      }
      writeError(res, ERROR.io, error instanceof Error ? error.message : String(error));
    }
  };
}
