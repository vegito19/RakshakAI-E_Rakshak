import { UserRole } from '../shared-types/user';

/**
 * Priority scoring for roles to allow checking hierarchy permissions if needed.
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 3,
  officer: 2,
  analyst: 1
};

/**
 * High-level system scopes and authorization lists mapped directly to Roles.
 */
export const PERMISSIONS = {
  READ_ALERTS: ['admin', 'officer', 'analyst'] as UserRole[],
  WRITE_ALERTS: ['admin', 'officer'] as UserRole[],
  ASSIGN_ALERTS: ['admin', 'officer'] as UserRole[],
  MANAGE_USERS: ['admin'] as UserRole[]
};
