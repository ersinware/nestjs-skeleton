/**
 * @file user.service.ts
 * @description Domain service containing business logic for managing user registration, profile updates, and credentials.
 */

import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    forwardRef,
} from '@nestjs/common';
import { TOKEN_CACHE_SERVICE } from 'src/cache/constant/cache.constant';
import type { ICacheService } from 'src/cache/interface/cache-service.interface';
import { CacheKeys } from 'src/cache/util/cache-key.util';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { ConflictType } from 'src/common/enum/error/conflict-type.enum';
import { InternalServerErrorType } from 'src/common/enum/error/internal-server-error-type.enum';
import { NotFoundType } from 'src/common/enum/error/not-found-type.enum';
import { HashingService } from 'src/common/hashing/service/hashing.service';
import { AuthService } from 'src/v1/auth/auth.service';
import { TOKEN_USERS_REPOSITORY, USER_CACHE_TTL_SECONDS } from './constant/user.constant';
import { PatchUserPasswordDto } from './dto/patch-user-password.dto';
import { PatchUserDto } from './dto/patch-user.dto';
import { PostUserDto } from './dto/post-user.dto';
import { QueryUserSearchDto } from './dto/query-user-search.dto';
import type { IUsersRepository } from './interface/users.repository.interface';
import type { User } from './type/user.type';

/**
 * Service orchestrating user domain logic and interacting with the persistence repository.
 */
@Injectable()
export class UserService {
    /**
     * Creates an instance of UserService.
     *
     * @param usersRepository User persistence repository abstraction.
     * @param authService Authentication service.
     * @param hashingService Hashing operations utility service.
     * @param cacheService Cache operations utility service.
     */
    constructor(
        @Inject(TOKEN_USERS_REPOSITORY) private readonly usersRepository: IUsersRepository,
        @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
        private readonly hashingService: HashingService,
        @Inject(TOKEN_CACHE_SERVICE) private readonly cacheService: ICacheService,
    ) {}

    /**
     * Creates a new user account by hashing their password and storing it.
     *
     * @param dto The user details.
     * @returns A promise resolving to the created user entity.
     * @throws {ConflictException} if email is already in use.
     * @throws {InternalServerErrorException} if user creation fails.
     */
    async create(dto: PostUserDto) {
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

        return user;
    }

    /**
     * Retrieves all registered user records with pagination and optional search filter.
     *
     * @param query The query pagination and search parameters.
     * @returns A promise resolving to an object containing active users array and total count.
     */
    async findAll(query: QueryUserSearchDto) {
        const cacheKey = CacheKeys.userList(query),
            cached = await this.cacheService.get<{ data: User[]; total: number }>(cacheKey);

        if (cached) {
            return cached;
        }

        const result = await this.usersRepository.findAll(query);

        await this.cacheService.set(cacheKey, result, USER_CACHE_TTL_SECONDS);

        return result;
    }

    /**
     * Retrieves a user by their unique database identifier.
     *
     * @param id The user ID.
     * @returns A promise resolving to the user.
     * @throws {NotFoundException} if the user does not exist.
     */
    async findById(id: string) {
        const cacheKey = CacheKeys.userById(id),
            cachedUser = await this.cacheService.get<User>(cacheKey);

        if (cachedUser) {
            return cachedUser;
        }

        const user = await this.usersRepository.findById(id);

        if (!user) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        await this.cacheService.set(cacheKey, user, USER_CACHE_TTL_SECONDS);

        return user;
    }

    /**
     * Updates an existing user's profile information.
     *
     * @param id The user ID.
     * @param dto Profile update fields payload.
     * @returns A promise resolving to the updated user.
     * @throws {NotFoundException} if the user does not exist.
     */
    async update(id: string, dto: PatchUserDto) {
        const updatedUser = await this.usersRepository.update(id, dto);

        if (!updatedUser) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        await Promise.all([
            this.cacheService.delete(CacheKeys.userById(id)),
            this.cacheService.deletePattern(CacheKeys.userListPattern()),
        ]);

        return updatedUser;
    }

    /**
     * Modifies a user's password after verifying their current password.
     *
     * @param id The user ID.
     * @param dto Password modification payload.
     * @throws {NotFoundException} if the user does not exist.
     * @throws {BadRequestException} if the current password is incorrect or the new password is unchanged.
     * @throws {InternalServerErrorException} if database update fails.
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

        await this.cacheService.delete(CacheKeys.userById(id));
    }

    /**
     * Deletes a user record from the database.
     *
     * @param id The user ID.
     * @throws {NotFoundException} if the user does not exist.
     * @throws {InternalServerErrorException} if the database deletion fails.
     */
    async delete(id: string) {
        const user = await this.usersRepository.findById(id);
        if (!user) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        await this.authService.logoutAll(AuthUserRole.USER, id);
        await this.authService.ban(AuthUserRole.USER, id);

        if (!(await this.usersRepository.delete(id))) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }

        await Promise.all([
            this.cacheService.delete(CacheKeys.userById(id)),
            this.cacheService.deletePattern(CacheKeys.userListPattern()),
        ]);
    }

    /**
     * Updates the active status of a user.
     *
     * @param id User identifier.
     * @param active The target active state.
     * @throws {NotFoundException} if the user is not found.
     * @throws {InternalServerErrorException} if the database update fails.
     */
    async updateStatus(id: string, active: boolean) {
        const user = await this.usersRepository.findById(id);
        if (!user) {
            throw new NotFoundException(NotFoundType.DEFAULT);
        }

        if (!active) {
            await this.authService.logoutAll(AuthUserRole.USER, id);
            await this.authService.ban(AuthUserRole.USER, id);
        } else {
            await this.authService.unban(AuthUserRole.USER, id);
        }

        if (!(await this.usersRepository.update(id, { isActive: active }))) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }

        await Promise.all([
            this.cacheService.delete(CacheKeys.userById(id)),
            this.cacheService.deletePattern(CacheKeys.userListPattern()),
        ]);
    }
}
