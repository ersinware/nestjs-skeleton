/**
 * @file admin-writer.port.ts
 * @description Outbound port for loading and persisting the Admin aggregate, shared by all admin commands.
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
     * Loads an admin aggregate for mutation.
     *
     * @param id The unique identifier of the target admin
     * @returns The aggregate, or null when no non-deleted admin exists
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    load(id: string): Promise<Admin | null>;

    /**
     * Persists the aggregate and its accumulated jobs in the caller's transaction.
     *
     * @param admin The aggregate to save
     * @throws {ResourceConflictException} When the email address is already in use, or when the row
     * was modified by another request since the aggregate was loaded (optimistic lock)
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    save(admin: Admin): Promise<void>;
}
