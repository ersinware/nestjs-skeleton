/**
 * @file users.repository.interface.ts
 * @description Repository interface defining contract for User entity database persistence operations.
 */

import type { QueryPaginationDto } from 'src/common/dto/query-pagination.dto';
import type { NewUser, User } from '../type/user.type';

export interface IUsersRepository {
    /**
     * Inserts a new user record into the database.
     *
     * @param data User creation fields.
     * @returns A promise resolving to the created user, or null if insert failed.
     */
    create(data: NewUser): Promise<User | null>;

    /**
     * Retrieves all non-deleted user records from the database with pagination.
     *
     * @param query The query pagination parameters.
     * @returns A promise resolving to an object containing active users array and total count.
     */
    findAll(query: QueryPaginationDto): Promise<{ data: User[]; total: number }>;

    /**
     * Finds a single user record by their ID where they are not deleted.
     *
     * @param id The user ID.
     * @returns A promise resolving to the user or null if not found.
     */
    findById(id: string): Promise<User | null>;

    /**
     * Finds a single user record by their email address where they are not deleted.
     *
     * @param email The user email address.
     * @returns A promise resolving to the user or null if not found.
     */
    findByEmail(email: string): Promise<User | null>;

    /**
     * Retrieves the hashed password of a user by their ID where they are not deleted.
     *
     * @param id The user ID.
     * @returns A promise resolving to the hashed password string, or null if not found.
     */
    findPasswordById(id: string): Promise<string | null>;

    /**
     * Updates an existing user record with partial data where they are not deleted.
     *
     * @param id The user ID.
     * @param data Partial fields to update.
     * @returns A promise resolving to the updated user, or null if update failed.
     */
    update(id: string, data: Partial<NewUser>): Promise<User | null>;

    /**
     * Deletes a user record by their ID (Soft Delete).
     *
     * @param id The user ID.
     * @returns A promise resolving to true if the record was soft-deleted, false otherwise.
     */
    delete(id: string): Promise<boolean>;
}
