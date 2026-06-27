/**
 * @file admin.controller.spec.ts
 * @description Unit tests for the AdminController. Verifies that administrative endpoints correctly handle payloads, call the underlying service, and map the outputs to expected response DTOs.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { QueryPaginationDto } from 'src/common/pagination/dto/query-pagination.dto';
import { ResponsePaginationDto } from 'src/common/pagination/dto/response-pagination.dto';
import { PostAdminDto } from './dto/post-admin.dto';
import { ResponseCreatedAdminDto } from './dto/response-created-admin.dto';
import { ResponseAdminDto } from './dto/response-admin.dto';
import { PatchAdminStatusDto } from './dto/patch-admin-status.dto';
import { ParamIdDto } from 'src/common/validation/dto/param-id.dto';
import { Admin } from './type/admin.type';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';

describe('AdminController', () => {
    let controller: AdminController;

    const mockAdminService = {
        create: vi.fn(),
        findAll: vi.fn(),
        findById: vi.fn(),
        findByEmail: vi.fn(),
        updateStatus: vi.fn(),
        delete: vi.fn(),
    } satisfies Record<keyof AdminService, unknown>;

    beforeEach(async () => {
        const app: TestingModule = await Test.createTestingModule({
            controllers: [AdminController],
            providers: [
                {
                    provide: AdminService,
                    useValue: mockAdminService,
                },
            ],
        }).compile();

        controller = app.get<AdminController>(AdminController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('createAdmin', () => {
        const postAdminDto: PostAdminDto = {
            email: 'admin@example.com',
            name: 'Admin Name',
        };

        it('should create an admin and return the mapped ResponseCreatedAdminDto', async () => {
            mockAdminService.create.mockResolvedValueOnce({
                id: '00000000-0000-0000-0000-000000000001',
                role: AuthUserRole.ADMIN,
                ...postAdminDto,
            });

            const result = await controller.createAdmin(postAdminDto);

            expect(result).toBeInstanceOf(ResponseCreatedAdminDto);
            expect(result).toEqual({
                id: '00000000-0000-0000-0000-000000000001',
                email: postAdminDto.email,
                name: postAdminDto.name,
                role: AuthUserRole.ADMIN,
            } satisfies ResponseCreatedAdminDto);
            expect(mockAdminService.create).toHaveBeenCalledWith(postAdminDto);
        });

        it('should propagate service error', async () => {
            mockAdminService.create.mockRejectedValueOnce(new Error());

            await expect(controller.createAdmin(postAdminDto)).rejects.toThrow(Error);
            expect(mockAdminService.create).toHaveBeenCalledWith(postAdminDto);
        });
    });

    describe('findAll', () => {
        it('should return paginated admins mapped to ResponseAdminDto', async () => {
            const admins: Partial<Admin>[] = [
                    {
                        id: '00000000-0000-0000-0000-000000000001',
                        email: 'admin1@example.com',
                        name: 'Admin One',
                        role: AuthUserRole.ADMIN,
                    },
                    {
                        id: '00000000-0000-0000-0000-000000000002',
                        email: 'admin2@example.com',
                        name: 'Admin Two',
                        role: AuthUserRole.SUPER_ADMIN,
                    },
                ],
                query: QueryPaginationDto = { page: 1, limit: 20 },
                total = 2;

            mockAdminService.findAll.mockResolvedValueOnce({ data: admins, total });

            const result = await controller.findAll(query);

            expect(result).toBeInstanceOf(ResponsePaginationDto);
            expect(result.total).toBe(total);
            expect(result.page).toBe(query.page);
            expect(result.limit).toBe(query.limit);
            expect(result.totalPages).toBe(Math.ceil(total / query.limit));
            expect(result.items).toHaveLength(admins.length);
            expect(result.items[0]).toBeInstanceOf(ResponseAdminDto);
            expect(result.items[1]).toBeInstanceOf(ResponseAdminDto);
            expect(result.items).toEqual(
                admins.map((admin) => {
                    return {
                        id: admin.id!,
                        email: admin.email!,
                        name: admin.name!,
                        role: admin.role!,
                    };
                }) satisfies ResponseAdminDto[],
            );
            expect(mockAdminService.findAll).toHaveBeenCalledWith(query);
        });

        it('should propagate service error', async () => {
            const query: QueryPaginationDto = { page: 1, limit: 20 };

            mockAdminService.findAll.mockRejectedValueOnce(new Error());

            await expect(controller.findAll(query)).rejects.toThrow(Error);
            expect(mockAdminService.findAll).toHaveBeenCalledWith(query);
        });
    });

    describe('deleteAdmin', () => {
        const paramIdDto: ParamIdDto = { id: '00000000-0000-0000-0000-000000000002' };

        it('should successfully call delete service method', async () => {
            mockAdminService.delete.mockResolvedValueOnce(undefined);

            await expect(controller.deleteAdmin(paramIdDto)).resolves.toBeUndefined();
            expect(mockAdminService.delete).toHaveBeenCalledWith(paramIdDto.id);
        });

        it('should propagate service error', async () => {
            mockAdminService.delete.mockRejectedValueOnce(new Error());

            await expect(controller.deleteAdmin(paramIdDto)).rejects.toThrow(Error);
            expect(mockAdminService.delete).toHaveBeenCalledWith(paramIdDto.id);
        });
    });

    describe('updateStatus', () => {
        const paramIdDto: ParamIdDto = { id: '00000000-0000-0000-0000-000000000002' },
            patchAdminStatusDto: PatchAdminStatusDto = { active: false };

        it('should successfully call updateStatus service method', async () => {
            mockAdminService.updateStatus.mockResolvedValueOnce(undefined);

            await expect(controller.updateStatus(paramIdDto, patchAdminStatusDto)).resolves.toBeUndefined();
            expect(mockAdminService.updateStatus).toHaveBeenCalledWith(paramIdDto.id, patchAdminStatusDto.active);
        });

        it('should propagate service error', async () => {
            mockAdminService.updateStatus.mockRejectedValueOnce(new Error());

            await expect(controller.updateStatus(paramIdDto, patchAdminStatusDto)).rejects.toThrow(Error);
            expect(mockAdminService.updateStatus).toHaveBeenCalledWith(paramIdDto.id, patchAdminStatusDto.active);
        });
    });
});
