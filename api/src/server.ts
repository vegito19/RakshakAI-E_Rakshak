import Fastify, { FastifyInstance, FastifyReply, FastifyRequest, FastifyError } from 'fastify';
import cors from '@fastify/cors';
import bcrypt from 'bcrypt';
import { logger } from '../../utils/logger';
import { pool, initializeDatabase } from '../../database/connection';
import { registerSchema, loginSchema } from '../../validation/auth';
import { signToken } from '../../auth/jwt';
import { authenticate } from '../../auth/middleware';
import { ApiResponse } from '../../shared-types/api';
import { User, UserJWTPayload } from '../../shared-types/user';

interface UserRegistrationDto {
  username?: string;
  email?: string;
  password?: string;
  role?: string;
}

interface UserLoginDto {
  username?: string;
  password?: string;
}

const fastify: FastifyInstance = Fastify({
  logger: false, // Disabling fastify default logger to use project's custom logger
});

// Setup global error handler
fastify.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
  if (error instanceof Error) {
    const err = error as FastifyError;
    if (err.validation) {
      logger.warn('Validation error encountered on request.', 'FastifyServer', {
        validation: err.validation,
        url: request.url,
      });
      const response: ApiResponse = {
        success: false,
        error: `Validation Failed: ${err.message}`,
      };
      reply.status(400).send(response);
      return;
    }

    logger.error('Unhandled internal server error.', err, 'FastifyServer');
  } else {
    logger.error('Unhandled unknown error.', new Error(String(error)), 'FastifyServer');
  }

  const response: ApiResponse = {
    success: false,
    error: 'Internal Server Error.',
  };
  reply.status(500).send(response);
});

/**
 * Endpoint for registering a new user/officer.
 */
fastify.post(
  '/auth/register',
  { schema: registerSchema },
  async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const { username, email, password, role } = request.body as UserRegistrationDto;
    const finalRole = role || 'officer';

    try {
      if (!username || !email || !password) {
        reply.status(400).send({
          success: false,
          error: 'Username, email, and password are required.'
        });
        return;
      }

      // 1. Hash the password securely
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // 2. Insert the user record into PostgreSQL
      const query = `
        INSERT INTO users (username, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, username, email, role, created_at;
      `;

      const result = await pool.query(query, [username, email, hashedPassword, finalRole]);
      const dbUser = result.rows[0];

      const user: User = {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        role: dbUser.role,
        createdAt: dbUser.created_at,
      };

      // 3. Generate token
      const jwtPayload: UserJWTPayload = {
        id: user.id,
        username: user.username,
        role: user.role,
      };
      const token = signToken(jwtPayload);

      logger.info(`Successfully registered user: ${username} with role: ${finalRole}`, 'AuthHandler');

      const response: ApiResponse<{ user: User; token: string }> = {
        success: true,
        message: 'Registration successful.',
        data: { user, token },
      };

      reply.status(201).send(response);
    } catch (error: unknown) {
      if (error instanceof Error) {
        const err = error as any;
        // Catch unique violation error code (23505) in PostgreSQL
        if (err.code === '23505') {
          logger.warn(`Registration conflict. Username or Email already exists: ${username} / ${email}`, 'AuthHandler');
          const response: ApiResponse = {
            success: false,
            error: 'Username or Email is already registered.',
          };
          reply.status(409).send(response);
          return;
        }

        logger.error('Failed to register new user.', err, 'AuthHandler');
      } else {
        logger.error('Failed to register new user due to an unknown error.', new Error(String(error)), 'AuthHandler');
      }

      const response: ApiResponse = {
        success: false,
        error: 'An unexpected database error occurred during registration.',
      };
      reply.status(500).send(response);
    }
  }
);

/**
 * Endpoint for user authentication (Login).
 */
fastify.post(
  '/auth/login',
  { schema: loginSchema },
  async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const { username, password } = request.body as UserLoginDto;

    try {
      if (!username || !password) {
        reply.status(400).send({
          success: false,
          error: 'Username and password are required.'
        });
        return;
      }

      // 1. Fetch user by username
      const query = `
        SELECT id, username, email, password_hash, role, created_at 
        FROM users 
        WHERE username = $1;
      `;
      const result = await pool.query(query, [username]);

      if (result.rowCount === 0) {
        logger.warn(`Failed login attempt: User not found (${username})`, 'AuthHandler');
        const response: ApiResponse = {
          success: false,
          error: 'Invalid username or password.',
        };
        reply.status(401).send(response);
        return;
      }

      const dbUser = result.rows[0];

      // 2. Verify password match
      const isPasswordMatch = await bcrypt.compare(password, dbUser.password_hash);
      if (!isPasswordMatch) {
        logger.warn(`Failed login attempt: Incorrect password for user: ${username}`, 'AuthHandler');
        const response: ApiResponse = {
          success: false,
          error: 'Invalid username or password.',
        };
        reply.status(401).send(response);
        return;
      }

      const user: User = {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        role: dbUser.role,
        createdAt: dbUser.created_at,
      };

      // 3. Generate Token
      const jwtPayload: UserJWTPayload = {
        id: user.id,
        username: user.username,
        role: user.role,
      };
      const token = signToken(jwtPayload);

      logger.info(`User logged in successfully: ${username}`, 'AuthHandler');

      const response: ApiResponse<{ user: User; token: string }> = {
        success: true,
        message: 'Login successful.',
        data: { user, token },
      };

      reply.status(200).send(response);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error('Error executing user login query.', error, 'AuthHandler');
      } else {
        logger.error('Error executing user login query with unknown error.', new Error(String(error)), 'AuthHandler');
      }

      const response: ApiResponse = {
        success: false,
        error: 'An unexpected database error occurred during login.',
      };
      reply.status(500).send(response);
    }
  }
);

/**
 * Secured endpoint to retrieve the current user profile.
 */
fastify.get(
  '/auth/me',
  { preHandler: [authenticate] },
  async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    // request.user is set by the authenticate middleware
    const response: ApiResponse<{ user: UserJWTPayload }> = {
      success: true,
      data: {
        user: request.user!,
      },
    };
    reply.status(200).send(response);
  }
);

/**
 * Initializes resources and starts the Fastify API server.
 */
async function startServer(): Promise<void> {
  try {
    // 1. Initialize PostgreSQL schemas/tables
    await initializeDatabase();

    // 2. Configure CORS
    await fastify.register(cors, {
      origin: true, // Configured to match origin request in development
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });

    // 3. Start Server
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    logger.info(`Rakshak API server is running on http://${host}:${port}`, 'FastifyServer');
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('Failed to start the Fastify API server.', error, 'FastifyServer');
    } else {
      logger.error('Failed to start the Fastify API server with unknown error.', new Error(String(error)), 'FastifyServer');
    }
    process.exit(1);
  }
}

// Invoke server start
if (require.main === module) {
  startServer();
}
