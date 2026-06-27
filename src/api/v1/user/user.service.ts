/**
 * @file user.service.ts
 * @description Contains the core business logic for user management. Interacts with the persistence layer while enforcing caching rules, active session revocations, and secure credential hashing.
 */

import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictType } from 'src/common/exception/enum/conflict-type.enum';
import { InternalServerErrorType } from 'src/common/exception/enum/internal-server-error-type.enum';
import { NotFoundType } from 'src/common/exception/enum/not-found-type.enum';
import { TOKEN_CACHE_SERVICE } from 'src/common/port/cache/cache.constant';
import type { ICacheService } from 'src/common/port/cache/cache-service.interface';
import { CacheKeys } from 'src/common/port/cache/util/cache-key.util';
import type { IHashingService } from 'src/common/port/security/hashing.service.interface';
import { TOKEN_HASHING_SERVICE } from 'src/common/port/security/hashing.constant';
import { TOKEN_USERS_REPOSITORY, USER_CACHE_TTL_SECONDS } from './constant/user.constant';
import { PatchUserPasswordDto } from './dto/patch-user-password.dto';
import { PatchUserDto } from './dto/patch-user.dto';
import { PostUserDto } from './dto/post-user.dto';
import { QuerySearchDto } from 'src/common/search/dto/query-search.dto';
import { UserEvent } from './enum/user-event.enum';
import { UserCreatedEvent } from './event/user-created.event';
import { UserDeletedEvent } from './event/user-deleted.event';
import { UserStatusChangedEvent } from './event/user-status-changed.event';
import { UserUpdatedEvent } from './event/user-updated.event';
import type { IUsersRepository } from './interface/users.repository.interface';
import type { User } from './type/user.type';

type UserCachePayload = Omit<User, 'password'>;

/**
 * The service responsible for orchestrating user domain operations.
 * Abstracts the database interactions and ensures cache synchronization when user data is modified.
 */
@Injectable()
export class UserService {
    /**
     * Injects the required persistence, caching, and security dependencies.
     *
     * @param usersRepository The abstracted repository for database interactions
     * @param hashingService The utility service for securing passwords
     * @param cacheService The caching service to optimize read performance
     * @param eventEmitter The event emitter instance
     */
    constructor(
        @Inject(TOKEN_USERS_REPOSITORY) private readonly usersRepository: IUsersRepository,
        @Inject(TOKEN_HASHING_SERVICE) private readonly hashingService: IHashingService,
        @Inject(TOKEN_CACHE_SERVICE) private readonly cacheService: ICacheService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    /**
     * Creates a new user record in the database.
     * Ensures email uniqueness, securely hashes the plain-text password before storage, and invalidates list caches.
     *
     * @param dto The validated registration details
     * @returns The newly created user entity
     * @throws {ConflictException} If the email is already registered to another account
     * @throws {InternalServerErrorException} If the insertion operation fails unexpectedly
     */
    async create(dto: PostUserDto): Promise<User> {
        if (await this.usersRepository.findByEmail(dto.email)) {
            throw new ConflictException(ConflictType.EMAIL_IN_USE);
        }

        const user = await this.usersRepository.create({
            email: dto.email,
            name: dto.name,
            password: await this.hashingService.hash(dto.password),
        });

        if (!user) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }

        this.eventEmitter.emit(UserEvent.CREATED, new UserCreatedEvent());

        return user;
    }

    /**
     * Retrieves a paginated list of all users, optionally filtered by search terms.
     * Utilizes aggressive caching to optimize query performance for frequently requested pages.
     *
     * @param query The query payload containing pagination limits and search text
     * @returns An object containing the requested user items and the total count
     */
    async findAll(query: QuerySearchDto): Promise<{ data: User[]; total: number }> {
        const cacheKey = CacheKeys.userList(query),
            cached = await this.cacheService.get<{ data: UserCachePayload[]; total: number }>(cacheKey);

        if (cached) {
            return cached as { data: User[]; total: number };
        }

        const result = await this.usersRepository.findAll(query);

        await this.cacheService.set(
            cacheKey,
            { data: result.data.map((u) => this.sanitizeUserForCache(u)), total: result.total },
            USER_CACHE_TTL_SECONDS,
            { useJitter: true },
        );

        return result;
    }

    /**
     * Retrieves a specific user by their unique identifier.
     * Attempts to fetch from the cache first before querying the database to reduce load.
     *
     * @param id The unique identifier of the target user
     * @returns The user entity
     * @throws {NotFoundException} If the user does not exist
     */
    async findById(id: string): Promise<User> {
        const cacheKey = CacheKeys.userById(id),
            cachedUser = await this.cacheService.get<UserCachePayload>(cacheKey);

        if (cachedUser) {
            return cachedUser as User;
        }

        const user = await this.usersRepository.findById(id);

        if (!user) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        await this.cacheService.set(cacheKey, this.sanitizeUserForCache(user), USER_CACHE_TTL_SECONDS, {
            useJitter: true,
        });

        return user;
    }

    /**
     * Modifies the non-sensitive profile information of an existing user.
     * Purges relevant caches upon success to guarantee subsequent reads are fresh.
     *
     * @param id The unique identifier of the user to update
     * @param dto The sparse payload containing the fields to update
     * @returns The updated user entity
     * @throws {NotFoundException} If the user does not exist or the update yields no result
     */
    async update(id: string, dto: PatchUserDto): Promise<User> {
        if (Object.keys(dto).length === 0) {
            return this.findById(id);
        }

        const updatedUser = await this.usersRepository.update(id, dto);

        if (!updatedUser) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        this.eventEmitter.emit(UserEvent.UPDATED, new UserUpdatedEvent(id));

        return updatedUser;
    }

    /**
     * Looks up a user strictly by their email address.
     * Primarily used during login and registration flows to verify identity or uniqueness.
     *
     * @param email The email address to search for
     * @returns The associated user entity
     * @throws {NotFoundException} If no user is found with the provided email
     */
    async findByEmail(email: string): Promise<User> {
        const user = await this.usersRepository.findByEmail(email);

        if (!user) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        return user;
    }

    /**
     * Securely updates a user's password.
     * Enforces the provision of the current password to prevent unauthorized changes, and ensures the new password is computationally different from the old one.
     *
     * @param id The unique identifier of the target user
     * @param dto The payload containing the current and new passwords
     * @throws {NotFoundException} If the user record cannot be located
     * @throws {BadRequestException} If the current password fails verification or matches the new password
     * @throws {InternalServerErrorException} If the database update fails
     */
    async changePassword(id: string, dto: PatchUserPasswordDto) {
        const hashedPassword = await this.usersRepository.findPasswordById(id);

        if (!hashedPassword) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        if (!(await this.hashingService.verify(hashedPassword, dto.currentPassword))) {
            throw new BadRequestException('Invalid current password.');
        }

        if (await this.hashingService.verify(hashedPassword, dto.newPassword)) {
            throw new BadRequestException('New password cannot be the same as the current password.');
        }

        if (
            !(await this.usersRepository.update(id, {
                password: await this.hashingService.hash(dto.newPassword),
            }))
        ) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }

        this.eventEmitter.emit(UserEvent.UPDATED, new UserUpdatedEvent(id));
    }

    /**
     * Permanently deletes a user record and severs their access.
     * Invalidates all active sessions and bans the user identifier before clearing caches and executing the database deletion.
     *
     * @param id The unique identifier of the target user
     * @throws {NotFoundException} If the user does not exist
     * @throws {InternalServerErrorException} If the deletion operation fails
     */
    async delete(id: string) {
        if (!(await this.usersRepository.findById(id))) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        this.eventEmitter.emit(UserEvent.DELETED, new UserDeletedEvent(id));

        if (!(await this.usersRepository.delete(id))) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }
    }

    /**
     * Modifies a user's operational status (active vs inactive).
     * Automatically invalidates sessions and bans the identifier when suspending an account, effectively kicking the user offline instantly.
     *
     * @param id The unique identifier of the target user
     * @param active The boolean state representing if the account should be active
     * @throws {NotFoundException} If the target user is not found
     * @throws {InternalServerErrorException} If the database update fails
     */
    async updateStatus(id: string, active: boolean) {
        if (!(await this.usersRepository.findById(id))) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        this.eventEmitter.emit(UserEvent.STATUS_CHANGED, new UserStatusChangedEvent(id, active));

        if (!(await this.usersRepository.update(id, { isActive: active }))) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }
    }

    /**
     * Removes sensitive fields from a user object before caching.
     *
     * @param user The raw user object from the repository.
     * @returns A safe payload suitable for caching.
     */
    private sanitizeUserForCache(user: User): UserCachePayload {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, ...safeUser } = user;
        return safeUser;
    }
}
