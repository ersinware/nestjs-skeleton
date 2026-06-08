import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { BadRequestType } from 'src/common/enum/error/bad-request-type.enum';
import { ForbiddenType } from 'src/common/enum/error/forbidden-type.enum';
import { InternalServerErrorType } from 'src/common/enum/error/internal-server-error-type.enum';
import { NotFoundType } from 'src/common/enum/error/not-found-type.enum';
import { UnauthorizedType } from 'src/common/enum/error/unauthorized-type.enum';
import { ErrorDefaultDto } from 'src/common/dto/error-default.dto';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { HashingService } from 'src/common/hashing/service/hashing.service';
import { SessionService } from 'src/v1/auth/session.service';
import { TOKEN_USERS_REPOSITORY } from 'src/v1/user/constant/user.constant';
import { GetUserDto } from 'src/v1/user/dto/get-user.dto';
import { PatchUserPasswordDto } from 'src/v1/user/dto/patch-user-password.dto';
import { PatchUserStatusDto } from 'src/v1/user/dto/patch-user-status.dto';
import { PatchUserDto } from 'src/v1/user/dto/patch-user.dto';
import { PostUserDto } from 'src/v1/user/dto/post-user.dto';
import { IUsersRepository } from 'src/v1/user/interface/users.repository.interface';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthTestApp } from '../../../shared/auth-test-app.factory';
import { cleanupCache } from '../../../shared/cache.cleaner';
import { cleanupDatabase } from '../../../shared/database.cleaner';
import { expectDataArrayDto, expectDataDto, expectErrorDto } from '../../../shared/dto-assertion.util';
import { registerAndLoginAdmin, registerAndLoginUser, registerUser } from '../../../shared/user-admin-seeder.factory';

describe('UserController', () => {
    let app: NestFastifyApplication,
        usersRepository: IUsersRepository,
        hashingService: HashingService,
        sessionService: SessionService;

    beforeEach(async () => {
        app = await createAuthTestApp();
        usersRepository = app.get<IUsersRepository>(TOKEN_USERS_REPOSITORY);
        hashingService = app.get<HashingService>(HashingService);
        sessionService = app.get<SessionService>(SessionService);

        await cleanupCache(app);
        await cleanupDatabase(app);
    });

    afterEach(async () => {
        await app.close();
    });

    describe('POST /user', () => {
        it('should successfully create a new user and return the GetUserDto format (verifying password exclusion)', async () => {
            const dto: PostUserDto = {
                    email: 'newuser@example.com',
                    name: 'New User',
                    password: 'Password123!',
                },
                res = await request(app.getHttpServer()).post('/api/v1/user').send(dto).expect(201),
                data = expectDataDto(res.body, GetUserDto);

            expect(data.email).toBe(dto.email);
            expect(data.name).toBe(dto.name);
            expect(data.id).toBeDefined();
        });

        it('should return 400 if request body is empty', async () => {
            const res = await request(app.getHttpServer()).post('/api/v1/user').send({}).expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toEqual([BadRequestType.EMPTY_BODY]);
        });

        it('should return 400 if validation rules fail due to weak password', async () => {
            const dto: PostUserDto = {
                    email: 'newuser@example.com',
                    name: 'New User',
                    password: '123',
                },
                res = await request(app.getHttpServer()).post('/api/v1/user').send(dto).expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 400 if validation rules fail due to invalid email format', async () => {
            const dto: PostUserDto = {
                    email: 'invalid-email',
                    name: 'New User',
                    password: 'Password123!',
                },
                res = await request(app.getHttpServer()).post('/api/v1/user').send(dto).expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 400 if validation rules fail due to invalid name format', async () => {
            const dto: PostUserDto = {
                    email: 'newuser@example.com',
                    name: 'John123',
                    password: 'Password123!',
                },
                res = await request(app.getHttpServer()).post('/api/v1/user').send(dto).expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 409 Conflict if email is already registered', async () => {
            const email = 'conflict@example.com';

            await usersRepository.create({
                email,
                name: 'Existing User',
                password: await hashingService.hash('Password123!'),
                isActive: true,
            });

            const dto: PostUserDto = {
                    email,
                    name: 'New User',
                    password: 'Password123!',
                },
                res = await request(app.getHttpServer()).post('/api/v1/user').send(dto).expect(409),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(409);
        });

        it('should return 500 InternalServerErrorType.DEFAULT if repository fails to create the user', async () => {
            vi.spyOn(usersRepository, 'create').mockResolvedValueOnce(null);

            const dto: PostUserDto = {
                    email: 'error@example.com',
                    name: 'New User',
                    password: 'Password123!',
                },
                res = await request(app.getHttpServer()).post('/api/v1/user').send(dto).expect(500),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(500);
            expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
        });
    });

    describe('GET /user', () => {
        it('should successfully return a list of all users for administrators', async () => {
            const admin = await registerAndLoginAdmin(app),
                newUser = {
                    email: 'user1@example.com',
                    name: 'User One',
                    password: await hashingService.hash('Password123!'),
                    isActive: true,
                };

            await usersRepository.create(newUser);

            const res = await request(app.getHttpServer())
                    .get('/api/v1/user')
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(200),
                data = expectDataArrayDto(res.body, GetUserDto);

            expect(data.length).toBeGreaterThanOrEqual(1);
            expect(data[0]!.email).toBe(newUser.email);
            expect(data[0]!.name).toBe(newUser.name);
            expect(data[0]!.id).toBeDefined();
        });

        it('should return 403 ForbiddenType.DEFAULT for non-admin callers', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .get('/api/v1/user')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer()).get('/api/v1/user').expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 UnauthorizedType.TOKEN if access token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/user')
                    .set('Authorization', 'Bearer invalid-token')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });
    });

    describe('GET /user/me', () => {
        it('should successfully return profile details for the authenticated user', async () => {
            const email = 'me@example.com',
                user = await registerAndLoginUser(app, { email }),
                res = await request(app.getHttpServer())
                    .get('/api/v1/user/me')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .expect(200),
                data = expectDataDto(res.body, GetUserDto);

            expect(data.email).toBe(email);
            expect(data.id).toBe(user.id);
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer()).get('/api/v1/user/me').expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 UnauthorizedType.TOKEN if access token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/user/me')
                    .set('Authorization', 'Bearer invalid-token')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should return 404 NotFoundType.DEFAULT if the authenticated user does not exist in the database', async () => {
            const user = await registerAndLoginUser(app);

            await usersRepository.delete(user.id);

            const res = await request(app.getHttpServer())
                    .get('/api/v1/user/me')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .expect(404),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(404);
            expect(errorDto.message).toEqual([NotFoundType.DEFAULT]);
        });
    });

    describe('GET /user/:id', () => {
        it('should successfully return details of a specific user for administrators', async () => {
            const admin = await registerAndLoginAdmin(app),
                email = 'findbyid@example.com',
                user = await registerUser(app, { email }),
                res = await request(app.getHttpServer())
                    .get(`/api/v1/user/${user.id}`)
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(200),
                data = expectDataDto(res.body, GetUserDto);

            expect(data.email).toBe(email);
            expect(data.id).toBe(user.id);
        });

        it('should return 403 ForbiddenType.DEFAULT for non-admin callers', async () => {
            const user1 = await registerAndLoginUser(app),
                user2 = await registerUser(app, { email: 'user2@example.com' }),
                res = await request(app.getHttpServer())
                    .get(`/api/v1/user/${user2.id}`)
                    .set('Authorization', `Bearer ${user1.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });

        it('should return 404 NotFoundType.DEFAULT if user ID does not exist', async () => {
            const admin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .get(`/api/v1/user/${uuidv7()}`)
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(404),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(404);
            expect(errorDto.message).toEqual([NotFoundType.DEFAULT]);
        });

        it('should return 400 if user ID is not a valid UUID', async () => {
            const admin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .get('/api/v1/user/invalid-uuid')
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer()).get(`/api/v1/user/${uuidv7()}`).expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });
    });

    describe('PATCH /user/me', () => {
        it('should successfully update email and/or name and verify changes persist', async () => {
            const user = await registerAndLoginUser(app),
                patchPayload: PatchUserDto = {
                    email: 'newemail@example.com',
                    name: 'Updated Name',
                },
                res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send(patchPayload)
                    .expect(200),
                data = expectDataDto(res.body, GetUserDto);

            expect(data.email).toBe(patchPayload.email);
            expect(data.name).toBe(patchPayload.name);

            const userDb = await usersRepository.findById(user.id);
            expect(userDb!.email).toBe(patchPayload.email);
            expect(userDb!.name).toBe(patchPayload.name);
        });

        it('should return 400 if request body is empty', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({})
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toEqual([BadRequestType.EMPTY_BODY]);
        });

        it('should return 400 if validation rules fail due to invalid email format', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({ email: 'invalid-email' } satisfies PatchUserDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 409 Conflict if email is already in use by another user', async () => {
            const user1 = await registerAndLoginUser(app),
                user2Email = 'user2@example.com';

            await registerUser(app, { email: user2Email });

            const res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me')
                    .set('Authorization', `Bearer ${user1.accessToken}`)
                    .send({ email: user2Email } satisfies PatchUserDto)
                    .expect(409),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(409);
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me')
                    .send({ name: 'Jane Doe' } satisfies PatchUserDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 404 NotFoundType.DEFAULT if the authenticated user does not exist in the database', async () => {
            const user = await registerAndLoginUser(app);

            await usersRepository.delete(user.id);

            const res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({
                        name: 'New Name',
                    } satisfies PatchUserDto)
                    .expect(404),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(404);
            expect(errorDto.message).toEqual([NotFoundType.DEFAULT]);
        });
    });

    describe('PATCH /user/me/password', () => {
        it('should successfully change user password (returning 204) and verify the stored password matches the new password', async () => {
            const currentPassword = 'OldPassword123!',
                user = await registerAndLoginUser(app, { password: currentPassword }),
                patchPayload: PatchUserPasswordDto = {
                    currentPassword,
                    newPassword: 'NewPassword123!',
                };

            await request(app.getHttpServer())
                .patch('/api/v1/user/me/password')
                .set('Authorization', `Bearer ${user.accessToken}`)
                .send(patchPayload)
                .expect(204);

            const hashedPassword = await usersRepository.findPasswordById(user.id);
            expect(await hashingService.verify(hashedPassword!, patchPayload.newPassword)).toBe(true);
        });

        it('should return 400 if request body is empty', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me/password')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({})
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toEqual([BadRequestType.EMPTY_BODY]);
        });

        it('should return 400 if current password is wrong', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me/password')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({
                        currentPassword: 'WrongPassword123!',
                        newPassword: 'NewPassword123!',
                    } satisfies PatchUserPasswordDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
        });

        it('should return 400 if new password matches current password', async () => {
            const currentPassword = 'Password123!',
                user = await registerAndLoginUser(app, { password: currentPassword }),
                res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me/password')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({
                        currentPassword,
                        newPassword: currentPassword,
                    } satisfies PatchUserPasswordDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
        });

        it('should return 400 if new password is too weak', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me/password')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({
                        currentPassword: 'Password123!',
                        newPassword: '123',
                    } satisfies PatchUserPasswordDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 500 InternalServerErrorType.DEFAULT if database update fails', async () => {
            const currentPassword = 'Password123!',
                user = await registerAndLoginUser(app, { password: currentPassword });

            vi.spyOn(usersRepository, 'update').mockResolvedValueOnce(null);

            const res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me/password')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({
                        currentPassword,
                        newPassword: 'NewPassword123!',
                    } satisfies PatchUserPasswordDto)
                    .expect(500),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(500);
            expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me/password')
                    .send({ currentPassword: 'Old', newPassword: 'New' } satisfies PatchUserPasswordDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 404 NotFoundType.DEFAULT if the authenticated user does not exist in the database', async () => {
            const user = await registerAndLoginUser(app);

            await usersRepository.delete(user.id);

            const res = await request(app.getHttpServer())
                    .patch('/api/v1/user/me/password')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({
                        currentPassword: 'Password123',
                        newPassword: 'NewPassword123!',
                    } satisfies PatchUserPasswordDto)
                    .expect(404),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(404);
            expect(errorDto.message).toEqual([NotFoundType.DEFAULT]);
        });
    });

    describe('DELETE /user/me', () => {
        it('should successfully soft-delete user, clear sessions, and instantly ban access token', async () => {
            const user = await registerAndLoginUser(app);

            // Verify access to protected route works before deletion
            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/protected')
                .set('Authorization', `Bearer ${user.accessToken}`)
                .expect(200);

            await request(app.getHttpServer())
                .delete('/api/v1/user/me')
                .set('Authorization', `Bearer ${user.accessToken}`)
                .expect(204);

            // Verify access token is instantly banned (returns 401)
            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/protected')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);

            // Verify refresh token session is evicted from the cache
            const session = await sessionService.getSession(AuthUserRole.USER, user.id, user.jti);
            expect(session).toBeNull();
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer()).delete('/api/v1/user/me').expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });
    });

    describe('PATCH /user/:id/status', () => {
        it('should successfully deactivate user (setting isActive: false, invalidating sessions, and banning access token)', async () => {
            const admin = await registerAndLoginAdmin(app),
                user = await registerAndLoginUser(app);

            // Verify access to protected route works before deactivation
            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/protected')
                .set('Authorization', `Bearer ${user.accessToken}`)
                .expect(200);

            await request(app.getHttpServer())
                .patch(`/api/v1/user/${user.id}/status`)
                .set('Authorization', `Bearer ${admin.accessToken}`)
                .send({ active: false } satisfies PatchUserStatusDto)
                .expect(204);

            const userDb = await usersRepository.findById(user.id);
            expect(userDb!.isActive).toBe(false);

            // Verify access token is instantly banned
            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/protected')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should successfully reactivate user (setting isActive: true, and unbanning user)', async () => {
            const admin = await registerAndLoginAdmin(app),
                user = await registerAndLoginUser(app);

            // Verify initially accessible
            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/protected')
                .set('Authorization', `Bearer ${user.accessToken}`)
                .expect(200);

            // Deactivate
            await request(app.getHttpServer())
                .patch(`/api/v1/user/${user.id}/status`)
                .set('Authorization', `Bearer ${admin.accessToken}`)
                .send({ active: false } satisfies PatchUserStatusDto)
                .expect(204);

            // Verify blocked
            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/protected')
                .set('Authorization', `Bearer ${user.accessToken}`)
                .expect(401);

            // Reactivate
            await request(app.getHttpServer())
                .patch(`/api/v1/user/${user.id}/status`)
                .set('Authorization', `Bearer ${admin.accessToken}`)
                .send({ active: true } satisfies PatchUserStatusDto)
                .expect(204);

            const userDb = await usersRepository.findById(user.id);
            expect(userDb!.isActive).toBe(true);

            // Verify accessible again
            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/protected')
                .set('Authorization', `Bearer ${user.accessToken}`)
                .expect(200);
        });

        it('should return 404 NotFoundType.DEFAULT if user does not exist', async () => {
            const admin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/user/${uuidv7()}/status`)
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .send({ active: false } satisfies PatchUserStatusDto)
                    .expect(404),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(404);
            expect(errorDto.message).toEqual([NotFoundType.DEFAULT]);
        });

        it('should return 403 ForbiddenType.DEFAULT for non-admin callers', async () => {
            const user1 = await registerAndLoginUser(app),
                user2 = await registerUser(app, { email: 'user2@example.com' }),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/user/${user2.id}/status`)
                    .set('Authorization', `Bearer ${user1.accessToken}`)
                    .send({ active: false } satisfies PatchUserStatusDto)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const user = await registerUser(app),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/user/${user.id}/status`)
                    .send({ active: false } satisfies PatchUserStatusDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 400 if request body is empty', async () => {
            const admin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/user/${uuidv7()}/status`)
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .send({})
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toEqual([BadRequestType.EMPTY_BODY]);
        });

        it('should return 400 if ID is not a valid UUID', async () => {
            const admin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .patch('/api/v1/user/invalid-uuid/status')
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .send({ active: false } satisfies PatchUserStatusDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
            expect(errorDto.message[0]!.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 400 if active status is not a boolean', async () => {
            const admin = await registerAndLoginAdmin(app),
                user = await registerUser(app),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/user/${user.id}/status`)
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .send({ active: 'not-a-boolean' })
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });
    });
});
