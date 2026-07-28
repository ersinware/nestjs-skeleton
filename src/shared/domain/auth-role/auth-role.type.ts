/**
 * @file auth-role.type.ts
 * @description Unified type for all authorization roles in the system.
 */

import { AdminRole } from 'src/shared/domain/admin';
import { UserRole } from 'src/shared/domain/user';

/**
 * Union of every authorization role across the bounded contexts. Lives in `shared` because it is
 * composed entirely of shared domain vocabulary — a consumer of a role needs no auth concern.
 */
export type AuthRole = AdminRole | UserRole;
