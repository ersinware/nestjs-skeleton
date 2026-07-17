/**
 * @file admin-session.listener.ts
 * @description Event listener that pushes the admin's DB session version into Redis whenever an
 * admin's access-relevant state changes. Dispatched by the writer adapter after the admin row is
 * written, so revocation only happens once the record is persisted.
 */

import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security';
import {
    TOKEN_GET_ADMIN_ACCESS_PROJECTION_PORT,
    type IGetAdminAccessProjectionPort,
} from 'src/module/admin/application/query/get-admin-access-projection';
import { AdminEvent } from 'src/module/admin/domain/event';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Reacts to admin status changes by pushing the current database session version into Redis. Reading
 * the version from the database (including soft-deleted rows) makes the outcome converge under
 * duplicate, out-of-order, and concurrent delivery regardless of the event verb. No inbox is used:
 * the write is monotonic-max and its input derives from the re-readable database (CLAUDE.md §8).
 */
@Injectable()
export class AdminSessionListener {
    /**
     * Injects the session port and the admin access-projection query port.
     *
     * @param sessionPort The service managing the session version in Redis.
     * @param accessProjectionPort The query port that reads the admin's session version, including soft-deleted rows.
     */
    constructor(
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_GET_ADMIN_ACCESS_PROJECTION_PORT)
        private readonly accessProjectionPort: IGetAdminAccessProjectionPort,
    ) {}

    /**
     * Pushes the admin's current DB session version into Redis.
     *
     * `suppressErrors: false` is load-bearing: the library default is `true`, which catches a thrown
     * error and only logs it, letting `emitAsync` resolve — a Redis outage here would then silently
     * leave the revocation unapplied. With it set, the failure surfaces to the `save()` that emitted
     * the event.
     *
     * @param event The dispatched event message carrying the admin id.
     */
    @OnEvent(AdminEvent.BANNED, { suppressErrors: false })
    @OnEvent(AdminEvent.UNBANNED, { suppressErrors: false })
    @OnEvent(AdminEvent.DELETED, { suppressErrors: false })
    @OnEvent(AdminEvent.SESSION_REUSE_REVOKED, { suppressErrors: false })
    async reconcile(event: DispatchedDomainEvent) {
        const projection = await this.accessProjectionPort.getAdminAccessProjection(event.aggregateId);

        // Admins are only ever soft-deleted, so a missing row means there is nothing to reconcile.
        if (!projection) {
            return;
        }

        await this.sessionPort.setVersion(event.aggregateId, projection.version);
    }
}
