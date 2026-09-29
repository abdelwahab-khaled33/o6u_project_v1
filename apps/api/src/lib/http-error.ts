type ErrorWithStatus = {
  message?: unknown;
  statusCode?: unknown;
  status?: unknown;
  type?: unknown;
  name?: unknown;
  code?: unknown;
};

export type ErrorResponse = { status: number; body: { error: string } };

function numericStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * multer rejects a bad upload by throwing a MulterError, which carries a `code` and no
 * status. Unmapped it became a 500, so a client that posted a perfectly well-formed
 * request to the wrong form field was told the server had broken -- the opposite of what
 * happened, and nothing actionable for the caller.
 *
 * Only the MulterError *name* counts, not `code` alone: a service that happens to set
 * code: 'LIMIT_FILE_SIZE' on its own error must still be reported as a server fault.
 */
function resolveMulterError(err: ErrorWithStatus): ErrorResponse | null {
  if (err.name !== 'MulterError') return null;

  if (err.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, body: { error: 'Uploaded file is too large' } };
  }

  // Deliberately not err.message: multer puts the received field name and the expected
  // one in there, and echoing a client-supplied filename back is not worth the noise. The
  // allowed field name is a constant per route, and the fix is the same either way.
  return {
    status: 400,
    body: { error: 'Upload rejected. Check the form field name and that a file was sent.' },
  };
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

  const multer = resolveMulterError(e);
  if (multer) return multer;

  const status = numericStatus(e.statusCode) ?? numericStatus(e.status);

  if (status != null && status >= 400 && status < 500) {
    const isBodyParser = typeof e.type === 'string' && e.type.startsWith('entity.');
    const message = isBodyParser ? 'Malformed request body' : typeof e.message === 'string' ? e.message : '';
    return { status, body: { error: message || 'Bad Request' } };
  }

  return { status: 500, body: { error: 'Internal Server Error' } };
}
