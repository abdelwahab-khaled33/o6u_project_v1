import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { Role } from '@exam/shared';

export interface AuthPayload {
  userId: string;
  role: Role;
}

export function signToken(userId: string, role: Role): string {
  return jwt.sign({ userId, role }, env.jwtSecret, { expiresIn: '8h' });
}

export function verifyToken(token: string): AuthPayload {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (typeof decoded === 'string' || !decoded.userId || !decoded.role) {
    throw new Error('Invalid token payload');
  }
  return { userId: String(decoded.userId), role: decoded.role as Role };
}