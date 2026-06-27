/**
 * @file auth-identity.interface.ts
 * @description Defines the standard identity payload required by the AuthModule to perform authentication.
 * This completely decouples AuthModule from specific domain types (User, Admin).
 */

import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';

/**
 * The base identity contract required by the AuthModule.
 * Decouples authentication logic from specific user domain entities, enforcing that only necessary security properties are exposed.
 */
export interface IAuthIdentity {
    /** The unique identifier of the identity */
    id: string;

    /** The hashed password of the identity */
    password: string;

    /** The active status of the identity */
    isActive: boolean;
}

/**
 * Extends the base identity with an explicit role, typically used for back-office principals (Admins)
 * where multiple privilege levels exist (e.g., ADMIN, SUPER_ADMIN).
 */
export interface IAuthAdminIdentity extends IAuthIdentity {
    /** The explicit authorization role of the administrative identity */
    role: AuthUserRole;
}
