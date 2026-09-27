/**
 * @file activation.spec.ts
 * @description Verifies the pending-account proof lifecycle and its refusal boundaries.
 */

import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { PrincipalType, SessionRevocationReason } from 'src/shared/domain/principal';
import {
    AccessDeniedException,
    InvalidInputException,
    ResourceConflictException,
    SystemException,
} from 'src/shared/exception';
/// <reference types="vitest/globals" />

describe('User activation', () => {
    const initial = {
        id: '01960000-0000-7000-8000-000000000011',
        email: 'activation@example.test',
        name: 'Activation Test',
        password: 'stored-hash',
    };
    const admin = { id: '01960000-0000-7000-8000-000000000012', type: PrincipalType.ADMIN, permissions: [] };
    let account: User;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-24T10:00:00.987Z'));
        account = User.create(initial);
    });
    afterEach(() => vi.useRealTimers());

    function proof() {
        return {
            sub: account.id,
            jti: account.activationId!,
            exp: account.activationExpiresAt!.getTime() / 1000,
            activationRevocationVersion: account.activationRevocationVersion!,
        };
    }

    it('starts pending with a three-day fixed deadline and one delivery', () => {
        expect(account.activationExpiresAt).toEqual(new Date('2026-09-27T10:00:00Z'));
        expect(account.password).toBe(initial.password);
        expect(account.pullJobs()).toEqual([
            {
                aggregateId: account.id,
                deliveryId: account.activationId,
                queueName: UserJobQueue.ACTIVATION,
            },
        ]);
    });

    it('preserves valid proof and deadline while each resend queues a distinct delivery', () => {
        const original = proof();
        account.pullJobs();
        vi.advanceTimersByTime(60_000);
        expect(account.resendActivation()).toBe(true);
        expect(proof()).toEqual(original);
        expect(account.pullJobs()).toHaveLength(1);
        expect(account.resendActivation()).toBe(true);
        expect(account.pullJobs()).toHaveLength(1);
    });

    it('renews expired proof for three days and rejects the old proof', () => {
        const old = proof();
        account.pullJobs();
        vi.setSystemTime(new Date('2026-09-27T10:00:00Z'));
        expect(() => account.activate(old, true)).toThrow(InvalidInputException);
        expect(account.resendActivation()).toBe(true);
        expect(account.activationId).not.toBe(old.jti);
        expect(account.activationExpiresAt).toEqual(new Date('2026-09-30T10:00:00Z'));
        expect(account.pullJobs()).toHaveLength(1);
    });

    it.each(['jti', 'exp', 'activationRevocationVersion'] as const)(
        'rejects mismatched %s without consuming proof',
        (field) => {
            const valid = proof();
            account.pullJobs();
            const invalid = { ...valid, [field]: field === 'jti' ? 'different' : valid[field] + 1 };
            expect(() => account.activate(invalid, true)).toThrow(InvalidInputException);
            expect(proof()).toEqual(valid);
            expect(account.pullJobs()).toEqual([]);
        },
    );

    it('requires the current password and consumes proof once without changing the hash or session version', () => {
        const valid = proof();
        account.pullJobs();
        expect(() => account.activate(valid, false)).toThrow(InvalidInputException);
        expect(proof()).toEqual(valid);
        account.activate(valid, true);
        expect(account.toSnapshot()).toMatchObject({
            password: initial.password,
            activationId: null,
            activationExpiresAt: null,
            activationRevocationVersion: null,
            sessionVersion: 0,
            revocationVersion: 0,
        });
        expect(() => account.activate(valid, true)).toThrow(ResourceConflictException);
    });

    it('invalidates old proof after revocation and renews it on resend', () => {
        const old = proof();
        account.revokeSessions(SessionRevocationReason.LOGOUT_ALL);
        expect(() => account.activate(old, true)).toThrow(InvalidInputException);
        expect(account.resendActivation()).toBe(true);
        expect(account.activationRevocationVersion).toBe(account.revocationVersion);
        expect(account.activationId).not.toBe(old.jti);
    });

    it('refuses banned activation and silently declines resend', () => {
        const valid = proof();
        account.ban(admin);
        expect(() => account.activate(valid, true)).toThrow(AccessDeniedException);
        expect(account.resendActivation()).toBe(false);
        account.unban(admin);
        expect(() => account.activate(valid, true)).toThrow(InvalidInputException);
    });

    it('rejects authenticated self-service while activation is pending', () => {
        expect(() => account.updateName('Changed')).toThrow(SystemException);
    });

    it('treats a verified proof routed to another account as a programming fault', () => {
        expect(() => account.activate({ ...proof(), sub: admin.id }, true)).toThrow(SystemException);
    });
});
