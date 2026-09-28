type ErrorWithStatus = {
  message?: unknown;
  statusCode?: unknown;
  status?: unknown;
  type?: unknown;
};

export type ErrorResponse = { status: number; body: { error: string } };

function numericStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Maps a thrown value onto an HTTP response.
 *
 * A 4xx is the caller's fault and keeps its own message; anything else is
 * treated as a server fault, so an error handler can never answer 2xx, and the
 * internal message is never sent to the client. body-parser failures are
 * replaced because their message quotes the submitted body back verbatim.
 */
export function resolveErrorResponse(err: unknown): ErrorResponse {
  const e = (err ?? {}) as ErrorWithStatus;
  const status = numericStatus(e.statusCode) ?? numericStatus(e.status);

  if (status != null && status >= 400 && status < 500) {
    const isBodyParser = typeof e.type === 'string' && e.type.startsWith('entity.');
    const message = isBodyParser ? 'Malformed request body' : typeof e.message === 'string' ? e.message : '';
    return { status, body: { error: message || 'Bad Request' } };
  }

  return { status: 500, body: { error: 'Internal Server Error' } };
}
