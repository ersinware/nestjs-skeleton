/**
 * @file admin.service.ts
 * @description Domain service containing administrative business logic for admin creation, status toggling, and deletion.
 */

import {
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    forwardRef,
} from '@nestjs/common';
import { QueryPaginationDto } from 'src/common/dto/query-pagination.dto';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { ConflictType } from 'src/common/enum/error/conflict-type.enum';
import { ForbiddenType } from 'src/common/enum/error/forbidden-type.enum';
import { InternalServerErrorType } from 'src/common/enum/error/internal-server-error-type.enum';
import { NotFoundType } from 'src/common/enum/error/not-found-type.enum';
import { HashingService } from 'src/common/hashing/service/hashing.service';
import { AuthService } from 'src/v1/auth/auth.service';
import { TOKEN_ADMINS_REPOSITORY } from './constant/admin.constant';
import { PostAdminDto } from './dto/post-admin.dto';
import type { IAdminsRepository } from './interface/admins.repository.interface';

/**
 * Service orchestrating admin account management, permissions enforcement, and session termination.
 */
@Injectable()
export class AdminService {
    /**
     * Creates an instance of AdminService.
     *
     * @param adminsRepository Admin persistence repository abstraction.
     * @param authService Authentication service dependency.
     * @param hashingService Hashing operations utility service.
     */
    constructor(
        @Inject(TOKEN_ADMINS_REPOSITORY) private readonly adminsRepository: IAdminsRepository,
        @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
        private readonly hashingService: HashingService,
    ) {}

    /**
     * Creates a new administrative account. Only accessible to Super Admins.
     *
     * @param dto New admin parameters.
     * @returns A promise resolving to the created admin entity.
     * @throws {ConflictException} if email is already in use by an active admin.
     * @throws {InternalServerErrorException} if admin creation fails.
     */
    async create(dto: PostAdminDto) {
        if (await this.adminsRepository.findByEmail(dto.email)) {
            throw new ConflictException(ConflictType.EMAIL_IN_USE);
        }

        const admin = await this.adminsRepository.create({
            email: dto.email,
            name: dto.name,
            password: await this.hashingService.hash(dto.password),
            role: AuthUserRole.ADMIN,
        });

        if (!admin) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }

        return admin;
    }

    /**
     * Retrieves all registered admin records with pagination.
     *
     * @param query The query pagination parameters.
     * @returns A promise resolving to an object containing active admins array and total count.
     */
    async findAll(query: QueryPaginationDto) {
        return this.adminsRepository.findAll(query);
    }

    /**
     * Soft deletes an admin account. Super admins cannot be deleted.
     *
     * @param id Admin identifier.
     * @throws {NotFoundException} if the admin is not found.
     * @throws {ForbiddenException} if trying to delete a super admin.
     * @throws {InternalServerErrorException} if the database deletion fails.
     */
    async delete(id: string) {
        const admin = await this.adminsRepository.findById(id);
        if (!admin) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        if (admin.role === AuthUserRole.SUPER_ADMIN) {
            throw new ForbiddenException(ForbiddenType.DEFAULT);
        }

        await this.authService.logoutAll(AuthUserRole.ADMIN, id);
        await this.authService.ban(AuthUserRole.ADMIN, id);

        if (!(await this.adminsRepository.delete(id))) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }
    }

    /**
     * Updates the active status of an admin.Super admins cannot be deactivated.
     *
     * @param id Admin identifier.
     * @param active The target active state.
     * @throws {NotFoundException} if the admin is not found.
     * @throws {ForbiddenException} if trying to deactivate a super admin.
     * @throws {InternalServerErrorException} if the database update fails.
     */
    async updateStatus(id: string, active: boolean) {
        const admin = await this.adminsRepository.findById(id);
        if (!admin) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        if (admin.role === AuthUserRole.SUPER_ADMIN) {
            throw new ForbiddenException(ForbiddenType.DEFAULT);
        }

        if (!active) {
            await this.authService.logoutAll(AuthUserRole.ADMIN, id);
            await this.authService.ban(AuthUserRole.ADMIN, id);
        } else {
            await this.authService.unban(AuthUserRole.ADMIN, id);
        }

        if (!(await this.adminsRepository.update(id, { isActive: active }))) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }
    }
}
