import { EventEmitter2 } from '@nestjs/event-emitter';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TOKEN_EMAIL_INTAKE_PORT } from 'src/core/email';
import {
    AccessDeniedType,
    ErrorDefaultDto,
    InternalServerErrorType,
    InvalidRequestType,
    ResourceNotFoundType,
    UnauthenticatedType,
} from 'src/core/exception';
import { QueryPaginationDto, ResponsePaginationDto } from 'src/core/http';
import { TOKEN_ADMIN_WRITER_PORT, type IAdminWriterPort } from 'src/module/admin/application/command/port';
import { AdminEvent } from 'src/module/admin/domain/event';
import { PatchAdminStatusDto } from 'src/module/admin/presentation/dto/patch-admin-status.dto';
import { PostAdminDto } from 'src/module/admin/presentation/dto/post-admin.dto';
import { ResponseAdminDto } from 'src/module/admin/presentation/dto/response-admin.dto';
import { ResponseCreatedAdminDto } from 'src/module/admin/presentation/dto/response-created-admin.dto';
import { AdminRole } from 'src/shared/domain/admin/enum/admin-role.enum';
import { DomainEvent } from 'src/shared/domain/event';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_DEFAULT_PAGE } from 'src/shared/pagination';
import request from 'supertest';
import { createAuthTestApp } from 'test/shared/auth-test-app.factory';
import { cleanupCache } from 'test/shared/cache.cleaner';
import { cleanupDatabase } from 'test/shared/database.cleaner';
import { expectDataArrayDto, expectDataDto, expectErrorDto } from 'test/shared/dto-assertion.util';
import { registerAdmin, registerAndLoginAdmin, registerAndLoginUser } from 'test/shared/user-admin-seeder.factory';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

describe('AdminController', () => {
    const mockEmailAdapter = {};

    let app: NestFastifyApplication,
        adminsRepository: IAdminWriterPort,
        eventEmitter: EventEmitter2,
        emitSpy: MockInstance;

    beforeEach(async () => {
        app = await createAuthTestApp({
            overrides: [
                {
                    provide: TOKEN_EMAIL_INTAKE_PORT,
                    useValue: mockEmailAdapter,
                },
            ],
        });
        adminsRepository = app.get<IAdminWriterPort>(TOKEN_ADMIN_WRITER_PORT);
        eventEmitter = app.get<EventEmitter2>(EventEmitter2);
        emitSpy = vi.spyOn(eventEmitter, 'emit');

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
                };

            const res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send(dto)
                    .expect(201),
                data = expectDataDto(res.body, ResponseCreatedAdminDto);

            expect(data.email).toBe(dto.email);
            expect(data.name).toBe(dto.name);
            expect(data.role).toBe(AdminRole.ADMIN);

            expect(emitSpy).toHaveBeenCalledWith(AdminEvent.CREATED, expect.any(DomainEvent));

            const welcomeEmailEvent = emitSpy.mock.calls.find(
                (call: unknown[]) => call[0] === AdminEvent.CREATED,
            )?.[1] as DomainEvent;
            expect(welcomeEmailEvent).toBeDefined();

            const adminDb = await adminsRepository.load(data.id);
            expect(adminDb).toBeDefined();
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
            expect(errorDto.message).toEqual([InvalidRequestType.EMPTY_BODY]);
        });

        it('should return 400 if validation rules fail due to invalid email format', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({
                        email: 'invalid-email',
                        name: 'New Admin',
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
                    } satisfies PostAdminDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 409 Conflict if email is already registered', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                existingEmail = 'existingadmin@example.com';

            await registerAdmin(app, { email: existingEmail, password: 'Password123!', role: AdminRole.ADMIN });

            const res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({
                        email: existingEmail,
                        name: 'New Admin',
                    } satisfies PostAdminDto)
                    .expect(409),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(409);
        });

        it('should return 500 if repository fails to create the admin', async () => {
            const superAdmin = await registerAndLoginAdmin(app);
            vi.spyOn(adminsRepository, 'save').mockRejectedValueOnce(new Error('DB Error'));

            const res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({
                        email: 'error@example.com',
                        name: 'New Admin',
                    } satisfies PostAdminDto)
                    .expect(500),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(500);
            expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
        });

        it('should return 401 UnauthenticatedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer()).post('/api/v1/admin').send({}).expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 UnauthenticatedType.DEFAULT if access token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', 'Bearer invalid-token')
                    .send({})
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should return 403 AccessDeniedType.DEFAULT for non-super-admin callers (USER role)', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({})
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([AccessDeniedType.DEFAULT]);
        });

        it('should return 403 AccessDeniedType.DEFAULT for non-super-admin callers (ADMIN role)', async () => {
            const admin = await registerAndLoginAdmin(app, { role: AdminRole.ADMIN }),
                res = await request(app.getHttpServer())
                    .post('/api/v1/admin')
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .send({})
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([AccessDeniedType.DEFAULT]);
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

            await registerAdmin(app, { email: newAdminEmail, password: 'Password123!', role: AdminRole.ADMIN });

            const res = await request(app.getHttpServer())
                    .get('/api/v1/admin')
                    .query(query)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .expect(200),
                data = expectDataDto(res.body, ResponsePaginationDto),
                items = expectDataArrayDto({ data: data.items }, ResponseAdminDto);

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

        it('should return 401 UnauthenticatedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer()).get('/api/v1/admin').expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 UnauthenticatedType.DEFAULT if access token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/admin')
                    .set('Authorization', 'Bearer invalid-token')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should return 403 AccessDeniedType.DEFAULT for non-super-admin callers (USER role)', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .get('/api/v1/admin')
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([AccessDeniedType.DEFAULT]);
        });

        it('should return 403 AccessDeniedType.DEFAULT for non-super-admin callers (ADMIN role)', async () => {
            const admin = await registerAndLoginAdmin(app, { role: AdminRole.ADMIN }),
                res = await request(app.getHttpServer())
                    .get('/api/v1/admin')
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([AccessDeniedType.DEFAULT]);
        });
    });

    describe('DELETE /admin/:id', () => {
        it('should successfully soft-delete a standard admin, clear sessions, and instantly ban access token', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAndLoginAdmin(app, {
                    email: 'tobedeleted@example.com',
                    role: AdminRole.ADMIN,
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
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);

            const adminDb = await adminsRepository.load(admin.id);
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
            expect(errorDto.message).toEqual([ResourceNotFoundType.DEFAULT]);
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
            expect(errorDto.message).toEqual([AccessDeniedType.DEFAULT]);
        });

        it('should return 500 if repository fails to delete the admin', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAdmin(app, {
                    email: 'deletefail@example.com',
                    role: AdminRole.ADMIN,
                });

            vi.spyOn(adminsRepository, 'save').mockRejectedValueOnce(new Error('DB Error'));

            const res = await request(app.getHttpServer())
                    .delete(`/api/v1/admin/${admin.id}`)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .expect(500),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(500);
            expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
        });

        it('should return 401 UnauthenticatedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer()).delete(`/api/v1/admin/${uuidv7()}`).expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 UnauthenticatedType.DEFAULT if access token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .delete(`/api/v1/admin/${uuidv7()}`)
                    .set('Authorization', 'Bearer invalid-token')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should return 403 AccessDeniedType.DEFAULT for non-super-admin callers (USER role)', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .delete(`/api/v1/admin/${uuidv7()}`)
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([AccessDeniedType.DEFAULT]);
        });

        it('should return 403 AccessDeniedType.DEFAULT for non-super-admin callers (ADMIN role)', async () => {
            const admin = await registerAndLoginAdmin(app, { role: AdminRole.ADMIN }),
                res = await request(app.getHttpServer())
                    .delete(`/api/v1/admin/${uuidv7()}`)
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([AccessDeniedType.DEFAULT]);
        });
    });

    describe('PATCH /admin/:id/status', () => {
        it('should successfully deactivate admin (setting isActive: false, invalidating sessions, and banning access token)', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAndLoginAdmin(app, {
                    email: 'tobedeactivated@example.com',
                    role: AdminRole.ADMIN,
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

            const adminDb = await adminsRepository.load(admin.id);
            expect(adminDb!.isActive).toBe(false);

            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/admin-only')
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should successfully reactivate admin (setting isActive: true, and unbanning user)', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAndLoginAdmin(app, {
                    email: 'tobereactivated@example.com',
                    role: AdminRole.ADMIN,
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

            const adminDb = await adminsRepository.load(admin.id);
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
            expect(errorDto.message).toEqual([InvalidRequestType.EMPTY_BODY]);
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
                    role: AdminRole.ADMIN,
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
            expect(errorDto.message).toEqual([ResourceNotFoundType.DEFAULT]);
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
            expect(errorDto.message).toEqual([AccessDeniedType.DEFAULT]);
        });

        it('should return 500 if repository fails to update status', async () => {
            const superAdmin = await registerAndLoginAdmin(app),
                admin = await registerAdmin(app, {
                    email: 'statusfail@example.com',
                    role: AdminRole.ADMIN,
                });

            vi.spyOn(adminsRepository, 'save').mockRejectedValueOnce(new Error('DB Error'));

            const res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${admin.id}/status`)
                    .set('Authorization', `Bearer ${superAdmin.accessToken}`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(500),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(500);
            expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
        });

        it('should return 401 UnauthenticatedType.MISSING_CREDENTIALS if access token is missing', async () => {
            const res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${uuidv7()}/status`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 UnauthenticatedType.DEFAULT if access token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${uuidv7()}/status`)
                    .set('Authorization', 'Bearer invalid-token')
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should return 403 AccessDeniedType.DEFAULT for non-super-admin callers (USER role)', async () => {
            const user = await registerAndLoginUser(app),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${uuidv7()}/status`)
                    .set('Authorization', `Bearer ${user.accessToken}`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([AccessDeniedType.DEFAULT]);
        });

        it('should return 403 AccessDeniedType.DEFAULT for non-super-admin callers (ADMIN role)', async () => {
            const admin = await registerAndLoginAdmin(app, { role: AdminRole.ADMIN }),
                res = await request(app.getHttpServer())
                    .patch(`/api/v1/admin/${uuidv7()}/status`)
                    .set('Authorization', `Bearer ${admin.accessToken}`)
                    .send({ active: false } satisfies PatchAdminStatusDto)
                    .expect(403),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(403);
            expect(errorDto.message).toEqual([AccessDeniedType.DEFAULT]);
        });
    });
});
