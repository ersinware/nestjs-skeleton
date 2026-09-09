/**
 * @file user-cache.listener.ts
 * @description Listener that evicts the cached user projection on projection-changing domain events.
 */

import { Inject, Injectable } from '@nestjs/common';
import { TOKEN_CACHE_EVICTION_PORT, type ICacheEvictionPort } from 'src/core/cache';
import { OnAppEvent } from 'src/core/event-bus';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Complements best-effort pipeline eviction using the same CacheKeys helper. Failed deletions
 * reject delivery; durable retries require the pending outbox/relay. Repeated deletion needs no
 * inbox, but cannot prevent concurrent stale cache fills.
 */
@Injectable()
export class UserCacheListener {
    /**
     * Injects the cache the listener evicts from.
     *
     * @param cacheEvictionPort The cache eviction contract that propagates failures
     */
    constructor(@Inject(TOKEN_CACHE_EVICTION_PORT) private readonly cacheEvictionPort: ICacheEvictionPort) {}

    /**
     * Evicts the public profile projection when an event changes any of its fields (email/name on
     * update, ban status on ban/unban, permissions on a permission change, existence on delete). A
     * password change is intentionally absent: it does not touch this projection.
     *
     * @param event The event carrying the user id
     */
    @OnAppEvent(UserEvent.UPDATED)
    @OnAppEvent(UserEvent.BANNED)
    @OnAppEvent(UserEvent.UNBANNED)
    @OnAppEvent(UserEvent.DELETED)
    @OnAppEvent(UserEvent.PERMISSIONS_CHANGED)
    async invalidateProfile(event: DispatchedDomainEvent) {
        await this.cacheEvictionPort.delete(CacheKeys.userById(event.aggregateId));
    }
}
