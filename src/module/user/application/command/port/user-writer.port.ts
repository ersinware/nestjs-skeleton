/**
 * @file user-writer.port.ts
 * @description Outbound port for loading and persisting the User aggregate, shared by all user commands.
 */

import { User } from 'src/module/user/domain/aggregate/user.aggregate';

/**
 * Dependency injection token representing the {@link IUserWriterPort} contract.
 */
export const TOKEN_USER_WRITER_PORT = Symbol('TOKEN_USER_WRITER_PORT');

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
     * Persists the aggregate (insert or update), then dispatches the domain events it accumulated.
     *
     * @param user The aggregate to save
     * @throws {ResourceConflictException} When the email address is already in use
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    save(user: User): Promise<void>;
}
