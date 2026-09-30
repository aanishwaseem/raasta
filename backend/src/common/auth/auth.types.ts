export const ROLES = ['PASSENGER', 'DRIVER', 'ADMIN', 'SUPPORT', 'CORPORATE_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  roles: Role[];
  sid: string;
}

export const hasRole = (u: AuthUser, ...roles: Role[]) => roles.some((r) => u.roles.includes(r));
export const isStaff = (u: AuthUser) => hasRole(u, 'ADMIN', 'SUPPORT');
