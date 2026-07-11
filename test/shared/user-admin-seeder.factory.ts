import { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ISessionPort, ITokenPort } from 'src/core/security';
import { TOKEN_HASHING_PORT, TOKEN_SESSION_PORT, TOKEN_TOKEN_PORT, type IHashingPort } from 'src/core/security';
import type { IAdminWriterPort } from 'src/module/admin/application/command/port/admin-writer.port';
import { TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port/admin-writer.port';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import type { IUserWriterPort } from 'src/module/user/application/command/port/user-writer.port';
import { TOKEN_USER_WRITER_PORT } from 'src/module/user/application/command/port/user-writer.port';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { AdminRole } from 'src/shared/domain/admin/enum/admin-role.enum';
import { UserRole } from 'src/shared/domain/user/enum/user-role.enum';
import { uuidv7 } from 'uuidv7';

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
    const hashedPassword = await app.get<IHashingPort>(TOKEN_HASHING_PORT).hash(password);
    const user = User.create(uuidv7(), { email, name: 'Test User', password: hashedPassword });
    const userWriterPort = app.get<IUserWriterPort>(TOKEN_USER_WRITER_PORT);
    await userWriterPort.save(user);

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
    const tokens = await app.get<ITokenPort>(TOKEN_TOKEN_PORT).generateTokens(UserRole.USER, userId);
    await app.get<ISessionPort>(TOKEN_SESSION_PORT).openSession(UserRole.USER, userId, tokens.jti);

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
        role = AdminRole.SUPER_ADMIN,
    }: {
        email?: string;
        password?: string;
        role?: AdminRole.ADMIN | AdminRole.SUPER_ADMIN;
    } = {},
) {
    const hashedPassword = await app.get<IHashingPort>(TOKEN_HASHING_PORT).hash(password);
    const admin = Admin.create(uuidv7(), { email, name: 'Test Admin', password: hashedPassword, role });
    const repo = app.get<IAdminWriterPort>(TOKEN_ADMIN_WRITER_PORT);
    await repo.save(admin);

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
    role: AdminRole.ADMIN | AdminRole.SUPER_ADMIN = AdminRole.SUPER_ADMIN,
) {
    const tokens = await app.get<ITokenPort>(TOKEN_TOKEN_PORT).generateTokens(role, adminId);
    await app.get<ISessionPort>(TOKEN_SESSION_PORT).openSession(role, adminId, tokens.jti);

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
        role = AdminRole.SUPER_ADMIN,
    }: {
        email?: string;
        password?: string;
        role?: AdminRole.ADMIN | AdminRole.SUPER_ADMIN;
    } = {},
) {
    const admin = await registerAdmin(app, { email, password, role });

    return {
        id: admin.id,
        ...(await loginAdmin(app, admin.id, admin.role)),
    };
}
