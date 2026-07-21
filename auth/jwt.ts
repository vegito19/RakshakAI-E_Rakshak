import * as jwt from 'jsonwebtoken';
import { UserJWTPayload } from '../shared-types/user';

const JWT_SECRET = process.env.JWT_SECRET || 'rakshak_jwt_secret_dev_key';

/**
 * Signs a JWT with the user's identification and roles.
 */
export function signToken(payload: UserJWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

/**
 * Verifies a JWT and returns the parsed payload. Throws if invalid/expired.
 */
export function verifyToken(token: string): UserJWTPayload {
  return jwt.verify(token, JWT_SECRET) as UserJWTPayload;
}
