import {
    BadRequestException,
    ConflictException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_USERS_REPOSITORY } from './constant/user.constant';
import { PatchUserPasswordDto } from './dto/patch-user-password.dto';
import { PatchUserDto } from './dto/patch-user.dto';
import { PostUserDto } from './dto/post-user.dto';
import type { IUsersRepository } from './interface/users.repository.interface';
import { UserService } from './user.service';
import { AuthService } from 'src/v1/auth/auth.service';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { HashingService } from 'src/common/hashing/service/hashing.service';

describe('UserService', () => {
    const mockRepository: Record<keyof IUsersRepository, Mock> = {
            create: vi.fn(),
            findAll: vi.fn(),
            findById: vi.fn(),
            findByEmail: vi.fn(),
            findPasswordById: vi.fn(),
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
            verify: vi.fn((hash: string, password: string) => Promise.resolve(hash === `hashed_${password}`)),
        };

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
        it('should return all users', async () => {
            const users = [{ id: '018f43c3-6bb3-7d72-911e-848821a837c3' }];
            mockRepository.findAll.mockResolvedValueOnce(users);

            await expect(service.findAll()).resolves.toEqual(users);
            expect(mockRepository.findAll).toHaveBeenCalledTimes(1);
        });
    });

    describe('findById', () => {
        const id = '018f43c3-6bb3-7d72-911e-848821a837c3';

        it('should throw NotFoundException if user is not found', async () => {
            mockRepository.findById.mockResolvedValueOnce(null);

            await expect(service.findById(id)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
        });

        it('should return user if found', async () => {
            const user = { id };

            mockRepository.findById.mockResolvedValueOnce(user);

            await expect(service.findById(id)).resolves.toEqual(user);
            expect(mockRepository.findById).toHaveBeenCalledWith(user.id);
        });
    });

    describe('update', () => {
        const id = '018f43c3-6bb3-7d72-911e-848821a837c3',
            patchUserDto: PatchUserDto = { name: 'Updated Name' };

        it('should throw NotFoundException if user to update is not found', async () => {
            mockRepository.update.mockResolvedValueOnce(null);

            await expect(service.update(id, patchUserDto)).rejects.toThrow(NotFoundException);
            expect(mockRepository.update).toHaveBeenCalledWith(id, patchUserDto);
        });

        it('should successfully update and return user if found', async () => {
            const updatedUser = { id };

            mockRepository.update.mockResolvedValueOnce(updatedUser);

            await expect(service.update(id, patchUserDto)).resolves.toEqual(updatedUser);
            expect(mockRepository.update).toHaveBeenCalledWith(id, patchUserDto);
        });
    });

    describe('changePassword', () => {
        const id = '018f43c3-6bb3-7d72-911e-848821a837c3',
            patchUserPasswordDto: PatchUserPasswordDto = {
                currentPassword: 'password123',
                newPassword: 'newPassword123',
            },
            hashedCurrentPassword = `hashed_${patchUserPasswordDto.currentPassword}`,
            hashedNewPassword = `hashed_${patchUserPasswordDto.newPassword}`;

        it('should throw NotFoundException if user password record is not found', async () => {
            mockRepository.findPasswordById.mockResolvedValueOnce(null);

            await expect(service.changePassword(id, patchUserPasswordDto)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findPasswordById).toHaveBeenCalledWith(id);
            expect(mockHashingService.verify).not.toHaveBeenCalled();
        });

        it('should throw BadRequestException if current password verification fails', async () => {
            mockRepository.findPasswordById.mockResolvedValueOnce(hashedCurrentPassword);

            await expect(
                service.changePassword(id, {
                    currentPassword: 'wrongPassword',
                    newPassword: patchUserPasswordDto.newPassword,
                } satisfies PatchUserPasswordDto),
            ).rejects.toThrow(BadRequestException);
            expect(mockRepository.findPasswordById).toHaveBeenCalledWith(id);
            expect(mockHashingService.verify).toHaveBeenCalledWith(hashedCurrentPassword, 'wrongPassword');
            expect(mockHashingService.verify).toHaveBeenCalledTimes(1);
        });

        it('should throw BadRequestException if new password is the same as current password', async () => {
            mockRepository.findPasswordById.mockResolvedValueOnce(hashedCurrentPassword);

            await expect(
                service.changePassword(id, {
                    currentPassword: patchUserPasswordDto.currentPassword,
                    newPassword: patchUserPasswordDto.currentPassword,
                } satisfies PatchUserPasswordDto),
            ).rejects.toThrow(BadRequestException);
            expect(mockRepository.findPasswordById).toHaveBeenCalledWith(id);
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

            await expect(service.changePassword(id, patchUserPasswordDto)).rejects.toThrow(
                InternalServerErrorException,
            );
            expect(mockRepository.findPasswordById).toHaveBeenCalledWith(id);
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
            expect(mockRepository.update).toHaveBeenCalledWith(id, {
                password: hashedNewPassword,
            });
        });

        it('should successfully change password when current password is valid', async () => {
            mockRepository.findPasswordById.mockResolvedValueOnce(hashedCurrentPassword);
            mockRepository.update.mockResolvedValueOnce({ id });

            await expect(service.changePassword(id, patchUserPasswordDto)).resolves.toBeUndefined();
            expect(mockRepository.findPasswordById).toHaveBeenCalledWith(id);
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
            expect(mockRepository.update).toHaveBeenCalledWith(id, {
                password: hashedNewPassword,
            });
        });
    });

    describe('delete', () => {
        const id = '018f43c3-6bb3-7d72-911e-848821a837c3';

        it('should throw NotFoundException if user to delete is not found', async () => {
            mockRepository.findById.mockResolvedValueOnce(null);

            await expect(service.delete(id)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
        });

        it('should throw InternalServerErrorException if delete operation fails', async () => {
            mockRepository.findById.mockResolvedValueOnce({ id });
            mockRepository.delete.mockResolvedValueOnce(false);

            await expect(service.delete(id)).rejects.toThrow(InternalServerErrorException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(AuthUserRole.USER, id);
            expect(mockAuthService.ban).toHaveBeenCalledWith(AuthUserRole.USER, id);
            expect(mockRepository.delete).toHaveBeenCalledWith(id);
        });

        it('should successfully delete user and clear sessions if found', async () => {
            mockRepository.findById.mockResolvedValueOnce({ id });
            mockRepository.delete.mockResolvedValueOnce(true);

            await expect(service.delete(id)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(AuthUserRole.USER, id);
            expect(mockAuthService.ban).toHaveBeenCalledWith(AuthUserRole.USER, id);
            expect(mockRepository.delete).toHaveBeenCalledWith(id);
        });
    });

    describe('updateStatus', () => {
        const id = '018f43c3-6bb3-7d72-911e-848821a837c3';

        it('should throw NotFoundException if user to update is not found', async () => {
            mockRepository.findById.mockResolvedValueOnce(null);

            await expect(service.updateStatus(id, false)).rejects.toThrow(NotFoundException);
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
        });

        it('should successfully deactivate user and clear sessions if active is false', async () => {
            const user = { id, isActive: true },
                active = false;

            mockRepository.findById.mockResolvedValueOnce(user);
            mockRepository.update.mockResolvedValueOnce({ ...user, isActive: active });

            await expect(service.updateStatus(id, active)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(AuthUserRole.USER, id);
            expect(mockAuthService.ban).toHaveBeenCalledWith(AuthUserRole.USER, id);
            expect(mockAuthService.unban).not.toHaveBeenCalled();
            expect(mockRepository.update).toHaveBeenCalledWith(id, { isActive: active });
        });

        it('should successfully activate user and NOT clear sessions but unban user if active is true', async () => {
            const user = { id, isActive: false },
                active = true;

            mockRepository.findById.mockResolvedValueOnce(user);
            mockRepository.update.mockResolvedValueOnce({ ...user, isActive: active });

            await expect(service.updateStatus(id, active)).resolves.toBeUndefined();
            expect(mockRepository.findById).toHaveBeenCalledWith(id);
            expect(mockAuthService.logoutAll).not.toHaveBeenCalled();
            expect(mockAuthService.ban).not.toHaveBeenCalled();
            expect(mockAuthService.unban).toHaveBeenCalledWith(AuthUserRole.USER, id);
            expect(mockRepository.update).toHaveBeenCalledWith(id, { isActive: true });
        });
    });
});
