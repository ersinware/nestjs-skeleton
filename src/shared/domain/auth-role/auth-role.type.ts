/**
 * @file auth-role.type.ts
 * @description Unified type for all authorization roles in the system.
 */

import { AdminRole } from 'src/shared/domain/admin';
import { UserRole } from 'src/shared/domain/user';

/**
 * Union type combining all roles across different bounded contexts.
 *
 * It lives in `shared` rather than under a core concern because it is composed ENTIRELY of shared
 * domain vocabulary — it states that a principal is one of the realms' roles and nothing more. Owning
 * it from `core/security/auth` gave every consumer of a role a reason to import the auth concern,
 * which is how the audit context ended up depending on the guard it is written beside.
 */
export type AuthRole = AdminRole | UserRole;
