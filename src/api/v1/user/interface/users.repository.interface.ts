/**
 * @file users.repository.interface.ts
 * @description Defines the contract for user data persistence operations. Using an interface allows swapping the underlying ORM or database provider without altering business logic.
 */

import type { QuerySearchDto } from 'src/common/search/dto/query-search.dto';
import type { NewUser, User } from '../type/user.type';

/**
 * Interface for the UsersRepository.
 * Defines the database interactions for the user domain.
 */
export interface IUsersRepository {
    /**
     * Inserts a new user record into the database.
     *
     * @param data The payload containing fields required to insert a user
     * @returns The created user entity, or null if the insertion fails
     */
    create(data: NewUser): Promise<User | null>;

    /**
     * Retrieves a paginated list of non-deleted user records, optionally filtered by a search query.
     *
     * @param query The pagination limits and search parameters
     * @returns An object containing the array of user entities and the total record count
     */
    findAll(query: QuerySearchDto): Promise<{ data: User[]; total: number }>;

    /**
     * Retrieves a specific user by their unique identifier, ensuring they are not soft-deleted.
     *
     * @param id The unique identifier of the target user
     * @returns The user entity, or null if no active user is found
     */
    findById(id: string): Promise<User | null>;

    /**
     * Retrieves a specific user strictly by their email address, ensuring they are not soft-deleted.
     *
     * @param email The exact email address to query
     * @returns The user entity, or null if no active user is found
     */
    findByEmail(email: string): Promise<User | null>;

    /**
     * Retrieves only the hashed password for a specific user to perform credential validation.
     *
     * @param id The unique identifier of the target user
     * @returns The hashed password string, or null if the user does not exist or is deleted
     */
    findPasswordById(id: string): Promise<string | null>;

    /**
     * Updates an existing user record with sparse data, ensuring they are not soft-deleted.
     *
     * @param id The unique identifier of the user to update
     * @param data The payload containing the fields to update
     * @returns The updated user entity, or null if the update fails
     */
    update(id: string, data: Partial<NewUser>): Promise<User | null>;

    /**
     * Soft-deletes a user record by setting their deletion timestamp, preventing them from appearing in active queries.
     *
     * @param id The unique identifier of the user to delete
     * @returns True if the soft-delete was successful, false otherwise
     */
    delete(id: string): Promise<boolean>;
}
