/**
 * @file user-cache.listener.ts
 * @description Event listener responsible for invalidating user caches when domain events occur.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { ICachePort } from 'src/core/cache';
import { TOKEN_CACHE_PORT } from 'src/core/cache';
import { OnAppEvent } from 'src/core/event-bus';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Keeps the user caches in sync with database mutations by reacting to user events. This is the
 * SECOND, event-driven invalidation path deliberately kept alongside the synchronous command-pipeline
 * invalidation (ICacheInvalidatingCommand): the pipeline evicts immediately in the happy path, this
 * listener is the path that becomes the reliable guarantee once the transactional outbox lands. Both
 * derive their keys from the same CacheKeys helper, so they can never address different entries.
 *
 * Eviction is intrinsically idempotent — deleting a fixed key derived purely from the event id yields
 * the same state (key absent) under duplicate, out-of-order, and concurrent delivery, so no inbox is
 * needed. The public profile projection is the only cached user read.
 */
@Injectable()
export class UserCacheListener {
    /**
     * Injects the required cache service.
     *
     * @param cachePort The cache service abstraction.
     */
    constructor(@Inject(TOKEN_CACHE_PORT) private readonly cachePort: ICachePort) {}

    /**
     * Evicts the public profile projection when an event changes any of its fields (email/name on
     * update, ban status on ban/unban, existence on delete). A password change is intentionally absent:
     * it does not touch this projection.
     *
     * @param event The dispatched event message carrying the user id.
     */
    @OnAppEvent(UserEvent.UPDATED)
    @OnAppEvent(UserEvent.BANNED)
    @OnAppEvent(UserEvent.UNBANNED)
    @OnAppEvent(UserEvent.DELETED)
    async invalidateProfile(event: DispatchedDomainEvent) {
        await this.cachePort.delete(CacheKeys.userById(event.aggregateId));
    }
}
