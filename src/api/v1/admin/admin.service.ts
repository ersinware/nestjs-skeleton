/**
 * @file admin.service.ts
 * @description Contains the core business logic for administrative operations, including account creation, status toggling, and deletion. It enforces domain rules (e.g., preventing super admins from being deleted) and orchestrates interactions across repositories and external services (like email).
 */

import {
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueryPaginationDto } from 'src/common/pagination/dto/query-pagination.dto';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { ConflictType } from 'src/common/exception/enum/conflict-type.enum';
import { ForbiddenType } from 'src/common/exception/enum/forbidden-type.enum';
import { InternalServerErrorType } from 'src/common/exception/enum/internal-server-error-type.enum';
import { NotFoundType } from 'src/common/exception/enum/not-found-type.enum';
import type { IHashingService } from 'src/common/port/security/hashing.service.interface';
import { TOKEN_HASHING_SERVICE } from 'src/common/port/security/hashing.constant';
import { generateSecurePassword } from 'src/common/util/password-generator.util';
import { TOKEN_SESSION_SERVICE } from 'src/common/port/security/session.constant';
import type { ISessionService } from 'src/common/port/security/session.service.interface';
import { TOKEN_ADMINS_REPOSITORY } from './constant/admin.constant';
import { PostAdminDto } from './dto/post-admin.dto';
import { AdminEvent } from './enum/admin-event.enum';
import { AdminCreatedEvent } from './event/admin-created.event';
import type { IAdminsRepository } from './interface/admins.repository.interface';
import type { Admin } from './type/admin.type';

/**
 * The service orchestrating admin account management, permissions enforcement, and session termination.
 * It handles all critical administrative workflows and acts as the bridge between the controller and the persistence layer.
 */
@Injectable()
export class AdminService {
    /**
     * Injects the required repositories and utility services.
     *
     * @param adminsRepository The persistence repository abstraction for admin entities
     * @param sessionService The service responsible for managing and revoking user sessions
     * @param hashingService The utility service used for securely hashing passwords
     * @param eventEmitter The event emitter to dispatch domain events
     */
    constructor(
        @Inject(TOKEN_ADMINS_REPOSITORY) private readonly adminsRepository: IAdminsRepository,
        @Inject(TOKEN_SESSION_SERVICE) private readonly sessionService: ISessionService,
        @Inject(TOKEN_HASHING_SERVICE) private readonly hashingService: IHashingService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    /**
     * Creates a new administrative account and generates a secure password.
     * Upon successful persistence, it delegates an email dispatch to notify the user of their credentials.
     *
     * @param dto The payload containing new admin parameters
     * @returns The newly created admin entity
     * @throws {ConflictException} If the provided email is already in use by an active admin
     * @throws {InternalServerErrorException} If admin creation fails at the database level or if the email dispatch fails
     */
    async create(dto: PostAdminDto): Promise<Admin> {
        if (await this.adminsRepository.findByEmail(dto.email)) {
            throw new ConflictException(ConflictType.EMAIL_IN_USE);
        }

        const generatedPassword = generateSecurePassword(),
            admin = await this.adminsRepository.create({
                email: dto.email,
                name: dto.name,
                password: await this.hashingService.hash(generatedPassword),
                role: AuthUserRole.ADMIN,
            });

        if (!admin) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }

        this.eventEmitter.emit(AdminEvent.CREATED, new AdminCreatedEvent(admin, generatedPassword));

        return admin;
    }

    /**
     * Retrieves all registered admin records utilizing pagination.
     * Connects directly to the repository layer to fetch bounded data sets.
     *
     * @param query The query parameters defining pagination limits and offsets
     * @returns An object containing the array of active admins and the total count
     */
    async findAll(query: QueryPaginationDto): Promise<{ data: Admin[]; total: number }> {
        return this.adminsRepository.findAll(query);
    }

    /**
     * Retrieves a specific admin by their registered email address.
     * Useful during authentication or when resolving user identities from external providers.
     *
     * @param email The exact email address to search for
     * @returns The matching admin entity
     * @throws {NotFoundException} If no admin is found associated with the provided email
     */
    async findByEmail(email: string): Promise<Admin> {
        const admin = await this.adminsRepository.findByEmail(email);

        if (!admin) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        return admin;
    }

    /**
     * Retrieves a specific admin by their unique identifier.
     *
     * @param id The unique identifier of the admin
     * @returns The matching admin entity
     * @throws {NotFoundException} If no admin is found associated with the provided ID
     */
    async findById(id: string): Promise<Admin> {
        const admin = await this.adminsRepository.findById(id);

        if (!admin) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        return admin;
    }

    /**
     * Soft deletes an admin account and immediately invalidates all their active sessions.
     * Built-in safeguards prevent the accidental deletion of super administrators.
     *
     * @param id The unique identifier of the admin to be deleted
     * @throws {NotFoundException} If the specified admin is not found in the system
     * @throws {ForbiddenException} If an attempt is made to delete a super administrator
     * @throws {InternalServerErrorException} If the database soft deletion fails unexpectedly
     */
    async delete(id: string) {
        const admin = await this.adminsRepository.findById(id);
        if (!admin) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        if (admin.role === AuthUserRole.SUPER_ADMIN) {
            throw new ForbiddenException(ForbiddenType.DEFAULT);
        }

        await this.sessionService.closeAllSessions(AuthUserRole.ADMIN, id);
        await this.sessionService.ban(AuthUserRole.ADMIN, id);

        if (!(await this.adminsRepository.delete(id))) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }
    }

    /**
     * Updates the active status of an admin account to govern their access.
     * If the account is deactivated, all associated sessions are immediately revoked to sever access. Super admins cannot be deactivated.
     *
     * @param id The unique identifier of the admin
     * @param active The target active boolean state to apply
     * @throws {NotFoundException} If the specified admin is not found in the system
     * @throws {ForbiddenException} If an attempt is made to deactivate a super administrator
     * @throws {InternalServerErrorException} If the database update fails unexpectedly
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
            await this.sessionService.closeAllSessions(AuthUserRole.ADMIN, id);
            await this.sessionService.ban(AuthUserRole.ADMIN, id);
        } else {
            await this.sessionService.unban(AuthUserRole.ADMIN, id);
        }

        if (!(await this.adminsRepository.update(id, { isActive: active }))) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }
    }
}
