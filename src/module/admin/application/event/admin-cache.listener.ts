/**
 * @file admin-cache.listener.ts
 * @description Event listener responsible for invalidating admin caches when domain events occur.
 */

import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ICachePort } from 'src/core/cache';
import { TOKEN_CACHE_PORT } from 'src/core/cache';
import { CacheKeys } from 'src/module/admin/application/admin-cache-key.util';
import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Keeps the admin caches in sync with database mutations by reacting to admin events. This is the
 * SECOND, event-driven invalidation path deliberately kept alongside the synchronous command-pipeline
 * invalidation (ICacheInvalidatingCommand): the pipeline evicts immediately in the happy path, this
 * listener is the path that becomes the reliable guarantee once the transactional outbox lands. Both
 * derive their keys from the same CacheKeys helper, so they can never address different entries.
 *
 * Eviction is intrinsically idempotent — deleting a fixed key derived purely from the event id yields
 * the same state (key absent) under duplicate, out-of-order, and concurrent delivery, so no inbox is
 * needed. Admins have no public profile projection, so auth-state is the only cached read.
 *
 * `suppressErrors: false` is load-bearing: the library default is `true`, which catches a thrown error
 * and only logs it, letting `emitAsync` resolve — a Redis outage would then fail silently and leave a
 * stale entry. With it set, the failure surfaces to the `save()` that emitted the event.
 */
@Injectable()
export class AdminCacheListener {
    /**
     * Injects the required cache service.
     *
     * @param cachePort The cache service abstraction.
     */
    constructor(@Inject(TOKEN_CACHE_PORT) private readonly cachePort: ICachePort) {}

    /**
     * Evicts the auth-state read (ban status + session version) when an event changes either: ban
     * status on ban/unban, existence on delete, or the session version on a reuse-driven revocation.
     *
     * @param event The dispatched event message carrying the admin id.
     */
    @OnEvent(AdminEvent.BANNED, { suppressErrors: false })
    @OnEvent(AdminEvent.UNBANNED, { suppressErrors: false })
    @OnEvent(AdminEvent.DELETED, { suppressErrors: false })
    @OnEvent(AdminEvent.SESSION_REUSE_REVOKED, { suppressErrors: false })
    async invalidateAuthState(event: DispatchedDomainEvent) {
        await this.cachePort.delete(CacheKeys.adminAuthState(event.aggregateId));
    }
}
