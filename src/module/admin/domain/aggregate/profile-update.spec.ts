/**
 * @file profile-update.spec.ts
 * @description Verifies atomic profile refusals and historical cleanup identity captured by the aggregate.
 */

/// <reference types="vitest/globals" />

import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { ExceptionKind } from 'src/shared/exception';

describe('Admin profile updates', () => {
    const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
    const previous = 'c116ffde-c006-4b3f-902c-e658d6ad4142';
    const next = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';

    it.each(['pending', 'permanent'] as const)(
        'captures the previous %s identity before accepting the next avatar',
        (kind) => {
            const admin: Admin = Admin.reconstitute({
                ...Admin.create({ id, email: 'profile@example.test', name: 'Admin', password: 'hash' }).toSnapshot(),
                avatarKey:
                    kind === 'pending'
                        ? buildAdminPendingAvatarKey(id, previous)
                        : buildAdminPermanentAvatarKey(id, previous),
            });
            const before = admin.toSnapshot();
            expect(admin.assertProfileUpdateAllowed()).toBeUndefined();
            expect(
                admin.assertProfileUpdateAllowed({
                    fileKey: buildAdminPendingAvatarKey(id, next),
                    jti: next,
                    revocationVersion: 0,
                }),
            ).toBeUndefined();
            expect(admin.toSnapshot()).toEqual(before);
            expect(admin.pullJobs()).toEqual([]);
            expect(
                admin.update(undefined, {
                    fileKey: buildAdminPendingAvatarKey(id, next),
                    jti: next,
                    revocationVersion: 0,
                }),
            ).toBe(true);
            expect(admin.name).toBe('Admin');
            expect(admin.pullJobs()).toEqual([
                {
                    deliveryId: next,
                    aggregateId: id,
                    queueName: AdminJobQueue.AVATAR_REPLACE,
                    payload: { previousAvatarId: previous },
                },
            ]);
            expect(admin.sessionVersion).toBe(0);
            expect(admin.revocationVersion).toBe(0);
        },
    );

    it.each(['revoked', 'invalid-key', 'replay', 'banned'] as const)(
        'rejects %s without partial name mutation or jobs',
        (scenario) => {
            const admin: Admin = Admin.reconstitute({
                ...Admin.create({ id, email: 'profile@example.test', name: 'Admin', password: 'hash' }).toSnapshot(),
                avatarKey: buildAdminPermanentAvatarKey(id, scenario === 'replay' ? next : previous),
                isBanned: scenario === 'banned',
            });
            const before = admin.toSnapshot();
            expect(() =>
                admin.assertProfileUpdateAllowed({
                    fileKey: scenario === 'invalid-key' ? 'wrong' : buildAdminPendingAvatarKey(id, next),
                    jti: next,
                    revocationVersion: scenario === 'revoked' ? 1 : 0,
                }),
            ).toThrow();
            expect(admin.toSnapshot()).toEqual(before);
            expect(admin.pullJobs()).toEqual([]);
            expect(() =>
                admin.update('Changed', {
                    fileKey: scenario === 'invalid-key' ? 'wrong' : buildAdminPendingAvatarKey(id, next),
                    jti: next,
                    revocationVersion: scenario === 'revoked' ? 1 : 0,
                }),
            ).toThrow(
                expect.objectContaining({
                    kind:
                        scenario === 'revoked'
                            ? ExceptionKind.INVALID_INPUT
                            : scenario === 'invalid-key'
                              ? ExceptionKind.SYSTEM
                              : scenario === 'replay'
                                ? ExceptionKind.RESOURCE_CONFLICT
                                : ExceptionKind.ACCESS_DENIED,
                }),
            );
            expect(admin.toSnapshot()).toEqual(before);
            expect(admin.pullJobs()).toEqual([]);
        },
    );
});
