/**
 * @file auth-role.type.ts
 * @description Unified type for all authorization roles in the system.
 */

import { AdminRole } from 'src/shared/domain/admin';
import { UserRole } from 'src/shared/domain/user';

/**
 * Union type combining all roles across different bounded contexts.
 * Used by core security services (Token, Session) for universal identity handling.
 */
export type AuthRole = AdminRole | UserRole;
