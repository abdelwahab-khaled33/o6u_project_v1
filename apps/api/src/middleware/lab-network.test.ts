import { describe, expect, it } from 'vitest';
import { ipMatchesCidr, isIpInRanges, parseCidr, parseIp } from './lab-network.js';

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