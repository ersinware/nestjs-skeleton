/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file user-cache.listener.spec.ts
 * @description Unit tests for the UserCacheListener.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TOKEN_CACHE_SERVICE } from 'src/common/port/cache/cache.constant';
import type { ICacheService } from 'src/common/port/cache/cache-service.interface';
import { CacheKeys } from 'src/common/port/cache/util/cache-key.util';
import { UserCacheListener } from './user-cache.listener';
import { UserDeletedEvent } from '../event/user-deleted.event';
import { UserUpdatedEvent } from '../event/user-updated.event';
import { UserStatusChangedEvent } from '../event/user-status-changed.event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('UserCacheListener', () => {
    let listener: UserCacheListener;

    const mockCacheService = {
        delete: vi.fn(),
        deletePattern: vi.fn(),
    } as unknown as ICacheService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserCacheListener,
                {
                    provide: TOKEN_CACHE_SERVICE,
                    useValue: mockCacheService,
                },
            ],
        }).compile();

        listener = module.get(UserCacheListener);
        vi.clearAllMocks();
    });

    it('should be defined', () => {
        expect(listener).toBeDefined();
    });

    describe('handleUserCreated', () => {
        it('should delete the user list pattern cache', async () => {
            await listener.handleUserCreated();
            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userListPattern());
            expect(mockCacheService.delete).not.toHaveBeenCalled();
        });
    });

    describe('handleUserModified', () => {
        const userId = 'user-123';

        it('should handle UserUpdatedEvent by clearing user-specific cache and list pattern', async () => {
            const event = new UserUpdatedEvent(userId);
            await listener.handleUserModified(event);

            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userByIdPattern(userId));
            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userListPattern());
        });

        it('should handle UserDeletedEvent by clearing user-specific cache and list pattern', async () => {
            const event = new UserDeletedEvent(userId);
            await listener.handleUserModified(event);

            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userByIdPattern(userId));
            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userListPattern());
        });

        it('should handle UserStatusChangedEvent by clearing user-specific cache and list pattern', async () => {
            const event = new UserStatusChangedEvent(userId, false);
            await listener.handleUserModified(event);

            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userByIdPattern(userId));
            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(CacheKeys.userListPattern());
        });
    });
});
