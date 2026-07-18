/**
 * @file user-session.listener.ts
 * @description Event listener that reconciles Redis session/ban/watermark state with the database
 * whenever a user's access-relevant state changes.
 */

import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import {
    TOKEN_GET_USER_ACCESS_PROJECTION_PORT,
    type IGetUserAccessProjectionPort,
} from 'src/module/user/application/query/get-user-access-projection/port';
import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Listener that keeps the Redis session version in sync with the database by pushing current DB truth
 * on every access-relevant user event.
 */
@Injectable()
export class UserSessionListener {
    /**
     * Injects the session port and the access-projection query port.
     *
     * @param sessionPort The service managing the session version in Redis.
     * @param accessProjectionPort The query port that reads the user's session version, including soft-deleted rows.
     */
    constructor(
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_GET_USER_ACCESS_PROJECTION_PORT)
        private readonly accessProjectionPort: IGetUserAccessProjectionPort,
    ) {}

    /**
     * Pushes the user's current DB session version into Redis. Reading the version from the database
     * makes the outcome converge under duplicate, out-of-order, and concurrent delivery regardless of
     * the event verb. No inbox is used: the write is monotonic-max and its input derives from the
     * re-readable database (CLAUDE.md §8).
     *
     * `suppressErrors: false` is load-bearing: the library default is `true`, which catches a thrown
     * error and only logs it, letting `emitAsync` resolve — a Redis outage here would then silently
     * leave the revocation unapplied. With it set, the failure surfaces to the `save()` that emitted
     * the event.
     *
     * @param event The dispatched event message carrying the user id.
     */
    @OnEvent(UserEvent.BANNED, { suppressErrors: false })
    @OnEvent(UserEvent.UNBANNED, { suppressErrors: false })
    @OnEvent(UserEvent.PASSWORD_CHANGED, { suppressErrors: false })
    @OnEvent(UserEvent.DELETED, { suppressErrors: false })
    @OnEvent(UserEvent.SESSION_REUSE_REVOKED, { suppressErrors: false })
    async reconcile(event: DispatchedDomainEvent) {
        const projection = await this.accessProjectionPort.getAccessProjection(event.aggregateId);

        // A missing row means the account never existed — nothing to reconcile.
        if (!projection) {
            return;
        }

        await this.sessionPort.setVersion(event.aggregateId, projection.version);
    }
}
