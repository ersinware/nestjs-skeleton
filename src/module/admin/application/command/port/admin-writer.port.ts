/**
 * @file admin-writer.port.ts
 * @description Outbound port for Admin commands. Defines the contract for the infrastructure layer to persist the Admin aggregate.
 */

import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';

/**
 * Dependency injection token representing the {@link IAdminWriterPort} contract.
 */
export const TOKEN_ADMIN_WRITER_PORT = Symbol('TOKEN_ADMIN_WRITER_PORT');

/**
 * Contract for loading and persisting the Admin aggregate on the write side.
 */
export interface IAdminWriterPort {
    /**
     * Loads a specific admin aggregate by its unique identifier for mutation.
     *
     * @param id The unique identifier of the target admin
     * @returns The admin aggregate root, or null if no active admin is found
     */
    load(id: string): Promise<Admin | null>;

    /**
     * Saves an Admin aggregate to the database.
     * This handles both insertion and updating, and should dispatch/store any domain events attached to the aggregate.
     *
     * @param admin The Admin aggregate root to save.
     * @throws {ResourceConflictException} When the email is already in use — the unique violation
     * translated at the port boundary.
     */
    save(admin: Admin, tx?: unknown): Promise<void>;
}
