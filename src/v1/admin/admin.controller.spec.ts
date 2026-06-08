import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PostAdminDto } from './dto/post-admin.dto';
import { GetCreatedAdminDto } from './dto/get-created-admin.dto';
import { GetAdminDto } from './dto/get-admin.dto';
import { PatchAdminStatusDto } from './dto/patch-admin-status.dto';
import { ParamIdDto } from 'src/common/dto/param-id.dto';
import { Admin } from './type/admin.type';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';

describe('AdminController', () => {
    let controller: AdminController;

    const mockAdminService: Record<keyof AdminService, Mock> = {
        create: vi.fn(),
        findAll: vi.fn(),
        updateStatus: vi.fn(),
        delete: vi.fn(),
    };

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
            password: 'AdminPassword123!',
        };

        it('should create an admin and return the mapped GetCreatedAdminDto', async () => {
            mockAdminService.create.mockResolvedValueOnce({
                id: '00000000-0000-0000-0000-000000000001',
                role: AuthUserRole.ADMIN,
                ...postAdminDto,
            });

            const result = await controller.createAdmin(postAdminDto);

            expect(result).toBeInstanceOf(GetCreatedAdminDto);
            expect(result).toEqual({
                id: '00000000-0000-0000-0000-000000000001',
                email: postAdminDto.email,
                name: postAdminDto.name,
                role: AuthUserRole.ADMIN,
            } satisfies GetCreatedAdminDto);
            expect(mockAdminService.create).toHaveBeenCalledWith(postAdminDto);
        });

        it('should propagate service error', async () => {
            mockAdminService.create.mockRejectedValueOnce(new Error());

            await expect(controller.createAdmin(postAdminDto)).rejects.toThrow(Error);
            expect(mockAdminService.create).toHaveBeenCalledWith(postAdminDto);
        });
    });

    describe('findAll', () => {
        it('should return all admins mapped to GetAdminDto', async () => {
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
            ];

            mockAdminService.findAll.mockResolvedValueOnce(admins);

            const result = await controller.findAll();

            expect(result).toBeInstanceOf(Array);
            expect(result).toHaveLength(2);
            expect(result[0]).toBeInstanceOf(GetAdminDto);
            expect(result[1]).toBeInstanceOf(GetAdminDto);
            expect(result).toEqual(
                admins.map((admin) => {
                    return {
                        id: admin.id!,
                        email: admin.email!,
                        name: admin.name!,
                        role: admin.role!,
                    };
                }) satisfies GetAdminDto[],
            );
            expect(mockAdminService.findAll).toHaveBeenCalledTimes(1);
        });

        it('should propagate service error', async () => {
            mockAdminService.findAll.mockRejectedValueOnce(new Error());

            await expect(controller.findAll()).rejects.toThrow(Error);
            expect(mockAdminService.findAll).toHaveBeenCalledTimes(1);
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
