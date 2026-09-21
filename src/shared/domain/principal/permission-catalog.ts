/**
 * @file permission-catalog.ts
 * @description Which kind of principal may hold each permission, and the per-kind list derived from it.
 */

import { Permission } from 'src/shared/domain/principal/permission.enum';
import { PrincipalType } from 'src/shared/domain/principal/principal-type.enum';

/**
 * The kind of principal each permission may be granted to. Exhaustive over {@link Permission}: a
 * permission added without a holder here fails compilation, so no permission can exist that nobody
 * may hold or that the wrong kind of account could be handed. The permissions an ADMIN holds over
 * users (`user:account:*`) are listed under ADMIN — the holder, not the context they act on.
 */
export const PERMISSION_HOLDER = {
    [Permission.ADMIN_ROOT]: PrincipalType.ADMIN,
    [Permission.ADMIN_ACCOUNT_READ]: PrincipalType.ADMIN,
    [Permission.ADMIN_ACCOUNT_INVITE]: PrincipalType.ADMIN,
    [Permission.ADMIN_ACCOUNT_BAN]: PrincipalType.ADMIN,
    [Permission.ADMIN_ACCOUNT_DELETE]: PrincipalType.ADMIN,
    [Permission.ADMIN_PERMISSION_MANAGE]: PrincipalType.ADMIN,
    [Permission.AUDIT_TRAIL_RECORD_READ]: PrincipalType.ADMIN,
    [Permission.HEALTH_DETAIL_READ]: PrincipalType.ADMIN,
    [Permission.JOB_DEAD_LETTER_READ]: PrincipalType.ADMIN,
    [Permission.JOB_DEAD_LETTER_REDRIVE]: PrincipalType.ADMIN,
    [Permission.JOB_DEAD_LETTER_DISCARD]: PrincipalType.ADMIN,
    [Permission.USER_ACCOUNT_READ]: PrincipalType.ADMIN,
    [Permission.USER_ACCOUNT_BAN]: PrincipalType.ADMIN,
    [Permission.USER_PERMISSION_MANAGE]: PrincipalType.ADMIN,
} as const satisfies Record<Permission, PrincipalType>;

/**
 * Lists every permission a given kind of principal may HOLD, derived from {@link PERMISSION_HOLDER}
 * so the two cannot drift. Holdable is not the same as grantable: whether a holdable permission
 * may be handed out over the API is the owning aggregate's rule, so a kind that offers a catalog
 * narrows this list itself.
 *
 * @param principalType The kind of principal the list is for
 * @returns The permissions that kind may hold, in catalog order
 */
export function getHoldablePermissions(principalType: PrincipalType): readonly Permission[] {
    return (Object.keys(PERMISSION_HOLDER) as Permission[]).filter(
        (permission) => PERMISSION_HOLDER[permission] === principalType,
    );
}
