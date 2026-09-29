/**
 * IP address and CIDR parsing, kept free of any dependency on config/env so that the
 * environment guard can validate LAB_IP_RANGES at boot without importing a middleware
 * that imports the environment in turn.
 */

export interface CidrRange {
  bytes: number[];
  prefix: number;
}

function parseIpv4(input: string): number[] | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

function parseIpv6(input: string): number[] | null {
  const zone = input.indexOf('%');
  const address = zone === -1 ? input.toLowerCase() : input.slice(0, zone).toLowerCase();
  const doubleColon = address.indexOf('::');
  const head = doubleColon === -1 ? address : address.slice(0, doubleColon);
  const tail = doubleColon === -1 ? '' : address.slice(doubleColon + 2);

  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const bytes: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      const value = parseInt(group, 16);
      bytes.push((value >> 8) & 0xff, value & 0xff);
    }
    return bytes;
  };

  const headBytes = parseGroups(head);
  const tailBytes = parseGroups(tail);
  if (headBytes == null || tailBytes == null) return null;
  if (headBytes.length + tailBytes.length > 16) return null;

  const bytes = new Array<number>(16).fill(0);
  headBytes.forEach((value, i) => {
    bytes[i] = value;
  });
  const tailStart = 16 - tailBytes.length;
  tailBytes.forEach((value, i) => {
    bytes[tailStart + i] = value;
  });
  return bytes;
}

export function parseIp(input: string): number[] | null {
  return parseIpv4(input) ?? parseIpv6(input);
}

export function parseCidr(range: string): CidrRange | null {
  const slash = range.indexOf('/');
  const network = slash === -1 ? range : range.slice(0, slash);
  const prefixPart = slash === -1 ? '' : range.slice(slash + 1);
  if (network === '') return null;
  const bytes = parseIp(network);
  if (!bytes) return null;

  const defaultPrefix = bytes.length === 4 ? 32 : 128;
  let prefix = defaultPrefix;
  if (prefixPart !== '') {
    if (!/^\d{1,3}$/.test(prefixPart)) return null;
    prefix = Number(prefixPart);
    if (prefix < 0 || prefix > defaultPrefix) return null;
  }
  return { bytes, prefix };
}

export function ipMatchesCidr(ipBytes: number[], range: CidrRange): boolean {
  if (ipBytes.length !== range.bytes.length) return false;
  const fullBytes = range.prefix >> 3;
  for (let i = 0; i < fullBytes; i++) {
    const ipByte = ipBytes[i];
    const rangeByte = range.bytes[i];
    if (ipByte === undefined || rangeByte === undefined) return false;
    if (ipByte !== rangeByte) return false;
  }
  const remaining = range.prefix & 7;
  if (remaining > 0) {
    const ipByte = ipBytes[fullBytes];
    const rangeByte = range.bytes[fullBytes];
    if (ipByte === undefined || rangeByte === undefined) return false;
    const mask = 0xff << (8 - remaining);
    if ((ipByte & mask) !== (rangeByte & mask)) return false;
  }
  return true;
}

/**
 * Node reports an IPv4 peer on a dual-stack listener as ::ffff:a.b.c.d. Comparing that
 * 16-byte form against an IPv4 range can never match, so unwrap it before matching or
 * every real proxy looks untrusted.
 */
function socketBytes(address: string): number[] | null {
  const trimmed = address.trim();
  if (trimmed === '') return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  if (mapped?.[1]) return parseIpv4(mapped[1]);
  return parseIp(trimmed);
}

export function isIpInRanges(ip: string, ranges: string[]): boolean {
  const ipBytes = parseIp(ip);
  if (!ipBytes) return false;
  for (const range of ranges) {
    const cidr = parseCidr(range);
    if (cidr != null && ipMatchesCidr(ipBytes, cidr)) return true;
  }
  return false;
}

export function isSocketInRanges(address: string, ranges: string[]): boolean {
  const bytes = socketBytes(address);
  if (!bytes) return false;
  for (const range of ranges) {
    const cidr = parseCidr(range);
    if (cidr != null && ipMatchesCidr(bytes, cidr)) return true;
  }
  return false;
}
