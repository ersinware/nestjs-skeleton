/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file user-cache.listener.spec.ts
 * @description Unit tests for the UserCacheListener.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CacheKeys } from 'src/module/user/application/util';

import type { ICachePort } from 'src/core/cache';
import { TOKEN_CACHE_PORT } from 'src/core/cache';
import { UserCacheListener } from 'src/module/user/application/event/user-cache.listener';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserBannedEvent, UserDeletedEvent, UserUnbannedEvent, UserUpdatedEvent } from 'src/module/user/domain/event';

describe('UserCacheListener', () => {
    let listener: UserCacheListener;

    const mockCacheService = {
        delete: vi.fn(),
    } as unknown as ICachePort;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserCacheListener,
                {
                    provide: TOKEN_CACHE_PORT,
                    useValue: mockCacheService,
                },
            ],
        }).compile();

        listener = module.get(UserCacheListener);
    });

    it('should be defined', () => {
        expect(listener).toBeDefined();
    });

    describe('handleUserModified', () => {
        const userId = 'user-123';

        it('should handle UserUpdatedEvent by clearing user-specific cache', async () => {
            const event = new UserUpdatedEvent(userId);
            await listener.handleUserModified(event);

            expect(mockCacheService.delete).toHaveBeenCalledWith(CacheKeys.userById(userId));
        });

        it('should handle UserDeletedEvent by clearing user-specific cache', async () => {
            const event = new UserDeletedEvent(userId);
            await listener.handleUserModified(event);

            expect(mockCacheService.delete).toHaveBeenCalledWith(CacheKeys.userById(userId));
        });

        it('should handle UserBannedEvent by clearing user-specific cache', async () => {
            const event = new UserBannedEvent(userId);
            await listener.handleUserModified(event);

            expect(mockCacheService.delete).toHaveBeenCalledWith(CacheKeys.userById(userId));
        });

        it('should handle UserUnbannedEvent by clearing user-specific cache', async () => {
            const event = new UserUnbannedEvent(userId);
            await listener.handleUserModified(event);

            expect(mockCacheService.delete).toHaveBeenCalledWith(CacheKeys.userById(userId));
        });
    });
});
