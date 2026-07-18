/**
 * @file user-cache.listener.ts
 * @description Event listener responsible for invalidating user caches when domain events occur.
 */

import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ICachePort } from 'src/core/cache';
import { TOKEN_CACHE_PORT } from 'src/core/cache';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Listener to keep the cache synchronized with database mutations by reacting to user events.
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
     * Handles user modification and deletion events by invalidating the specific user cache. No inbox
     * is used: deleting a fixed cache key is intrinsically idempotent — the key is derived purely from
     * the event id and re-running the delete yields the same state (key absent), so the outcome
     * converges under duplicate, out-of-order, and concurrent delivery (CLAUDE.md §8).
     *
     * `suppressErrors: false` is load-bearing: the library default is `true`, which catches a thrown
     * error and only logs it, letting `emitAsync` resolve — this listener could then fail silently and
     * leave a stale cache entry. With it set, the failure surfaces to the `save()` that emitted the
     * event.
     *
     * @param event The dispatched event message carrying the user id and unique event id.
     */
    @OnEvent(UserEvent.UPDATED, { suppressErrors: false })
    @OnEvent(UserEvent.PASSWORD_CHANGED, { suppressErrors: false })
    @OnEvent(UserEvent.BANNED, { suppressErrors: false })
    @OnEvent(UserEvent.UNBANNED, { suppressErrors: false })
    @OnEvent(UserEvent.DELETED, { suppressErrors: false })
    async handleUserModified(event: DispatchedDomainEvent) {
        await this.cachePort.delete(CacheKeys.userById(event.aggregateId));
    }
}
