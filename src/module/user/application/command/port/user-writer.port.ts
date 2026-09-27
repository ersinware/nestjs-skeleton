/**
 * @file user-writer.port.ts
 * @description Outbound port for loading and persisting the User aggregate, shared by all user commands.
 */

import { User } from 'src/module/user/domain/aggregate/user.aggregate';

/**
 * Dependency injection token representing the {@link IUserWriterPort} contract.
 */
export const TOKEN_USER_WRITER_PORT = Symbol();

/**
 * Contract for loading and persisting the User aggregate on the write side.
 */
export interface IUserWriterPort {
    /**
     * Loads a specific user aggregate by its unique identifier for mutation.
     *
     * @param id The unique identifier of the target user
     * @returns The user aggregate root, or null if no active user is found
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    load(id: string): Promise<User | null>;

    /**
     * Loads a non-deleted user aggregate by its exact normalized email for mutation.
     *
     * @param email The normalized account email address
     * @returns The user aggregate root, or null if no live user is found
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    loadByEmail(email: string): Promise<User | null>;

    /**
     * Persists the aggregate and its accumulated jobs in the caller's transaction.
     *
     * @param user The aggregate to save
     * @throws {ResourceConflictException} When the email address is already in use, or when the row
     * was modified by another request since the aggregate was loaded (optimistic lock)
     * @throws {DependencyUnavailableException} When the database is unreachable
     * @throws {SystemException} When the queue does not accept every aggregate job
     */
    save(user: User): Promise<void>;
}
