import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole, UserJWTPayload } from '../shared-types/user';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserJWTPayload;
  }
}

/**
 * Higher-order function that returns a Fastify preHandler hook to enforce
 * Role-Based Access Control (RBAC).
 * 
 * Must be used AFTER the 'authenticate' preHandler hook.
 */
export function requireRole(allowedRoles: UserRole[]) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const user = request.user;

    if (!user || !allowedRoles.includes(user.role)) {
      reply.status(403).send({
        success: false,
        error: `Forbidden: Insufficient privileges. Access requires one of the following roles: [${allowedRoles.join(', ')}].`
      });
    }
  };
}
