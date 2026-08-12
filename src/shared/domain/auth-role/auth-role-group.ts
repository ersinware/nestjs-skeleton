/**
 * @file auth-role-group.ts
 * @description Exhaustive classification of every authorization role into its access group.
 */

import { AdminRole } from 'src/shared/domain/admin';
import type { AuthRole } from 'src/shared/domain/auth-role/auth-role.type';
import { UserRole } from 'src/shared/domain/user';

/**
 * The access groups roles are classified into: `admin` marks membership in the shared
 * administrative surface, `user` marks end-user roles.
 */
type AuthRoleGroup = 'admin' | 'user';

/**
 * Classifies every role, closed over {@link AuthRole}: an unclassified new role fails compilation,
 * so its group membership is a deliberate decision made here.
 */
const ROLE_TO_GROUP = {
    [UserRole.USER]: 'user',
    [AdminRole.ADMIN]: 'admin',
    [AdminRole.SUPER_ADMIN]: 'admin',
} as const satisfies Record<AuthRole, AuthRoleGroup>;

/**
 * Every role in the shared administrative surface, derived from {@link ROLE_TO_GROUP} so the list
 * cannot drift from the classification. Routes open to all administrators declare
 * `@Roles(...ADMIN_ROLES)`; deliberately narrower routes keep listing their roles explicitly.
 */
export const ADMIN_ROLES: readonly AuthRole[] = (Object.keys(ROLE_TO_GROUP) as AuthRole[]).filter(
    (role) => ROLE_TO_GROUP[role] === 'admin',
);
