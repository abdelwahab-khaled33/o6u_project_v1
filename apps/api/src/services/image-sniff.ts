export interface SniffedImage {
  extension: '.png' | '.jpg' | '.gif' | '.webp';
  mimetype: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, i) => buffer[i] === byte);
}

/**
 * Identify an uploaded image by its own bytes, and return the extension to store it
 * under.
 *
 * The upload route used to check the multipart part's client-declared Content-Type
 * against an allowlist and then take the extension from the client-supplied filename.
 * Both are attacker-controlled: a part named `evil.html` with `Content-Type: image/png`
 * and HTML bytes passed the allowlist, was written as `<uuid>.html` under uploads/images,
 * and was then served by an unauthenticated express.static mount as `text/html` on the
 * API origin -- stored XSS, reachable without a token. A .svg is the same problem in
 * image/svg+xml, which a browser executes script from when navigated to directly.
 *
 * So the function takes the buffer and nothing else: it has no parameter for a declared
 * Content-Type or a filename, so neither can reach the result even by mistake.
 */
export function sniffImage(buffer: Buffer): SniffedImage | null {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { extension: '.png', mimetype: 'image/png' };
  }
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { extension: '.jpg', mimetype: 'image/jpeg' };
  }
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) {
    return { extension: '.gif', mimetype: 'image/gif' };
  }
  // RIFF alone is also WAV and AVI, so the WEBP form type at offset 8 is required.
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer.subarray(8, 12), [0x57, 0x45, 0x42, 0x50])) {
    return { extension: '.webp', mimetype: 'image/webp' };
  }
  return null;
}
