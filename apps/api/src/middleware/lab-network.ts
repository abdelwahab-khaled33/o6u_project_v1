import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { isIpInRanges, isSocketInRanges } from '../lib/cidr.js';

export type { CidrRange } from '../lib/cidr.js';
export { ipMatchesCidr, isIpInRanges, parseCidr, parseIp } from '../lib/cidr.js';

/**
 * The address the request actually arrived on, never anything the client chose.
 *
 * X-Forwarded-For is attacker-controlled: anyone can send `X-Forwarded-For: 10.20.0.9`
 * and name themselves inside the lab allowlist. The header is therefore only read when
 * the socket it arrived on is a proxy we configured by address, and even then the
 * RIGHTMOST entry is the one that proxy observed -- a prepended entry is a forgery and
 * is ignored by construction. Spec 6.1 asks for exactly this ("trust proxy limited to
 * the Nginx host(s) so clients cannot spoof it").
 *
 * The trusted list is a parameter so this decision is testable without mutating process
 * env; every production caller uses the default, which reads the configuration.
 */
export function clientIp(req: Request, trustedProxies: string[] = env.trustedProxyIps): string {
  const peer = req.socket?.remoteAddress ?? req.ip ?? '';
  const forwarded = req.header('X-Forwarded-For');

  if (forwarded && isSocketInRanges(peer, trustedProxies)) {
    const nearest = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .at(-1);
    if (nearest) return nearest;
  }

  return peer;
}

export function requireLabNetwork(req: Request, res: Response, next: NextFunction) {
  try {
    if (env.labIpRanges.length === 0) return next();

    if (!isIpInRanges(clientIp(req), env.labIpRanges)) {
      return res.status(403).json({
        error: 'LAB_NETWORK_REQUIRED',
        message: 'This exam can only be taken from the university labs',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}
