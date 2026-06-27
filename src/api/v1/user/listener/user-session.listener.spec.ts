/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file user-session.listener.spec.ts
 * @description Unit tests for the UserSessionListener.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TOKEN_SESSION_SERVICE } from 'src/common/port/security/session.constant';
import type { ISessionService } from 'src/common/port/security/session.service.interface';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { UserSessionListener } from './user-session.listener';
import { UserDeletedEvent } from '../event/user-deleted.event';
import { UserStatusChangedEvent } from '../event/user-status-changed.event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('UserSessionListener', () => {
    let listener: UserSessionListener;

    const mockSessionService = {
        closeAllSessions: vi.fn(),
        ban: vi.fn(),
        unban: vi.fn(),
    } as unknown as ISessionService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserSessionListener,
                {
                    provide: TOKEN_SESSION_SERVICE,
                    useValue: mockSessionService,
                },
            ],
        }).compile();

        listener = module.get(UserSessionListener);
        vi.clearAllMocks();
    });

    it('should be defined', () => {
        expect(listener).toBeDefined();
    });

    describe('handleUserDeleted', () => {
        it('should close all sessions and ban the user', async () => {
            const event = new UserDeletedEvent('user-123');

            await listener.handleUserDeleted(event);

            expect(mockSessionService.closeAllSessions).toHaveBeenCalledWith(AuthUserRole.USER, 'user-123');
            expect(mockSessionService.ban).toHaveBeenCalledWith(AuthUserRole.USER, 'user-123');
            expect(mockSessionService.unban).not.toHaveBeenCalled();
        });
    });

    describe('handleUserStatusChanged', () => {
        it('should close all sessions and ban the user when deactivated', async () => {
            const event = new UserStatusChangedEvent('user-123', false);

            await listener.handleUserStatusChanged(event);

            expect(mockSessionService.closeAllSessions).toHaveBeenCalledWith(AuthUserRole.USER, 'user-123');
            expect(mockSessionService.ban).toHaveBeenCalledWith(AuthUserRole.USER, 'user-123');
            expect(mockSessionService.unban).not.toHaveBeenCalled();
        });

        it('should unban the user when activated', async () => {
            const event = new UserStatusChangedEvent('user-123', true);

            await listener.handleUserStatusChanged(event);

            expect(mockSessionService.closeAllSessions).not.toHaveBeenCalled();
            expect(mockSessionService.ban).not.toHaveBeenCalled();
            expect(mockSessionService.unban).toHaveBeenCalledWith(AuthUserRole.USER, 'user-123');
        });
    });
});
