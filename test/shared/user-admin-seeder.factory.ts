import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { TOKEN_ADMINS_REPOSITORY } from 'src/api/v1/admin/constant/admin.constant';
import { IAdminsRepository } from 'src/api/v1/admin/interface/admins.repository.interface';
import { TOKEN_HASHING_SERVICE } from 'src/common/port/security/hashing.constant';
import type { IHashingService } from 'src/common/port/security/hashing.service.interface';
import { TOKEN_TOKEN_SERVICE } from 'src/common/port/security/token.constant';
import type { ITokenService } from 'src/common/port/security/token.service.interface';
import { TOKEN_SESSION_SERVICE } from 'src/common/port/security/session.constant';
import type { ISessionService } from 'src/common/port/security/session.service.interface';
import { TOKEN_USERS_REPOSITORY } from 'src/api/v1/user/constant/user.constant';
import { IUsersRepository } from 'src/api/v1/user/interface/users.repository.interface';

/**
 * Seeds a user in the database without creating a session.
 *
 * @param app The NestJS application instance.
 * @param options The registration options containing email and password.
 * @returns A promise resolving to the created user entity.
 * @throws {Error} If user seeding fails in the repository.
 */
export async function registerUser(
    app: NestFastifyApplication,
    {
        email = 'user@example.com',
        password = 'Password123',
    }: {
        email?: string;
        password?: string;
    } = {},
) {
    const user = await app.get<IUsersRepository>(TOKEN_USERS_REPOSITORY).create({
        email,
        name: 'Test User',
        password: await app.get<IHashingService>(TOKEN_HASHING_SERVICE).hash(password),
        isActive: true,
    });

    if (!user) {
        throw new Error('User seeding failed');
    }

    return user;
}

/**
 * Authenticates an existing user and registers an active session.
 *
 * @param app The NestJS application instance.
 * @param userId The unique identifier of the user to log in.
 * @returns A promise resolving to the generated tokens and session JTI.
 */
export async function loginUser(app: NestFastifyApplication, userId: string) {
    const tokens = await app.get<ITokenService>(TOKEN_TOKEN_SERVICE).generateTokens(AuthUserRole.USER, userId);
    await app.get<ISessionService>(TOKEN_SESSION_SERVICE).openSession(AuthUserRole.USER, userId, tokens.jti);

    return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        jti: tokens.jti,
    };
}

/**
 * Seeds a user and creates an active authenticated session.
 *
 * @param app The NestJS application instance.
 * @param options The registration options containing email and password.
 * @returns A promise resolving to the user ID and generated tokens.
 */
export async function registerAndLoginUser(
    app: NestFastifyApplication,
    options?: { email?: string; password?: string },
) {
    const user = await registerUser(app, options);

    return {
        id: user.id,
        ...(await loginUser(app, user.id)),
    };
}

/**
 * Seeds an admin in the database without creating a session.
 *
 * @param app The NestJS application instance.
 * @param options The registration options containing email, password, and role.
 * @returns A promise resolving to the created admin entity.
 * @throws {Error} If admin seeding fails in the repository.
 */
export async function registerAdmin(
    app: NestFastifyApplication,
    {
        email = 'admin@example.com',
        password = 'Password123',
        role = AuthUserRole.SUPER_ADMIN,
    }: {
        email?: string;
        password?: string;
        role?: AuthUserRole.ADMIN | AuthUserRole.SUPER_ADMIN;
    } = {},
) {
    const admin = await app.get<IAdminsRepository>(TOKEN_ADMINS_REPOSITORY).create({
        email,
        name: 'Test Admin',
        password: await app.get<IHashingService>(TOKEN_HASHING_SERVICE).hash(password),
        role,
        isActive: true,
    });

    if (!admin) {
        throw new Error('Admin seeding failed');
    }

    return admin;
}

/**
 * Authenticates an existing admin and registers an active session.
 *
 * @param app The NestJS application instance.
 * @param adminId The unique identifier of the admin to log in.
 * @param role The role to grant in the token.
 * @returns A promise resolving to the generated tokens and session JTI.
 */
export async function loginAdmin(
    app: NestFastifyApplication,
    adminId: string,
    role: AuthUserRole.ADMIN | AuthUserRole.SUPER_ADMIN = AuthUserRole.SUPER_ADMIN,
) {
    const tokens = await app.get<ITokenService>(TOKEN_TOKEN_SERVICE).generateTokens(role, adminId);
    await app.get<ISessionService>(TOKEN_SESSION_SERVICE).openSession(role, adminId, tokens.jti);

    return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        jti: tokens.jti,
    };
}

/**
 * Seeds an admin and creates an active authenticated session.
 *
 * @param app The NestJS application instance.
 * @param options The registration options containing email, password, and role.
 * @returns A promise resolving to the admin ID and generated tokens.
 */
export async function registerAndLoginAdmin(
    app: NestFastifyApplication,
    {
        email = 'admin@example.com',
        password = 'Password123',
        role = AuthUserRole.SUPER_ADMIN,
    }: {
        email?: string;
        password?: string;
        role?: AuthUserRole.ADMIN | AuthUserRole.SUPER_ADMIN;
    } = {},
) {
    const admin = await registerAdmin(app, { email, password, role });

    return {
        id: admin.id,
        ...(await loginAdmin(app, admin.id, admin.role)),
    };
}
