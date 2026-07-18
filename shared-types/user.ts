export type UserRole = 'admin' | 'officer' | 'analyst';

export interface User {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  createdAt: string; // ISO 8601 UTC timestamp string
}

export interface UserJWTPayload {
  id: number;
  username: string;
  role: UserRole;
}
