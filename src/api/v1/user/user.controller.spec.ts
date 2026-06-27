/**
 * @file user.controller.spec.ts
 * @description Unit tests for the UserController. Validates request routing, DTO serialization, and ensures standard error propagation from the service layer.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ParamIdDto } from 'src/common/validation/dto/param-id.dto';
import { AuthTokenType } from 'src/common/auth/enum/auth-token-type.enum';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import type { AccessTokenPayload } from 'src/common/auth/interface/access-token-payload.interface';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponsePaginationDto } from 'src/common/pagination/dto/response-pagination.dto';
import { ResponseUserDto } from './dto/response-user.dto';
import { PatchUserPasswordDto } from './dto/patch-user-password.dto';
import { PatchUserStatusDto } from './dto/patch-user-status.dto';
import { PatchUserDto } from './dto/patch-user.dto';
import { PostUserDto } from './dto/post-user.dto';
import { User } from './type/user.type';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { QuerySearchDto } from 'src/common/search/dto/query-search.dto';

describe('UserController', () => {
    let controller: UserController;

    const mockUserService = {
            create: vi.fn(),
            findAll: vi.fn(),
            findById: vi.fn(),
            findByEmail: vi.fn(),
            update: vi.fn(),
            changePassword: vi.fn(),
            delete: vi.fn(),
            updateStatus: vi.fn(),
        } satisfies Record<keyof UserService, unknown>,
        mockPayload: AccessTokenPayload = {
            sub: '00000000-0000-0000-0000-000000000001',
            role: AuthUserRole.USER,
            type: AuthTokenType.ACCESS,
        };

    beforeEach(async () => {
        const app: TestingModule = await Test.createTestingModule({
            controllers: [UserController],
            providers: [
                {
                    provide: UserService,
                    useValue: mockUserService,
                },
            ],
        }).compile();

        controller = app.get<UserController>(UserController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('create', () => {
        const postUserDto: PostUserDto = {
            email: 'test@example.com',
            name: 'John Doe',
            password: 'Password123!',
        };

        it('should create a user and return the mapped ResponseUserDto', async () => {
            mockUserService.create.mockResolvedValueOnce({
                id: '00000000-0000-0000-0000-000000000001',
                ...postUserDto,
            });

            const result = await controller.create(postUserDto);

            expect(result).toBeInstanceOf(ResponseUserDto);
            expect(result).toEqual({
                id: '00000000-0000-0000-0000-000000000001',
                email: postUserDto.email,
                name: postUserDto.name,
            } satisfies ResponseUserDto);
            expect(mockUserService.create).toHaveBeenCalledWith(postUserDto);
        });

        it('should propagate service error', async () => {
            mockUserService.create.mockRejectedValueOnce(new Error());

            await expect(controller.create(postUserDto)).rejects.toThrow(Error);
            expect(mockUserService.create).toHaveBeenCalledWith(postUserDto);
        });
    });

    describe('findAll', () => {
        it('should return paginated users mapped to ResponseUserDto', async () => {
            const users: Partial<User>[] = [
                    { id: '00000000-0000-0000-0000-000000000001', email: 'test1@example.com', name: 'User One' },
                    { id: '00000000-0000-0000-0000-000000000002', email: 'test2@example.com', name: 'User Two' },
                ],
                query: QuerySearchDto = { page: 1, limit: 20, search: 'User' },
                total = 2;

            mockUserService.findAll.mockResolvedValueOnce({ data: users, total });

            const result = await controller.findAll(query);

            expect(result).toBeInstanceOf(ResponsePaginationDto);
            expect(result.total).toBe(total);
            expect(result.page).toBe(query.page);
            expect(result.limit).toBe(query.limit);
            expect(result.totalPages).toBe(Math.ceil(total / query.limit));
            expect(result.items).toHaveLength(users.length);
            expect(result.items[0]).toBeInstanceOf(ResponseUserDto);
            expect(result.items[1]).toBeInstanceOf(ResponseUserDto);
            expect(result.items).toEqual(
                users.map((user) => {
                    return { id: user.id!, email: user.email!, name: user.name! };
                }) satisfies ResponseUserDto[],
            );
            expect(mockUserService.findAll).toHaveBeenCalledWith(query);
        });

        it('should propagate service error', async () => {
            const query: QuerySearchDto = { page: 1, limit: 10, search: 'Err' };
            mockUserService.findAll.mockRejectedValueOnce(new Error());

            await expect(controller.findAll(query)).rejects.toThrow(Error);
            expect(mockUserService.findAll).toHaveBeenCalledWith(query);
        });
    });

    describe('findMe', () => {
        it('should return the current user mapped to ResponseUserDto', async () => {
            const user: Partial<User> = {
                id: mockPayload.sub,
                email: 'test@example.com',
                name: 'John Doe',
            };

            mockUserService.findById.mockResolvedValueOnce(user);

            const result = await controller.findMe(mockPayload);

            expect(result).toBeInstanceOf(ResponseUserDto);
            expect(result).toEqual({
                id: user.id!,
                email: user.email!,
                name: user.name!,
            } satisfies ResponseUserDto);
            expect(mockUserService.findById).toHaveBeenCalledWith(mockPayload.sub);
        });

        it('should propagate service error', async () => {
            mockUserService.findById.mockRejectedValueOnce(new Error());

            await expect(controller.findMe(mockPayload)).rejects.toThrow(Error);
            expect(mockUserService.findById).toHaveBeenCalledWith(mockPayload.sub);
        });
    });

    describe('findById', () => {
        const paramIdTo: ParamIdDto = { id: '00000000-0000-0000-0000-000000000002' };

        it('should return the user mapped to ResponseUserDto', async () => {
            const user: Partial<User> = {
                id: paramIdTo.id,
                email: 'test@example.com',
                name: 'John Doe',
            };

            mockUserService.findById.mockResolvedValueOnce(user);

            const result = await controller.findById(paramIdTo);

            expect(result).toBeInstanceOf(ResponseUserDto);
            expect(result).toEqual({
                id: user.id!,
                email: user.email!,
                name: user.name!,
            } satisfies ResponseUserDto);
            expect(mockUserService.findById).toHaveBeenCalledWith(paramIdTo.id);
        });

        it('should propagate service error', async () => {
            mockUserService.findById.mockRejectedValueOnce(new Error());

            await expect(controller.findById(paramIdTo)).rejects.toThrow(Error);
            expect(mockUserService.findById).toHaveBeenCalledWith(paramIdTo.id);
        });
    });

    describe('updateMe', () => {
        const patchUserDto: PatchUserDto = { name: 'Updated Name' };

        it('should update current user and return mapped ResponseUserDto', async () => {
            const updatedUser: Partial<User> = {
                id: mockPayload.sub,
                email: 'test@example.com',
                name: patchUserDto.name!,
            };

            mockUserService.update.mockResolvedValueOnce(updatedUser);

            const result = await controller.updateMe(mockPayload, patchUserDto);

            expect(result).toBeInstanceOf(ResponseUserDto);
            expect(result).toEqual({
                id: updatedUser.id!,
                email: updatedUser.email!,
                name: updatedUser.name!,
            } satisfies ResponseUserDto);
            expect(mockUserService.update).toHaveBeenCalledWith(mockPayload.sub, patchUserDto);
        });

        it('should propagate service error', async () => {
            mockUserService.update.mockRejectedValueOnce(new Error());

            await expect(controller.updateMe(mockPayload, patchUserDto)).rejects.toThrow(Error);
            expect(mockUserService.update).toHaveBeenCalledWith(mockPayload.sub, patchUserDto);
        });
    });

    describe('changePasswordMe', () => {
        const patchUserPasswordDto: PatchUserPasswordDto = {
            currentPassword: 'Password123!',
            newPassword: 'NewPassword123!',
        };

        it('should successfully change current user password', async () => {
            mockUserService.changePassword.mockResolvedValueOnce(undefined);

            await expect(controller.changePasswordMe(mockPayload, patchUserPasswordDto)).resolves.toBeUndefined();
            expect(mockUserService.changePassword).toHaveBeenCalledWith(mockPayload.sub, patchUserPasswordDto);
        });

        it('should propagate service error', async () => {
            mockUserService.changePassword.mockRejectedValueOnce(new Error());

            await expect(controller.changePasswordMe(mockPayload, patchUserPasswordDto)).rejects.toThrow(Error);
            expect(mockUserService.changePassword).toHaveBeenCalledWith(mockPayload.sub, patchUserPasswordDto);
        });
    });

    describe('deleteMe', () => {
        it('should successfully delete current user account', async () => {
            mockUserService.delete.mockResolvedValueOnce(undefined);

            await expect(controller.deleteMe(mockPayload)).resolves.toBeUndefined();
            expect(mockUserService.delete).toHaveBeenCalledWith(mockPayload.sub);
        });

        it('should propagate service error', async () => {
            mockUserService.delete.mockRejectedValueOnce(new Error());

            await expect(controller.deleteMe(mockPayload)).rejects.toThrow(Error);
            expect(mockUserService.delete).toHaveBeenCalledWith(mockPayload.sub);
        });
    });

    describe('updateStatus', () => {
        const paramIdDto: ParamIdDto = { id: '00000000-0000-0000-0000-000000000002' },
            patchUserStatusDto: PatchUserStatusDto = { active: false };

        it('should successfully call updateStatus service method', async () => {
            mockUserService.updateStatus.mockResolvedValueOnce(undefined);

            await expect(controller.updateStatus(paramIdDto, patchUserStatusDto)).resolves.toBeUndefined();
            expect(mockUserService.updateStatus).toHaveBeenCalledWith(paramIdDto.id, patchUserStatusDto.active);
        });

        it('should propagate service error', async () => {
            mockUserService.updateStatus.mockRejectedValueOnce(new Error());

            await expect(controller.updateStatus(paramIdDto, patchUserStatusDto)).rejects.toThrow(Error);
            expect(mockUserService.updateStatus).toHaveBeenCalledWith(paramIdDto.id, patchUserStatusDto.active);
        });
    });
});
