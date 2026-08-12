/**
 * @file index.ts
 * @description Public entry point of the auth-role concern. Nothing outside may import past this barrel.
 */

export { ADMIN_ROLES } from 'src/shared/domain/auth-role/auth-role-group';
export type { AuthRole } from 'src/shared/domain/auth-role/auth-role.type';
