/**
 * @file user-writer.port.ts
 * @description Outbound port for User commands. Defines the contract for the infrastructure layer to persist the User aggregate.
 */

import { User } from 'src/module/user/domain/aggregate';

export const TOKEN_USER_WRITER_PORT = Symbol('TOKEN_USER_WRITER_PORT');

export interface IUserWriterPort {
    /**
     * Loads a specific user aggregate by its unique identifier for mutation.
     *
     * @param id The unique identifier of the target user
     * @returns The user aggregate root, or null if no active user is found
     */
    load(id: string): Promise<User | null>;

    /**
     * Saves a User aggregate to the database.
     * This handles both insertion and updating, and should dispatch/store any domain events attached to the aggregate.
     *
     * @param user The User aggregate root to save.
     * @param tx Optional transaction context
     */
    save(user: User, tx?: unknown): Promise<void>;
}
