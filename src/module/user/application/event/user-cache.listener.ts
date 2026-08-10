/**
 * @file user-cache.listener.ts
 * @description Listener that evicts the cached user projection on projection-changing domain events.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { ICachePort } from 'src/core/cache';
import { TOKEN_CACHE_PORT } from 'src/core/cache';
import { OnAppEvent } from 'src/core/event-bus';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * The event-driven cache invalidation path, deliberately kept alongside the synchronous pipeline
 * invalidation (ICacheInvalidatingCommand): the pipeline evicts immediately in the happy path, this
 * listener becomes the reliable guarantee once the transactional outbox lands. Both derive their
 * keys from the same CacheKeys helper, so they can never address different entries. Eviction is
 * idempotent — deleting a fixed key converges under any delivery order — so no inbox is needed.
 */
@Injectable()
export class UserCacheListener {
    /**
     * Injects the cache the listener evicts from.
     *
     * @param cachePort The cache the eviction runs on
     */
    constructor(@Inject(TOKEN_CACHE_PORT) private readonly cachePort: ICachePort) {}

    /**
     * Evicts the public profile projection when an event changes any of its fields (email/name on
     * update, ban status on ban/unban, existence on delete). A password change is intentionally absent:
     * it does not touch this projection.
     *
     * @param event The event carrying the user id
     */
    @OnAppEvent(UserEvent.UPDATED)
    @OnAppEvent(UserEvent.BANNED)
    @OnAppEvent(UserEvent.UNBANNED)
    @OnAppEvent(UserEvent.DELETED)
    async invalidateProfile(event: DispatchedDomainEvent) {
        await this.cachePort.delete(CacheKeys.userById(event.aggregateId));
    }
}
