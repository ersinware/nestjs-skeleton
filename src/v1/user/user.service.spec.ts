import {
    BadRequestException,
    ConflictException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TOKEN_CACHE_SERVICE } from 'src/cache/constant/cache.constant';
import type { ICacheService } from 'src/cache/interface/cache-service.interface';
import { CacheKeys } from 'src/cache/util/cache-key.util';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { HashingService } from 'src/common/hashing/service/hashing.service';
import { AuthService } from 'src/v1/auth/auth.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_USERS_REPOSITORY, USER_CACHE_TTL_SECONDS } from './constant/user.constant';
import { PatchUserPasswordDto } from './dto/patch-user-password.dto';
import { PatchUserDto } from './dto/patch-user.dto';
import { PostUserDto } from './dto/post-user.dto';
import { QueryUserSearchDto } from './dto/query-user-search.dto';
import type { IUsersRepository } from './interface/users.repository.interface';
import { UserService } from './user.service';

describe('UserService', () => {
    const mockRepository = {
            create: vi.fn(),
            findAll: vi.fn(),
            findById: vi.fn(),
            findByEmail: vi.fn(),
            findPasswordById: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        } satisfies IUsersRepository,
        mockAuthService = {
            logoutAll: vi.fn(),
            ban: vi.fn(),
            unban: vi.fn(),
        },
        mockHashingService = {
            hash: vi.fn((password: string) => Promise.resolve(`hashed_${password}`)),
            verify: vi.fn((hash: string, password: string) => Promise.resolve(hash === `hashed_${password}`)),
        },
        mockCacheService = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            deletePattern: vi.fn(),
            exists: vi.fn(),
        } satisfies ICacheService,
        userId = '018f43c3-6bb3-7d72-911e-848821a837c3';

    let service: UserService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserService,
                {
                    provide: TOKEN_USERS_REPOSITORY,
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
                {
                    provide: TOKEN_CACHE_SERVICE,
                    useValue: mockCacheService,
                },
            ],
        }).compile();

        service = module.get(UserService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        const postUserDto: PostUserDto = {
                email: 'test@example.com',
                name: 'John Doe',
                password: 'password123',
            },
            hashedPassword = `hashed_${postUserDto.password}`;

        it('should throw ConflictException if email is already in use', async () => {
            mockRepository.findByEmail.mockResolvedValueOnce({ id: '018f43c3-6bb3-7d72-911e-848821a837c3' });

            await expect(service.create(postUserDto)).rejects.toThrow(ConflictException);
            expect(mockRepository.findByEmail).toHaveBeenCalledWith(postUserDto.email);
            expect(mockHashingService.hash).not.toHaveBeenCalled();
        });

        it('should throw InternalServerErrorException if user creation fails', async () => {
            mockRepository.findByEmail.mockResolvedValueOnce(null);
            mockRepository.create.mockResolvedValueOnce(null);

            await expect(service.create(postUserDto)).rejects.toThrow(InternalServerErrorException);
            expect(mockRepository.findByEmail).toHaveBeenCalledWith(postUserDto.email);
            expect(mockHashingService.hash).toHaveBeenCalledWith(postUserDto.password);
            expect(mockRepository.create).toHaveBeenCalledWith({
                ...postUserDto,
                password: hashedPassword,
            });
        });

        it('should successfully hash password and create a user', async () => {
            const newUser = {
                password: hashedPassword,
            };
            mockRepository.findByEmail.mockResolvedValueOnce(null);
            mockRepository.create.mockResolvedValueOnce(newUser);

            await expect(service.create(postUserDto)).resolves.toEqual(newUser);
            expect(mockRepository.findByEmail).toHaveBeenCalledWith(postUserDto.email);
            expect(mockHashingService.hash).toHaveBeenCalledWith(postUserDto.password);
            expect(mockRepository.create).toHaveBeenCalledWith({
                ...postUserDto,
                password: hashedPassword,
            });
        });
    });

    describe('findAll', () => {
        it('should return cached value if present in cache', async () => {
            const query: QueryUserSearchDto = { page: 1, limit: 20, search: 'John' },
                cachedResult = { data: [{ id: userId }], total: 1 },
                cacheKey = CacheKeys.userList(query);

            mockCacheService.get.mockResolvedValueOnce(cachedResult);

            await expect(service.findAll(query)).resolves.toEqual(cachedResult);
            expect(mockCacheService.get).toHaveBeenCalledWith(cacheKey);
            expect(mockRepository.findAll).not.toHaveBeenCalled();
        });

        it('should query repository and populate cache on cache miss', async () => {
            const query: QueryUserSearchDto = { page: 1, limit: 20, search: 'John' },
                result = { data: [{ id: userId }], total: 1 },
                cacheKey = CacheKeys.userList(query);

            mockCacheService.get.mockResolvedValueOnce(null);
            mockRepository.findAll.mockResolvedValueOnce(result);

            await expect(service.findAll(query)).resolves.toEqual(result);
            expect(mockCacheService.get).toHaveBeenCalledWith(cacheKey);
            expect(mockRepository.findAll).toHaveBeenCalledWith(query);
            expect(mockCacheService.set).toHaveBeenCalledWith(cacheKey, result, USER_CACHE_TTL_SECONDS, {
                useJitter: true,
            });
        });
    });

    describe('findById', () => {
        it('should return cached user if found', async () => {
            const cachedUser = { id: userId },
                cacheKey = CacheKeys.userById(userId);

            mockCacheService.get.mockResolvedValueOnce(cachedUser);

            await expect(service.findById(userId)).resolves.toEqual(cachedUser);
            expect(mockCacheService.get).toHaveBeenCalledWith(cacheKey);
            expect(mockRepository.findById).not.toHaveBeenCalled();
        });

        it('should throw NotFoundException if user is not found in repository on cache miss', async () => {
            const cacheKey = CacheKeys.userById(userId);

            mockCacheService.get.mockResolvedValueOnce(null);
            mockRepository.findById.mockResolvedValueOnce(null);

            await expect(service.findById(userId)).rejects.toThrow(NotFoundException);
            expect(mockCacheService.get).toHaveBeenCalledWith(cacheKey);
            expect(mockRepository.findById).toHaveBeenCalledWith(userId);
        });

        it('should query repository and cache user if found on cache miss', async () => {
            const user = { id: userId },
                cacheKey = CacheKeys.userById(userId);

            mockCacheService.get.mockResolvedValueOnce(null);
            mockRepository.findById.mockResolvedValueOnce(user);

            await expect(service.findById(userId)).resolves.toEqual(user);
            expect(mockCacheService.get).toHaveBeenCalledWith(cacheKey);
            expect(mockRepository.findById).toHaveBeenCalledWith(userId);
            expect(mockCacheService.set).toHaveBeenCalledWith(cacheKey, user, USER_CACHE_TTL_SECONDS, {
                useJitter: true,
            });
        });
    });

    describe('update', () => {
        const patchUserDto: PatchUserDto = { name: 'Updated Name' };

        it('should throw NotFoundException if user to update is not found', async () => {
            mockRepository.update.mockResolvedValueOnce(null);

            await expect(service.update(userId, patchUserDto)).rejects.toThrow(NotFoundException);
            expect(mockRepository.update).toHaveBeenCalledWith(userId, patchUserDto);
            expect(mockCacheService.delete).not.toHaveBeenCalled();
        });

        it('should successfully update and invalidate cache if found', async () => {
            const updatedUser = { id: userId };

            mockRepository.update.mockResolvedValueOnce(updatedUser);

            await expect(service.update(userId, patchUserDto)).resolves.toEqual(updatedUser);
            expect(mockRepository.update).toHaveBeenCalledWith(userId, patchUserDto);
            expect(mockCacheService.delete).toHaveBeenCalledWith(CacheKeys.userById(userId));
            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userListPattern());
        });
    });

    describe('changePassword', () => {
        const patchUserPasswordDto: PatchUserPasswordDto = {
                currentPassword: 'password123',
                newPassword: 'newPassword123',
            },
            hashedCurrentPassword = `hashed_${patchUserPasswordDto.currentPassword}`,
            hashedNewPassword = `hashed_${patchUserPasswordDto.newPassword}`;

        it('should throw NotFoundException if user password record is not found', async () => {
            mockRepository.findPasswordById.mockResolvedValueOnce(null);

            await expect(service.changePassword(userId, patchUserPasswordDto)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findPasswordById).toHaveBeenCalledWith(userId);
            expect(mockHashingService.verify).not.toHaveBeenCalled();
        });

        it('should throw BadRequestException if current password verification fails', async () => {
            mockRepository.findPasswordById.mockResolvedValueOnce(hashedCurrentPassword);

            await expect(
                service.changePassword(userId, {
                    currentPassword: 'wrongPassword',
                    newPassword: patchUserPasswordDto.newPassword,
                } satisfies PatchUserPasswordDto),
            ).rejects.toThrow(BadRequestException);
            expect(mockRepository.findPasswordById).toHaveBeenCalledWith(userId);
            expect(mockHashingService.verify).toHaveBeenCalledWith(hashedCurrentPassword, 'wrongPassword');
            expect(mockHashingService.verify).toHaveBeenCalledTimes(1);
        });

        it('should throw BadRequestException if new password is the same as current password', async () => {
            mockRepository.findPasswordById.mockResolvedValueOnce(hashedCurrentPassword);

            await expect(
                service.changePassword(userId, {
                    currentPassword: patchUserPasswordDto.currentPassword,
                    newPassword: patchUserPasswordDto.currentPassword,
                } satisfies PatchUserPasswordDto),
            ).rejects.toThrow(BadRequestException);
            expect(mockRepository.findPasswordById).toHaveBeenCalledWith(userId);
            expect(mockHashingService.verify).toHaveBeenNthCalledWith(
                1,
                hashedCurrentPassword,
                patchUserPasswordDto.currentPassword,
            );
            expect(mockHashingService.verify).toHaveBeenNthCalledWith(
                2,
                hashedCurrentPassword,
                patchUserPasswordDto.currentPassword,
            );
            expect(mockHashingService.hash).not.toHaveBeenCalled();
        });

        it('should throw InternalServerErrorException if user update fails during password change', async () => {
            mockRepository.findPasswordById.mockResolvedValueOnce(hashedCurrentPassword);
            mockRepository.update.mockResolvedValueOnce(null);

            await expect(service.changePassword(userId, patchUserPasswordDto)).rejects.toThrow(
                InternalServerErrorException,
            );
            expect(mockRepository.findPasswordById).toHaveBeenCalledWith(userId);
            expect(mockHashingService.verify).toHaveBeenNthCalledWith(
                1,
                hashedCurrentPassword,
                patchUserPasswordDto.currentPassword,
            );
            expect(mockHashingService.verify).toHaveBeenNthCalledWith(
                2,
                hashedCurrentPassword,
                patchUserPasswordDto.newPassword,
            );
            expect(mockHashingService.hash).toHaveBeenCalledWith(patchUserPasswordDto.newPassword);
            expect(mockRepository.update).toHaveBeenCalledWith(userId, {
                password: hashedNewPassword,
            });
        });

        it('should successfully change password when current password is valid and delete cache', async () => {
            mockRepository.findPasswordById.mockResolvedValueOnce(hashedCurrentPassword);
            mockRepository.update.mockResolvedValueOnce({ id: userId });

            await expect(service.changePassword(userId, patchUserPasswordDto)).resolves.toBeUndefined();
            expect(mockRepository.findPasswordById).toHaveBeenCalledWith(userId);
            expect(mockHashingService.verify).toHaveBeenNthCalledWith(
                1,
                hashedCurrentPassword,
                patchUserPasswordDto.currentPassword,
            );
            expect(mockHashingService.verify).toHaveBeenNthCalledWith(
                2,
                hashedCurrentPassword,
                patchUserPasswordDto.newPassword,
            );
            expect(mockHashingService.hash).toHaveBeenCalledWith(patchUserPasswordDto.newPassword);
            expect(mockRepository.update).toHaveBeenCalledWith(userId, {
                password: hashedNewPassword,
            });
            expect(mockCacheService.delete).toHaveBeenCalledWith(CacheKeys.userById(userId));
        });
    });

    describe('delete', () => {
        it('should throw NotFoundException if user to delete is not found', async () => {
            mockRepository.findById.mockResolvedValueOnce(null);

            await expect(service.delete(userId)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findById).toHaveBeenCalledWith(userId);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
        });

        it('should throw InternalServerErrorException if delete operation fails', async () => {
            mockRepository.findById.mockResolvedValueOnce({ id: userId });
            mockRepository.delete.mockResolvedValueOnce(false);

            await expect(service.delete(userId)).rejects.toThrow(InternalServerErrorException);
            expect(mockRepository.findById).toHaveBeenCalledWith(userId);
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(AuthUserRole.USER, userId);
            expect(mockAuthService.ban).toHaveBeenCalledWith(AuthUserRole.USER, userId);
            expect(mockRepository.delete).toHaveBeenCalledWith(userId);
            expect(mockCacheService.delete).not.toHaveBeenCalled();
        });

        it('should successfully delete user, clear sessions and invalidate cache if found', async () => {
            mockRepository.findById.mockResolvedValueOnce({ id: userId });
            mockRepository.delete.mockResolvedValueOnce(true);

            await expect(service.delete(userId)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(userId);
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(AuthUserRole.USER, userId);
            expect(mockAuthService.ban).toHaveBeenCalledWith(AuthUserRole.USER, userId);
            expect(mockRepository.delete).toHaveBeenCalledWith(userId);
            expect(mockCacheService.delete).toHaveBeenCalledWith(CacheKeys.userById(userId));
            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userListPattern());
        });
    });

    describe('updateStatus', () => {
        it('should throw NotFoundException if user to update is not found', async () => {
            mockRepository.findById.mockResolvedValueOnce(null);

            await expect(service.updateStatus(userId, false)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findById).toHaveBeenCalledWith(userId);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
        });

        it('should successfully deactivate user, clear sessions and invalidate cache if active is false', async () => {
            const user = { id: userId, isActive: true },
                active = false;

            mockRepository.findById.mockResolvedValueOnce(user);
            mockRepository.update.mockResolvedValueOnce({ ...user, isActive: active });

            await expect(service.updateStatus(userId, active)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(userId);
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(AuthUserRole.USER, userId);
            expect(mockAuthService.ban).toHaveBeenCalledWith(AuthUserRole.USER, userId);
            expect(mockAuthService.unban).not.toHaveBeenCalled();
            expect(mockRepository.update).toHaveBeenCalledWith(userId, { isActive: active });
            expect(mockCacheService.delete).toHaveBeenCalledWith(CacheKeys.userById(userId));
            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userListPattern());
        });

        it('should successfully activate user, unban user, update status and invalidate cache if active is true', async () => {
            const user = { id: userId, isActive: false },
                active = true;

            mockRepository.findById.mockResolvedValueOnce(user);
            mockRepository.update.mockResolvedValueOnce({ ...user, isActive: active });

            await expect(service.updateStatus(userId, active)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(userId);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
            expect(mockAuthService.ban).not.toHaveBeenCalled();
            expect(mockAuthService.unban).toHaveBeenCalledWith(AuthUserRole.USER, userId);
            expect(mockRepository.update).toHaveBeenCalledWith(userId, { isActive: true });
            expect(mockCacheService.delete).toHaveBeenCalledWith(CacheKeys.userById(userId));
            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userListPattern());
        });
    });
});
