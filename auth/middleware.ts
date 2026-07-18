import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './jwt';
import { UserJWTPayload } from '../shared-types/user';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserJWTPayload;
  }
}

/**
 * Fastify preHandler hook to enforce user authentication via JWT.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({
      success: false,
      error: 'Unauthorized: Missing or invalid token format. Token must be sent in the Authorization header as Bearer <token>.'
    });
    return;
  }

  const token = authHeader.substring(7).trim();

  try {
    const decoded = verifyToken(token);
    request.user = decoded;
  } catch (error) {
    reply.status(401).send({
      success: false,
      error: 'Unauthorized: Invalid or expired access token.'
    });
  }
}
