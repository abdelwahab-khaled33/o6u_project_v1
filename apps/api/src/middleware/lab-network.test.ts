import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { clientIp, ipMatchesCidr, isIpInRanges, parseCidr, parseIp } from './lab-network.js';

describe('parseIp', () => {
  it('parses IPv4 addresses', () => {
    expect(parseIp('10.20.30.40')).toEqual([10, 20, 30, 40]);
  });

  it('rejects malformed IPv4 addresses', () => {
    expect(parseIp('10.20.30')).toBeNull();
    expect(parseIp('10.20.30.999')).toBeNull();
    expect(parseIp('10.20.30.a')).toBeNull();
  });

  it('parses IPv6 addresses with a collapsed zero run', () => {
    const bytes = parseIp('fc00::1');
    expect(bytes).not.toBeNull();
    if (bytes == null) throw new Error('unreachable');
    expect(bytes.length).toBe(16);
    expect(bytes[0]).toBe(0xfc);
    expect(bytes[15]).toBe(1);
  });

  it('rejects unknown address families', () => {
    expect(parseIp('not-an-ip')).toBeNull();
  });
});

describe('parseCidr', () => {
  it('uses 32-bit prefix for bare IPv4 networks', () => {
    expect(parseCidr('10.20.0.0')).toEqual({
      bytes: [10, 20, 0, 0],
      prefix: 32,
    });
  });

  it('parses an explicit prefix', () => {
    expect(parseCidr('10.20.0.0/16')).toEqual({
      bytes: [10, 20, 0, 0],
      prefix: 16,
    });
  });

  it('rejects a prefix larger than the address family', () => {
    expect(parseCidr('10.0.0.0/33')).toBeNull();
  });

  it('rejects a non-numeric prefix', () => {
    expect(parseCidr('10.0.0.0/zz')).toBeNull();
  });
});

describe('ipMatchesCidr', () => {
  it('matches hosts inside the network', () => {
    const range = parseCidr('10.20.0.0/16');
    expect(range).not.toBeNull();
    const ip = parseIp('10.20.55.9');
    expect(ip).not.toBeNull();
    if (range == null || ip == null) throw new Error('unreachable');
    expect(ipMatchesCidr(ip, range)).toBe(true);
  });

  it('rejects hosts outside the network', () => {
    const range = parseCidr('10.20.0.0/16');
    const ip = parseIp('10.21.1.1');
    if (range == null || ip == null) throw new Error('unreachable');
    expect(ipMatchesCidr(ip, range)).toBe(false);
  });

  it('respects the prefix bit boundary', () => {
    const range = parseCidr('10.20.0.0/24');
    const inside = parseIp('10.20.0.255');
    const outside = parseIp('10.20.1.1');
    if (range == null || inside == null || outside == null) throw new Error('unreachable');
    expect(ipMatchesCidr(inside, range)).toBe(true);
    expect(ipMatchesCidr(outside, range)).toBe(false);
  });

  it('requires the same address family', () => {
    const range = parseCidr('10.0.0.0/8');
    const ip = parseIp('fc00::1');
    if (range == null || ip == null) throw new Error('unreachable');
    expect(ipMatchesCidr(ip, range)).toBe(false);
  });
});

describe('isIpInRanges', () => {
  it('returns false when no ranges are configured', () => {
    expect(isIpInRanges('10.20.0.1', [])).toBe(false);
  });

  it('accepts an IP from any matching range', () => {
    expect(isIpInRanges('10.20.0.1', ['192.168.0.0/16', '10.0.0.0/8'])).toBe(true);
  });

  it('rejects an IP outside every range', () => {
    expect(isIpInRanges('8.8.8.8', ['10.0.0.0/8', '192.168.0.0/16'])).toBe(false);
  });

  it('ignores invalid range entries', () => {
    expect(isIpInRanges('10.4.0.1', ['not-a-cidr', '10.0.0.0/8'])).toBe(true);
    expect(isIpInRanges('10.4.0.1', ['not-a-cidr'])).toBe(false);
  });
});

// clientIp decides which network a student is judged to be on, so a forged
// X-Forwarded-For is a bypass of the whole lab restriction. The header is only
// believed when the socket it actually arrived on is a configured proxy.
const req = (headers: Record<string, string>, socketAddress?: string) =>
  ({
    header: (name: string) => headers[name.toLowerCase()],
    ip: socketAddress ?? '',
    socket: { remoteAddress: socketAddress ?? '' },
  }) as unknown as Request;

describe('clientIp', () => {
  it('ignores X-Forwarded-For when no proxy is trusted', () => {
    const result = clientIp(req({ 'x-forwarded-for': '10.20.0.9' }, '10.0.0.5'), []);
    expect(result).toBe('10.0.0.5');
  });

  it('ignores X-Forwarded-For when the peer is not a trusted proxy', () => {
    const result = clientIp(
      req({ 'x-forwarded-for': '10.20.0.9' }, '203.0.113.7'),
      ['10.0.0.5'],
    );
    expect(result).toBe('203.0.113.7');
  });

  it('reads the rightmost X-Forwarded-For entry when the peer is a trusted proxy', () => {
    const result = clientIp(
      req({ 'x-forwarded-for': '10.20.0.9, 10.20.0.8' }, '10.0.0.5'),
      ['10.0.0.5'],
    );
    expect(result).toBe('10.20.0.8');
  });

  it('does not let a client prepend its own allowlisted address to the header', () => {
    // The forged entry sits left of the value the proxy actually observed. Reading the
    // rightmost entry is what makes prepending useless.
    const result = clientIp(
      req({ 'x-forwarded-for': '10.20.0.9, 203.0.113.7' }, '10.0.0.5'),
      ['10.0.0.5'],
    );
    expect(result).toBe('203.0.113.7');
  });

  it('matches a trusted proxy inside a CIDR, not only an exact address', () => {
    const result = clientIp(req({ 'x-forwarded-for': '10.20.0.9' }, '10.0.0.5'), ['10.0.0.0/8']);
    expect(result).toBe('10.20.0.9');
  });

  it('falls back to the socket address when the header is absent', () => {
    const result = clientIp(req({}, '10.0.0.5'), ['10.0.0.5']);
    expect(result).toBe('10.0.0.5');
  });

  it('falls back to the socket address when the header has no usable entry', () => {
    const result = clientIp(req({ 'x-forwarded-for': '   ' }, '10.0.0.5'), ['10.0.0.5']);
    expect(result).toBe('10.0.0.5');
  });

  it('unwraps an IPv4-mapped IPv6 socket address before matching the trusted list', () => {
    // Node reports an IPv4 peer on a dual-stack listener as ::ffff:10.0.0.5. Without the
    // unwrap it matches nothing and every real proxy is treated as untrusted.
    const result = clientIp(
      req({ 'x-forwarded-for': '10.20.0.9' }, '::ffff:10.0.0.5'),
      ['10.0.0.5'],
    );
    expect(result).toBe('10.20.0.9');
  });

  it('never returns a value taken from a header the peer was not trusted to send', () => {
    const untrusted = clientIp(req({ 'x-forwarded-for': '10.20.0.9' }, '203.0.113.7'), []);
    const trusted = clientIp(req({ 'x-forwarded-for': '10.20.0.9' }, '10.0.0.5'), ['10.0.0.5']);
    expect(untrusted).not.toBe('10.20.0.9');
    expect(trusted).toBe('10.20.0.9');
  });
});