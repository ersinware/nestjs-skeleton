/**
 * @file email-change.spec.ts
 * @description Verifies account-owned email request, proof consumption, and profile invariants.
 */

/// <reference types="vitest/globals" />

import { randomUUID } from 'node:crypto';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { PrincipalType, SessionRevocationReason } from 'src/shared/domain/principal';
import { AccessDeniedException, InvalidInputException, SystemException } from 'src/shared/exception';

describe('User email change invariants', () => {
    const initial = {
        id: '01960000-0000-7000-8000-000000000001',
        name: 'Example',
        email: 'old@example.test',
        password: 'hash',
        avatarKey: 'pending/avatar/user/01960000-0000-7000-8000-000000000001',
    };
    const notificationId = '01960000-0000-7000-8000-000000000002';
    const actor = { id: '01960000-0000-7000-8000-000000000003', type: PrincipalType.ADMIN, permissions: [] };
    let account: User;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-24T10:00:00.987Z'));
        account = User.reconstitute({
            ...User.create(initial).toSnapshot(),
            activationId: null,
            activationExpiresAt: null,
            activationRevocationVersion: null,
        });
    });
    afterEach(() => vi.useRealTimers());

    /**
     * Captures proof claims before subsequent state transitions.
     *
     * @returns Claims issued for the current request
     */
    function proof(): Parameters<User['confirmEmailChange']>[0] {
        return {
            sub: account.id,
            jti: account.pendingEmailRequestId!,
            exp: account.pendingEmailExpiresAt!.getTime() / 1000,
            emailRevocationVersion: account.pendingEmailRevocationVersion!,
        };
    }

    it('updates only the name and leaves an identical name as a no-op', () => {
        const before = account.toSnapshot();
        expect(account.updateName(account.name)).toBe(false);
        expect(account.toSnapshot()).toEqual(before);
        expect(account.pullJobs()).toEqual([]);
        expect(account.updateName('Changed')).toBe(true);
        expect(account.email).toBe(initial.email);
        expect(account.sessionVersion).toBe(0);
        expect(account.revocationVersion).toBe(0);
    });

    it('retains the avatar and ban state on repeat-safe soft deletion', () => {
        const key = account.avatarKey;
        account.markAsDeleted();
        expect(account.avatarKey).toBe(key);
        expect(account.isBanned).toBe(false);
        expect(account.deletedAt).toBeInstanceOf(Date);
        expect(account.sessionVersion).toBe(1);
        account.pullJobs();
        const before = account.toSnapshot();
        account.markAsDeleted();
        expect(account.toSnapshot()).toEqual(before);
        expect(account.pullJobs()).toEqual([]);
    });

    it('creates a fixed thirty-minute request without changing credentials or sessions', () => {
        account.requestEmailChange('new@example.test', true, false);
        expect(account.pendingEmailRequestId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(account.pendingEmailExpiresAt).toEqual(new Date('2026-09-24T10:30:00Z'));
        expect(account.toSnapshot()).toMatchObject({
            email: initial.email,
            password: initial.password,
            sessionVersion: 0,
            revocationVersion: 0,
            pendingEmail: 'new@example.test',
            pendingEmailRevocationVersion: 0,
        });
        expect(account.pullJobs()).toEqual([
            {
                aggregateId: account.id,
                deliveryId: account.pendingEmailRequestId,
                queueName: UserJobQueue.EMAIL_CONFIRMATION,
            },
        ]);
    });

    it('replaces even a same-address request and rejects its previous proof without effects', () => {
        account.requestEmailChange('new@example.test', true, false);
        const previous = proof();
        account.pullJobs();
        vi.setSystemTime(new Date('2026-09-24T10:01:00Z'));
        account.requestEmailChange('new@example.test', true, false);
        expect(account.pendingEmailRequestId).not.toBe(previous.jti);
        expect(proof().exp).toBe(previous.exp + 60);
        account.pullJobs();
        const before = account.toSnapshot();
        expect(() => account.confirmEmailChange(previous, notificationId)).toThrow(InvalidInputException);
        expect(account.toSnapshot()).toEqual(before);
        expect(account.pullJobs()).toEqual([]);
    });

    it('consumes the request once, revokes sessions, and queues the immutable notice identity', () => {
        account.requestEmailChange('new@example.test', true, false);
        const claims = proof();
        account.pullJobs();
        account.confirmEmailChange(claims, notificationId);
        expect(account.toSnapshot()).toMatchObject({
            email: 'new@example.test',
            password: initial.password,
            pendingEmailRequestId: null,
            pendingEmail: null,
            pendingEmailExpiresAt: null,
            pendingEmailRevocationVersion: null,
            sessionVersion: 1,
            revocationVersion: 1,
        });
        const jobs = account.pullJobs();
        expect(jobs).toContainEqual({
            aggregateId: account.id,
            deliveryId: notificationId,
            queueName: UserJobQueue.EMAIL_CHANGE_NOTIFICATION,
        });
        expect(jobs.map((job) => job.queueName).sort()).toEqual(
            [
                UserJobQueue.SESSION_RECONCILE,
                UserJobQueue.EMAIL_CHANGE_NOTIFICATION,
                UserJobQueue.CACHE_INVALIDATE,
            ].sort(),
        );
        const after = account.toSnapshot();
        expect(() => account.confirmEmailChange(claims, notificationId)).toThrow(InvalidInputException);
        expect(account.toSnapshot()).toEqual(after);
        expect(account.pullJobs()).toEqual([]);
    });

    it.each(['jti', 'exp', 'revocation'] as const)('rejects a mismatched %s without mutation or jobs', (field) => {
        account.requestEmailChange('new@example.test', true, false);
        const claims = proof();
        account.pullJobs();
        const before = account.toSnapshot();
        const wrong = {
            ...claims,
            ...(field === 'jti'
                ? { jti: randomUUID() }
                : field === 'exp'
                  ? { exp: claims.exp + 1 }
                  : { emailRevocationVersion: 1 }),
        };
        expect(() => account.confirmEmailChange(wrong, notificationId)).toThrow(InvalidInputException);
        expect(account.toSnapshot()).toEqual(before);
        expect(account.pullJobs()).toEqual([]);
    });

    it('checks expiry again at consumption, including the exact deadline', () => {
        account.requestEmailChange('new@example.test', true, false);
        const claims = proof();
        account.pullJobs();
        vi.setSystemTime(claims.exp * 1000);
        const before = account.toSnapshot();
        expect(() => account.confirmEmailChange(claims, notificationId)).toThrow(InvalidInputException);
        expect(account.toSnapshot()).toEqual(before);
        expect(account.pullJobs()).toEqual([]);
    });

    it.each(['password', 'ban', 'revocation', 'delete'] as const)('invalidates proof after %s', (change) => {
        account.requestEmailChange('new@example.test', true, false);
        const claims = proof();
        if (change === 'password') {
            account.changePassword('new hash', true, false);
        }
        if (change === 'ban') {
            account.ban(actor);
        }
        if (change === 'revocation') {
            account.revokeSessions(SessionRevocationReason.LOGOUT_ALL);
        }
        if (change === 'delete') {
            account.markAsDeleted();
        }
        account.pullJobs();
        const before = account.toSnapshot();
        expect(() => account.confirmEmailChange(claims, notificationId)).toThrow();
        expect(account.toSnapshot()).toEqual(before);
        expect(account.pullJobs()).toEqual([]);
    });

    it('rejects the existing email and banned requests without effects', () => {
        expect(() => account.requestEmailChange(initial.email, true, true)).toThrow(InvalidInputException);
        expect(account.pullJobs()).toEqual([]);
        account.ban(actor);
        account.pullJobs();
        const before = account.toSnapshot();
        expect(() => account.requestEmailChange('new@example.test', true, false)).toThrow(AccessDeniedException);
        expect(account.toSnapshot()).toEqual(before);
        expect(account.pullJobs()).toEqual([]);
    });

    it('treats a misrouted subject as a programming error', () => {
        account.requestEmailChange('new@example.test', true, false);
        account.pullJobs();
        const before = account.toSnapshot();
        expect(() => account.confirmEmailChange({ ...proof(), sub: actor.id }, notificationId)).toThrow(
            SystemException,
        );
        expect(account.toSnapshot()).toEqual(before);
        expect(account.pullJobs()).toEqual([]);
    });

    it('preserves proof across access-only version changes and revokes at the latest version', () => {
        account.requestEmailChange('new@example.test', true, false);
        const claims = proof();
        account = User.reconstitute({ ...account.toSnapshot(), sessionVersion: 3 });
        account.confirmEmailChange(claims, notificationId);
        expect(account.email).toBe('new@example.test');
        expect(account.sessionVersion).toBe(4);
        expect(account.revocationVersion).toBe(4);
    });
});
