import { ZodError } from 'zod';

/**
 * Server-action result. Next 15 masks the message of an error thrown from a server
 * action in production, so user-facing failures are RETURNED with a stable `code`
 * the client can branch on; `error` is display text only. Thrown errors are reserved
 * for the unexpected (DB down) and framework control flow (redirect()).
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (code: string, error: string): { ok: false; error: string; code: string } => ({ ok: false, error, code });

/** Throw inside an action body to return `fail(code, message)` from `toResult`. */
export class ActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

/** Run an action body: ActionError and validation errors become `fail`, anything else is rethrown. */
export async function toResult<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await body());
  } catch (e) {
    if (e instanceof ActionError) return fail(e.code, e.message);
    if (e instanceof ZodError) return fail('invalid', e.issues[0]?.message ?? 'Invalid input');
    throw e;
  }
}

/** Client side: unwrap or throw an Error carrying `code` (for queues and other throw-based callers). */
export function unwrap<T>(r: ActionResult<T>): T {
  if (r.ok) return r.data;
  throw Object.assign(new Error(r.error), { code: r.code });
}
