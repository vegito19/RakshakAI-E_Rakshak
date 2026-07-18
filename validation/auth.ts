import { FastifySchema } from 'fastify';

export const registerSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['username', 'email', 'password'],
    properties: {
      username: { 
        type: 'string', 
        minLength: 3, 
        maxLength: 50,
        pattern: '^[a-zA-Z0-9_]+$'
      },
      email: { 
        type: 'string', 
        format: 'email' 
      },
      password: { 
        type: 'string', 
        minLength: 6 
      },
      role: { 
        type: 'string', 
        enum: ['admin', 'officer', 'analyst'] 
      }
    },
    additionalProperties: false
  }
};

export const loginSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    properties: {
      username: { 
        type: 'string',
        minLength: 1
      },
      password: { 
        type: 'string',
        minLength: 1
      }
    },
    additionalProperties: false
  }
};
