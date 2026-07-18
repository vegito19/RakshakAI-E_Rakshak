export type UserRole = 'admin' | 'officer' | 'analyst';

export interface User {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  createdAt: string; // ISO 8601 string representation of date for JSON serialization compatibility
}

export interface UserJWTPayload {
  id: number;
  username: string;
  role: UserRole;
}
