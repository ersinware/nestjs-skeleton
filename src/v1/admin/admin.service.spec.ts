import { ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { AuthService } from 'src/v1/auth/auth.service';
import { AdminService } from './admin.service';
import { TOKEN_ADMINS_REPOSITORY } from './constant/admin.constant';
import type { IAdminsRepository } from './interface/admins.repository.interface';
import { PostAdminDto } from './dto/post-admin.dto';

import { HashingService } from 'src/common/hashing/service/hashing.service';

describe('AdminService', () => {
    const mockRepository: Record<keyof IAdminsRepository, Mock> = {
            create: vi.fn(),
            findAll: vi.fn(),
            findById: vi.fn(),
            findByEmail: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
        mockAuthService = {
            logoutAll: vi.fn(),
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
                    provide: AuthService,
                    useValue: mockAuthService,
                },
                {
                    provide: HashingService,
                    useValue: mockHashingService,
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
                password: 'AdminPassword123',
            },
            hashedPassword = `hashed_${postAdminDto.password}`;

        it('should throw ConflictException if email is already in use', async () => {
            mockRepository.findByEmail.mockResolvedValueOnce({ id: '018f43c3-6bb3-7d72-911e-848821a837c3' });

            await expect(service.create(postAdminDto)).rejects.toThrow(ConflictException);
            expect(mockRepository.findByEmail).toHaveBeenCalledWith(postAdminDto.email);
            expect(mockHashingService.hash).not.toHaveBeenCalled();
        });

        it('should throw InternalServerErrorException if admin creation fails', async () => {
            mockRepository.findByEmail.mockResolvedValueOnce(null);
            mockRepository.create.mockResolvedValueOnce(null);

            await expect(service.create(postAdminDto)).rejects.toThrow(InternalServerErrorException);
            expect(mockRepository.findByEmail).toHaveBeenCalledWith(postAdminDto.email);
            expect(mockHashingService.hash).toHaveBeenCalledWith(postAdminDto.password);
            expect(mockRepository.create).toHaveBeenCalledWith({
                ...postAdminDto,
                password: hashedPassword,
                role: AuthUserRole.ADMIN,
            });
        });

        it('should successfully hash password and create an admin', async () => {
            const newAdmin = {
                password: hashedPassword,
            };

            mockRepository.findByEmail.mockResolvedValueOnce(null);
            mockRepository.create.mockResolvedValueOnce(newAdmin);

            await expect(service.create(postAdminDto)).resolves.toEqual(newAdmin);
            expect(mockRepository.findByEmail).toHaveBeenCalledWith(postAdminDto.email);
            expect(mockHashingService.hash).toHaveBeenCalledWith(postAdminDto.password);
            expect(mockRepository.create).toHaveBeenCalledWith({
                ...postAdminDto,
                password: hashedPassword,
                role: AuthUserRole.ADMIN,
            });
        });
    });

    describe('findAll', () => {
        it('should return all admins', async () => {
            const admins = [
                {
                    id: '018f43c3-6bb3-7d72-911e-848821a837c3',
                },
            ];

            mockRepository.findAll.mockResolvedValueOnce(admins);

            await expect(service.findAll()).resolves.toEqual(admins);
            expect(mockRepository.findAll).toHaveBeenCalledTimes(1);
        });
    });

    describe('delete', () => {
        const id = '018f43c3-6bb3-7d72-911e-848821a837c4';

        it('should throw NotFoundException if admin to delete is not found', async () => {
            mockRepository.findById.mockResolvedValueOnce(null);

            await expect(service.delete(id)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
        });

        it('should throw ForbiddenException if trying to delete a super admin', async () => {
            const admin = { id, role: AuthUserRole.SUPER_ADMIN };

            mockRepository.findById.mockResolvedValueOnce(admin);

            await expect(service.delete(id)).rejects.toThrow(ForbiddenException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
        });

        it('should throw InternalServerErrorException if delete operation fails', async () => {
            const admin = { id, role: AuthUserRole.ADMIN };

            mockRepository.findById.mockResolvedValueOnce(admin);
            mockRepository.delete.mockResolvedValueOnce(false);

            await expect(service.delete(id)).rejects.toThrow(InternalServerErrorException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockAuthService.ban).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockRepository.delete).toHaveBeenCalledWith(id);
        });

        it('should successfully delete admin and clear sessions if found', async () => {
            const admin = { id, role: AuthUserRole.ADMIN };
            mockRepository.findById.mockResolvedValueOnce(admin);
            mockRepository.delete.mockResolvedValueOnce(true);

            await expect(service.delete(id)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockAuthService.ban).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockRepository.delete).toHaveBeenCalledWith(id);
        });
    });

    describe('updateStatus', () => {
        const id = '018f43c3-6bb3-7d72-911e-848821a837c4';

        it('should throw NotFoundException if admin to update status is not found', async () => {
            mockRepository.findById.mockResolvedValueOnce(null);

            await expect(service.updateStatus(id, false)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
        });

        it('should throw ForbiddenException if trying to deactivate a super admin', async () => {
            const admin = { id, role: AuthUserRole.SUPER_ADMIN, isActive: true };

            mockRepository.findById.mockResolvedValueOnce(admin);

            await expect(service.updateStatus(id, false)).rejects.toThrow(ForbiddenException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
        });

        it('should successfully deactivate admin and clear sessions if active is false', async () => {
            const admin = { id, role: AuthUserRole.ADMIN, isActive: true },
                active = false;

            mockRepository.findById.mockResolvedValueOnce(admin);
            mockRepository.update.mockResolvedValueOnce({ ...admin, isActive: active });

            await expect(service.updateStatus(id, active)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockAuthService.ban).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockAuthService.unban).not.toHaveBeenCalled();
            expect(mockRepository.update).toHaveBeenCalledWith(id, { isActive: active });
        });

        it('should successfully activate admin and NOT clear sessions but unban admin if active is true', async () => {
            const admin = { id, role: AuthUserRole.ADMIN, isActive: false },
                active = true;

            mockRepository.findById.mockResolvedValueOnce(admin);
            mockRepository.update.mockResolvedValueOnce({ ...admin, isActive: active });

            await expect(service.updateStatus(id, active)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
            expect(mockAuthService.ban).not.toHaveBeenCalled();
            expect(mockAuthService.unban).toHaveBeenCalledWith(AuthUserRole.ADMIN, id);
            expect(mockRepository.update).toHaveBeenCalledWith(id, { isActive: true });
        });
    });
});
