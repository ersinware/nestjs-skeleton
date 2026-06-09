import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { BadRequestType } from 'src/common/enum/error/bad-request-type.enum';
import { ForbiddenType } from 'src/common/enum/error/forbidden-type.enum';
import { InternalServerErrorType } from 'src/common/enum/error/internal-server-error-type.enum';
import { NotFoundType } from 'src/common/enum/error/not-found-type.enum';
import { UnauthorizedType } from 'src/common/enum/error/unauthorized-type.enum';
import { ErrorDefaultDto } from 'src/common/dto/error-default.dto';
import { QueryPaginationDto } from 'src/common/dto/query-pagination.dto';
import { ResponsePaginationDto } from 'src/common/dto/response-pagination.dto';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { HashingService } from 'src/common/hashing/service/hashing.service';
import { TOKEN_ADMINS_REPOSITORY } from 'src/v1/admin/constant/admin.constant';
import { GetAdminDto } from 'src/v1/admin/dto/get-admin.dto';
import { GetCreatedAdminDto } from 'src/v1/admin/dto/get-created-admin.dto';
import { PatchAdminStatusDto } from 'src/v1/admin/dto/patch-admin-status.dto';
import { PostAdminDto } from 'src/v1/admin/dto/post-admin.dto';
import { IAdminsRepository } from 'src/v1/admin/interface/admins.repository.interface';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_DEFAULT_PAGE } from 'src/common/constant/pagination.constant';
import { createAuthTestApp } from '../../../shared/auth-test-app.factory';
import { cleanupCache } from '../../../shared/cache.cleaner';
import { cleanupDatabase } from '../../../shared/database.cleaner';
import { expectDataArrayDto, expectDataDto, expectErrorDto } from '../../../shared/dto-assertion.util';
import { registerAdmin, registerAndLoginAdmin, registerAndLoginUser } from '../../../shared/user-admin-seeder.factory';

describe('AdminController', () => {
    let app: NestFastifyApplication, adminsRepository: IAdminsRepository, hashingService: HashingService;

    beforeEach(async () => {
        app = await createAuthTestApp();
        adminsRepository = app.get<IAdminsRepository>(TOKEN_ADMINS_REPOSITORY);
        hashingService = app.get<HashingService>(HashingService);

        await cleanupCache(app);
        await cleanupDatabase(app);
    });

    afterEach(async () => {
        await app.close();
    });

    describe('POST /admin', () => {
        it('should successfully create a new admin and return GetCreatedAdminDto', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                dto: PostAdminDto = {
                    email: 'newadmin@example.com',
                    name: 'New Admin',
                    password: 'Password123!',
                },
                res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send(dto)
                    .expect(201),
                data = expectDataDto(res.body, GetCreatedAdminDto);

            expect(data.email).toBe(dto.email);
            expect(data.name).toBe(dto.name);
            expect(data.role).toBe(AuthUserRole.ADMIN);

            const adminDb = await adminsRepository.findById(data.id);
            expect(adminDb).toBeDefined();
            expect(await hashingService.verify(adminDb!.password, dto.password)).toBe(true);
            expect(adminDb!.isActive).toBe(true);
        });

        it('should return 400 if request body is empty', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({})
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toEqual([BadRequestType.EMPTY_BODY]);
        });

        it('should return 400 if validation rules fail due to weak password', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({
                        email: 'newadmin@example.com',
                        name: 'New Admin',
                        password: '123',
                    } satisfies PostAdminDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 400 if validation rules fail due to invalid email format', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({
                        email: 'invalid-email',
                        name: 'New Admin',
                        password: 'Password123!',
                    } satisfies PostAdminDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 400 if validation rules fail due to invalid name format', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({
                        email: 'newadmin@example.com',
                        name: 'John123',
                        password: 'Password123!',
                    } satisfies PostAdminDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 409 Conflict if email is already registered', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                existingEmail = 'existingadmin@example.com';

            await adminsRepository.create({
                email: existingEmail,
                name: 'Existing Admin',
                password: await hashingService.hash('Password123!'),
                role: AuthUserRole.ADMIN,
                isActive: true,
            });

            const res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({
                        email: existingEmail,
                        name: 'New Admin',
                        password: 'Password123!',
                    } satisfies PostAdminDto)
                    .expect(409),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(409);
        });

        it('should return 500 if repository fails to create the admin', async () => {
            const superAdmin = await registerAndLoginAdmin(app);
            vi.spyOn(adminsRepository, 'create').mockResolvedValueOnce(null);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({
                        email: 'error@example.com',
                        name: 'New Admin',
                        password: 'Password123!',
                    } satisfies PostAdminDto)
                    .expect(500),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(500);
            expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer()).post('/api/v1/admin').send({}).expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 UnauthorizedType.TOKEN if access token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', 'Bearer invalid-token')
                    .send({})
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should return 403 ForbiddenType.DEFAULT for non-super-admin callers (USER role)', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({})
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });

        it('should return 403 ForbiddenType.DEFAULT for non-super-admin callers (ADMIN role)', async () => {
            const admin = await registerAndLoginAdmin(app, { role: AuthUserRole.ADMIN }),
                res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .send({})
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });
    });

    describe('GET /admin', () => {
        it('should successfully return a list of all admins for super administrators', async () => {
            const superAdminEmail = 'super@example.com',
                superAdmin = await registerAndLoginAdmin(app, { email: superAdminEmail }),
                newAdminEmail = 'admin1@example.com',
                query: QueryPaginationDto = {
                    page: 1,
                    limit: 20,
                };

            await adminsRepository.create({
                email: newAdminEmail,
                name: 'Admin One',
                password: await hashingService.hash('Password123!'),
                role: AuthUserRole.ADMIN,
                isActive: true,
            });

            const res = await request(app.getHttpServer())
                    .get('/api/v1/admin')
                    .query(query)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .expect(200),
                data = expectDataDto(res.body, ResponsePaginationDto),
                items = expectDataArrayDto({ data: data.items }, GetAdminDto);

            expect(data.total).toEqual(2);
            expect(data.page).toBe(query.page);
            expect(data.limit).toBe(query.limit);
            expect(data.totalPages).toEqual(Math.ceil(data.total / data.limit));

            expect(items.length).toBeGreaterThanOrEqual(2);

            const emails = items.map((admin) => admin.email);
            expect(emails).toContain(superAdminEmail);
            expect(emails).toContain(newAdminEmail);
        });

        it('should successfully return a list of all admins even when no query parameters are sent', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .get('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .expect(200),
                data = expectDataDto(res.body, ResponsePaginationDto);

            expect(data.page).toBe(PAGINATION_DEFAULT_PAGE);
            expect(data.limit).toBe(PAGINATION_DEFAULT_LIMIT);
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer()).get('/api/v1/admin').expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 UnauthorizedType.TOKEN if access token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/admin')
                    .set('Authorization', 'Bearer invalid-token')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should return 403 ForbiddenType.DEFAULT for non-super-admin callers (USER role)', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .get('/api/v1/admin')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });

        it('should return 403 ForbiddenType.DEFAULT for non-super-admin callers (ADMIN role)', async () => {
            const admin = await registerAndLoginAdmin(app, { role: AuthUserRole.ADMIN }),
                res = await request(app.getHttpServer())
                    .get('/api/v1/admin')
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });
    });

    describe('DELETE /admin/:id', () => {
        it('should successfully soft-delete a standard admin, clear sessions, and instantly ban access token', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAndLoginAdmin(app, {
                    email: 'tobedeleted@example.com',
                    role: AuthUserRole.ADMIN,
                });

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/admin-only')
                .set('Authorization', `Bearer ${admin.accessToken}`)
                .expect(200);

            await request(app.getHttpServer())
                .delete(`/api/v1/admin/${admin.id}`)
                .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                .expect(204);

            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/admin-only')
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);

            const adminDb = await adminsRepository.findById(admin.id);
            expect(adminDb).toBeNull();
        });

        it('should return 400 if ID is not a valid UUID', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .delete('/api/v1/admin/invalid-uuid')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 404 if admin does not exist', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .delete(`/api/v1/admin/${uuidv7()}`)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .expect(404),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(404);
            expect(errorDto.message).toEqual([NotFoundType.DEFAULT]);
        });

        it('should return 403 if trying to delete a super administrator', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                targetSuperAdmin = await registerAdmin(app, { email: 'targetsuper@example.com' }),
                res = await request(app.getHttpServer())
                    .delete(`/api/v1/admin/${targetSuperAdmin.id}`)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });

        it('should return 500 if repository fails to delete the admin', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAdmin(app, {
                    email: 'deletefail@example.com',
                    role: AuthUserRole.ADMIN,
                });

            vi.spyOn(adminsRepository, 'delete').mockResolvedValueOnce(false);

            const res = await request(app.getHttpServer())
                    .delete(`/api/v1/admin/${admin.id}`)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .expect(500),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(500);
            expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer()).delete(`/api/v1/admin/${uuidv7()}`).expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 UnauthorizedType.TOKEN if access token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .delete(`/api/v1/admin/${uuidv7()}`)
                    .set('Authorization', 'Bearer invalid-token')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should return 403 ForbiddenType.DEFAULT for non-super-admin callers (USER role)', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .delete(`/api/v1/admin/${uuidv7()}`)
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });

        it('should return 403 ForbiddenType.DEFAULT for non-super-admin callers (ADMIN role)', async () => {
            const admin = await registerAndLoginAdmin(app, { role: AuthUserRole.ADMIN }),
                res = await request(app.getHttpServer())
                    .delete(`/api/v1/admin/${uuidv7()}`)
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });
    });

    describe('PATCH /admin/:id/status', () => {
        it('should successfully deactivate admin (setting isActive: false, invalidating sessions, and banning access token)', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAndLoginAdmin(app, {
                    email: 'tobedeactivated@example.com',
                    role: AuthUserRole.ADMIN,
                });

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/admin-only')
                .set('Authorization', `Bearer ${admin.accessToken}`)
                .expect(200);

            await request(app.getHttpServer())
                .patch(`/api/v1/admin/${admin.id}/status`)
                .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                .send({ active: false } satisfies PatchAdminStatusDto)
                .expect(204);

            const adminDb = await adminsRepository.findById(admin.id);
            expect(adminDb!.isActive).toBe(false);

            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/admin-only')
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should successfully reactivate admin (setting isActive: true, and unbanning user)', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAndLoginAdmin(app, {
                    email: 'tobereactivated@example.com',
                    role: AuthUserRole.ADMIN,
                });

            // Verify initially accessible
            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/admin-only')
                .set('Authorization', `Bearer ${admin.accessToken}`)
                .expect(200);

            // Deactivate
            await request(app.getHttpServer())
                .patch(`/api/v1/admin/${admin.id}/status`)
                .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                .send({ active: false } satisfies PatchAdminStatusDto)
                .expect(204);

            // Verify blocked
            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/admin-only')
                .set('Authorization', `Bearer ${admin.accessToken}`)
                .expect(401);

            // Reactivate
            await request(app.getHttpServer())
                .patch(`/api/v1/admin/${admin.id}/status`)
                .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                .send({ active: true } satisfies PatchAdminStatusDto)
                .expect(204);

            const adminDb = await adminsRepository.findById(admin.id);
            expect(adminDb!.isActive).toBe(true);

            // Verify accessible again
            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/admin-only')
                .set('Authorization', `Bearer ${admin.accessToken}`)
                .expect(200);
        });

        it('should return 400 if request body is empty', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${uuidv7()}/status`)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({})
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toEqual([BadRequestType.EMPTY_BODY]);
        });

        it('should return 400 if ID is not a valid UUID', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .patch('/api/v1/admin/invalid-uuid/status')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 400 if active status is not a boolean', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAdmin(app, {
                    email: 'statuscheck@example.com',
                    role: AuthUserRole.ADMIN,
                }),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${admin.id}/status`)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({ active: 'not-a-boolean' })
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 404 if admin does not exist', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${uuidv7()}/status`)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(404),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(404);
            expect(errorDto.message).toEqual([NotFoundType.DEFAULT]);
        });

        it('should return 403 if trying to deactivate a super administrator', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                targetSuperAdmin = await registerAdmin(app, { email: 'targetsuperstatus@example.com' }),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${targetSuperAdmin.id}/status`)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });

        it('should return 500 if repository fails to update status', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAdmin(app, {
                    email: 'statusfail@example.com',
                    role: AuthUserRole.ADMIN,
                });

            vi.spyOn(adminsRepository, 'update').mockResolvedValueOnce(null);

            const res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${admin.id}/status`)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(500),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(500);
            expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
        });

        it('should return 401 UnauthorizedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${uuidv7()}/status`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 UnauthorizedType.TOKEN if access token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${uuidv7()}/status`)
                    .set('Authorization', 'Bearer invalid-token')
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should return 403 ForbiddenType.DEFAULT for non-super-admin callers (USER role)', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${uuidv7()}/status`)
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });

        it('should return 403 ForbiddenType.DEFAULT for non-super-admin callers (ADMIN role)', async () => {
            const admin = await registerAndLoginAdmin(app, { role: AuthUserRole.ADMIN }),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${uuidv7()}/status`)
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([ForbiddenType.DEFAULT]);
        });
    });
});
