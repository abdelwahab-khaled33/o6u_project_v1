import { describe, expect, it } from 'vitest';
import { sniffImage } from './image-sniff.js';

const bytes = (...b: number[]) => Buffer.from(b);
const ascii = (s: string) => Buffer.from(s, 'latin1');

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1);
const GIF = Buffer.concat([ascii('GIF89a'), bytes(1, 0, 1, 0)]);
const WEBP = Buffer.concat([
  ascii('RIFF'),
  bytes(0x1a, 0, 0, 0),
  ascii('WEBPVP8 '),
  bytes(0, 0, 0, 0),
]);

describe('sniffImage', () => {
  it('recognises the four image formats the app accepts, by content', () => {
    expect(sniffImage(PNG)).toEqual({ extension: '.png', mimetype: 'image/png' });
    expect(sniffImage(JPEG)).toEqual({ extension: '.jpg', mimetype: 'image/jpeg' });
    expect(sniffImage(GIF)).toEqual({ extension: '.gif', mimetype: 'image/gif' });
    expect(sniffImage(WEBP)).toEqual({ extension: '.webp', mimetype: 'image/webp' });
  });

  it('rejects HTML however it is labelled or named', () => {
    // The upload route used to trust the multipart part's client-declared Content-Type
    // and take the extension from the client-supplied filename, so `Content-Type:
    // image/png` plus a name of evil.html stored a file that /uploads then served as
    // text/html from the API origin. Only the bytes decide, and the function has no
    // parameter through which a declared type or a filename could be supplied at all.
    const html = ascii('<!DOCTYPE html><script>alert(document.domain)</script>');
    expect(sniffImage(html)).toBeNull();
  });

  it('rejects an SVG, which executes script when a browser navigates to it', () => {
    const svg = ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImage(svg)).toBeNull();
  });

  it('rejects a PDF and a ZIP, which are neither of the accepted formats', () => {
    expect(sniffImage(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImage(Buffer.from('PK\x03\x04'))).toBeNull();
  });

  it('rejects an empty or truncated upload instead of guessing', () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.alloc(4))).toBeNull();
    expect(sniffImage(PNG.subarray(0, 3))).toBeNull();
  });

  it('rejects a RIFF container that is not WEBP', () => {
    // RIFF is also the WAV/AVI magic; matching on the first four bytes alone would let
    // any RIFF file through with a .webp name.
    expect(sniffImage(Buffer.concat([ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WAVEfmt ')]))).toBeNull();
  });

  it('never derives the stored extension from the client filename', () => {
    // Even for a genuine image the name is irrelevant, because sniffImage is not given
    // one. This is the regression guard for the XSS route: re-adding a filename or a
    // declared-type parameter is what would reopen it.
    expect(Object.keys(sniffImage(PNG) as object).sort()).toEqual(['extension', 'mimetype']);
    expect(sniffImage.length).toBe(1);
  });
});
