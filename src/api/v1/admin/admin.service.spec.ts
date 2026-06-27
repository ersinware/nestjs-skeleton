/**
 * @file admin.service.spec.ts
 * @description Unit tests for the AdminService. Ensures that business logic regarding admin creation, status updates, deletion, and session revocation works as expected and handles errors correctly.
 */

import { ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { TOKEN_HASHING_SERVICE } from 'src/common/port/security/hashing.constant';
import { TOKEN_SESSION_SERVICE } from 'src/common/port/security/session.constant';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service';
import { TOKEN_ADMINS_REPOSITORY } from './constant/admin.constant';
import { PostAdminDto } from './dto/post-admin.dto';
import { AdminEvent } from './enum/admin-event.enum';
import { AdminCreatedEvent } from './event/admin-created.event';
import type { IAdminsRepository } from './interface/admins.repository.interface';
import { QueryPaginationDto } from 'src/common/pagination/dto/query-pagination.dto';

describe('AdminService', () => {
    const mockRepository = {
            create: vi.fn(),
            findAll: vi.fn(),
            findById: vi.fn(),
            findByEmail: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            hardDelete: vi.fn(),
        } satisfies IAdminsRepository,
        mockEventEmitter = {
            emit: vi.fn(),
        },
        mockSessionService = {
            closeAllSessions: vi.fn(),
            ban: vi.fn(),
            unban: vi.fn(),
        },
        mockHashingService = {
            hash: vi.fn((password: string) => Promise.resolve(`hashed_${password}`)),
        };

    let service: AdminService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AdminService,
                {
                    provide: TOKEN_ADMINS_REPOSITORY,
                    useValue: mockRepository,
                },
                {
                    provide: TOKEN_SESSION_SERVICE,
                    useValue: mockSessionService,
                },
                {
                    provide: TOKEN_HASHING_SERVICE,
                    useValue: mockHashingService,
                },
                {
                    provide: EventEmitter2,
                    useValue: mockEventEmitter,
                },
            ],
        }).compile();

        service = module.get<AdminService>(AdminService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        const postAdminDto: PostAdminDto = {
            email: 'admin@example.com',
            name: 'Admin Name',
        };

        it('should throw ConflictException if email is already in use', async () => {
            mockRepository.findByEmail.mockResolvedValueOnce({ id: '018f43c3-6bb3-7d72-911e-848821a837c3' });

            await expect(service.create(postAdminDto)).rejects.toThrow(ConflictException);
            expect(mockRepository.findByEmail).toHaveBeenCalledWith(postAdminDto.email);
            expect(mockHashingService.hash).not.toHaveBeenCalled();
            expect(mockEventEmitter.emit).not.toHaveBeenCalled();
        });

        it('should throw InternalServerErrorException if admin creation fails', async () => {
            mockRepository.findByEmail.mockResolvedValueOnce(null);
            mockRepository.create.mockResolvedValueOnce(null);

            await expect(service.create(postAdminDto)).rejects.toThrow(InternalServerErrorException);
            expect(mockRepository.findByEmail).toHaveBeenCalledWith(postAdminDto.email);
            expect(mockHashingService.hash).toHaveBeenCalledWith(expect.any(String));
            expect(mockRepository.create).toHaveBeenCalledWith({
                ...postAdminDto,
                password: expect.any(String) as string,
                role: AuthUserRole.ADMIN,
            });
            expect(mockEventEmitter.emit).not.toHaveBeenCalled();
        });

        it('should successfully generate password, hash it, create admin, and queue welcome email', async () => {
            const newAdmin = {
                id: '018f43c3-6bb3-7d72-911e-848821a837c3',
                email: postAdminDto.email,
                name: postAdminDto.name,
                password: 'mock_hashed_password',
                role: AuthUserRole.ADMIN as const,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            };

            mockRepository.findByEmail.mockResolvedValueOnce(null);
            mockRepository.create.mockResolvedValueOnce(newAdmin);

            await expect(service.create(postAdminDto)).resolves.toEqual(newAdmin);

            const generatedPassword = mockHashingService.hash.mock.calls[0]?.[0] as string;
            expect(generatedPassword).toBeTypeOf('string');
            expect(generatedPassword.length).toBeGreaterThanOrEqual(16);

            expect(mockRepository.findByEmail).toHaveBeenCalledWith(postAdminDto.email);
            expect(mockHashingService.hash).toHaveBeenCalledWith(generatedPassword);
            expect(mockRepository.create).toHaveBeenCalledWith({
                ...postAdminDto,
                password: `hashed_${generatedPassword}`,
                role: AuthUserRole.ADMIN,
            });
            expect(mockEventEmitter.emit).toHaveBeenCalledWith(
                AdminEvent.CREATED,
                new AdminCreatedEvent(newAdmin, generatedPassword),
            );
            expect(mockRepository.hardDelete).not.toHaveBeenCalled();
        });
    });

    describe('findAll', () => {
        it('should return all admins with pagination', async () => {
            const query: QueryPaginationDto = { page: 1, limit: 10 },
                result = {
                    data: [
                        {
                            id: '018f43c3-6bb3-7d72-911e-848821a837c3',
                        },
                    ],
                    total: 1,
                };

            mockRepository.findAll.mockResolvedValueOnce(result);

            await expect(service.findAll(query)).resolves.toEqual(result);
            expect(mockRepository.findAll).toHaveBeenCalledWith(query);
        });
    });

    describe('delete', () => {
        const id = '018f43c3-6bb3-7d72-911e-848821a837c4';

        it('should throw NotFoundException if admin to delete is not found', async () => {
            mockRepository.findById.mockResolvedValueOnce(null);

            await expect(service.delete(id)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockSessionService.closeAllSessions).not.toHaveBeenCalled();
        });

        it('should throw ForbiddenException if trying to delete a super admin', async () => {
            const admin = { id, role: AuthUserRole.SUPER_ADMIN };

            mockRepository.findById.mockResolvedValueOnce(admin);

            await expect(service.delete(id)).rejects.toThrow(ForbiddenException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockSessionService.closeAllSessions).not.toHaveBeenCalled();
        });

        it('should throw InternalServerErrorException if delete operation fails', async () => {
            const admin = { id, role: AuthUserRole.ADMIN };

            mockRepository.findById.mockResolvedValueOnce(admin);
            mockRepository.delete.mockResolvedValueOnce(false);

            await expect(service.delete(id)).rejects.toThrow(InternalServerErrorException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockSessionService.closeAllSessions).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockSessionService.ban).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockRepository.delete).toHaveBeenCalledWith(id);
        });

        it('should successfully delete admin and clear sessions if found', async () => {
            const admin = { id, role: AuthUserRole.ADMIN };

            mockRepository.findById.mockResolvedValueOnce(admin);
            mockRepository.delete.mockResolvedValueOnce(true);

            await expect(service.delete(id)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockSessionService.closeAllSessions).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockSessionService.ban).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockRepository.delete).toHaveBeenCalledWith(id);
        });
    });

    describe('updateStatus', () => {
        const id = '018f43c3-6bb3-7d72-911e-848821a837c4';

        it('should throw NotFoundException if admin to update status is not found', async () => {
            mockRepository.findById.mockResolvedValueOnce(null);

            await expect(service.updateStatus(id, false)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockSessionService.closeAllSessions).not.toHaveBeenCalled();
        });

        it('should throw ForbiddenException if trying to deactivate a super admin', async () => {
            const admin = { id, role: AuthUserRole.SUPER_ADMIN, isActive: true };

            mockRepository.findById.mockResolvedValueOnce(admin);

            await expect(service.updateStatus(id, false)).rejects.toThrow(ForbiddenException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockSessionService.closeAllSessions).not.toHaveBeenCalled();
        });

        it('should successfully deactivate admin and clear sessions if active is false', async () => {
            const admin = { id, role: AuthUserRole.ADMIN, isActive: true },
                active = false;

            mockRepository.findById.mockResolvedValueOnce(admin);
            mockRepository.update.mockResolvedValueOnce({ ...admin, isActive: active });

            await expect(service.updateStatus(id, active)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockSessionService.closeAllSessions).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockSessionService.ban).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockSessionService.unban).not.toHaveBeenCalled();
            expect(mockRepository.update).toHaveBeenCalledWith(id, { isActive: active });
        });

        it('should successfully activate admin and NOT clear sessions but unban admin if active is true', async () => {
            const admin = { id, role: AuthUserRole.ADMIN, isActive: false },
                active = true;

            mockRepository.findById.mockResolvedValueOnce(admin);
            mockRepository.update.mockResolvedValueOnce({ ...admin, isActive: active });

            await expect(service.updateStatus(id, active)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockSessionService.closeAllSessions).not.toHaveBeenCalled();
            expect(mockSessionService.ban).not.toHaveBeenCalled();
            expect(mockSessionService.unban).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockRepository.update).toHaveBeenCalledWith(id, { isActive: true });
        });
    });
});
