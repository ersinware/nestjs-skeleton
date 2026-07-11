/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file user-session.listener.spec.ts
 * @description Unit tests for the UserSessionListener.
 */

import { QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { UserBannedEvent, UserDeletedEvent, UserUnbannedEvent } from 'src/module/user/domain/event';

import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security';
import { UserSessionListener } from 'src/module/user/application/event/user-session.listener';
import { UserRole } from 'src/shared/domain/user';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('UserSessionListener', () => {
    let listener: UserSessionListener;

    const mockSessionService = {
        closeAllSessions: vi.fn(),
        ban: vi.fn(),
        unban: vi.fn(),
    } as unknown as ISessionPort;

    const mockQueryBus = {
        execute: vi.fn(),
    };

    beforeEach(async () => {
        vi.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserSessionListener,
                {
                    provide: QueryBus,
                    useValue: mockQueryBus,
                },
                {
                    provide: TOKEN_SESSION_PORT,
                    useValue: mockSessionService,
                },
            ],
        }).compile();

        listener = module.get(UserSessionListener);
    });

    it('should be defined', () => {
        expect(listener).toBeDefined();
    });

    describe('handleUserAccessRevoked', () => {
        it('should close sessions and ban unconditionally for deleted user', async () => {
            const event = new UserDeletedEvent('user-123');

            await listener.handleUserAccessRevoked(event);

            expect(mockSessionService.closeAllSessions).toHaveBeenCalledWith(UserRole.USER, 'user-123');
            expect(mockSessionService.ban).toHaveBeenCalledWith(UserRole.USER, 'user-123');
            expect(mockSessionService.unban).not.toHaveBeenCalled();
            expect(mockQueryBus.execute).not.toHaveBeenCalled();
        });

        it('should close all sessions and ban the user when banned', async () => {
            const event = new UserBannedEvent('user-123');

            await listener.handleUserAccessRevoked(event);

            expect(mockSessionService.closeAllSessions).toHaveBeenCalledWith(UserRole.USER, 'user-123');
            expect(mockSessionService.ban).toHaveBeenCalledWith(UserRole.USER, 'user-123');
            expect(mockSessionService.unban).not.toHaveBeenCalled();
            expect(mockQueryBus.execute).not.toHaveBeenCalled();
        });
    });

    describe('handleUserUnbanned', () => {
        it('should unban the user', async () => {
            const event = new UserUnbannedEvent('user-123');

            await listener.handleUserUnbanned(event);

            expect(mockSessionService.closeAllSessions).not.toHaveBeenCalled();
            expect(mockSessionService.ban).not.toHaveBeenCalled();
            expect(mockSessionService.unban).toHaveBeenCalledWith(UserRole.USER, 'user-123');
            expect(mockQueryBus.execute).not.toHaveBeenCalled();
        });
    });
});
