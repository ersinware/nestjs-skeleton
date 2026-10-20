/**
 * @file profile-update.spec.ts
 * @description Verifies atomic profile refusals and historical cleanup identity captured by the aggregate.
 */

/// <reference types="vitest/globals" />

import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { ExceptionKind } from 'src/shared/exception';

describe('User profile updates', () => {
    const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
    const previous = 'c116ffde-c006-4b3f-902c-e658d6ad4142';
    const next = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';

    it.each(['registration', 'pending', 'permanent'] as const)(
        'captures the previous %s identity before accepting the next avatar',
        (kind) => {
            const user = User.reconstitute({
                ...User.create({
                    id,
                    email: 'profile@example.test',
                    name: 'User',
                    password: 'hash',
                    avatarKey: buildUserPendingAvatarKey(id, id),
                }).toSnapshot(),
                activationId: null,
                activationExpiresAt: null,
                activationRevocationVersion: null,
                avatarKey:
                    kind === 'registration'
                        ? buildUserPendingAvatarKey(id, id)
                        : kind === 'pending'
                          ? buildUserPendingAvatarKey(id, previous)
                          : buildUserPermanentAvatarKey(id, previous),
            });
            expect(
                user.update(undefined, {
                    fileKey: buildUserPendingAvatarKey(id, next),
                    jti: next,
                    revocationVersion: 0,
                }),
            ).toBe(true);
            expect(user.name).toBe('User');
            expect(user.pullJobs()).toEqual([
                {
                    deliveryId: next,
                    aggregateId: id,
                    queueName: UserJobQueue.AVATAR_REPLACE,
                    payload: { previousAvatarId: kind === 'registration' ? id : previous },
                },
                {
                    deliveryId: expect.any(String) as string,
                    aggregateId: id,
                    queueName: UserJobQueue.CACHE_INVALIDATE,
                },
            ]);
            expect(user.sessionVersion).toBe(0);
            expect(user.revocationVersion).toBe(0);
        },
    );

    it.each(['revoked', 'invalid-key', 'replay', 'banned'] as const)(
        'rejects %s without partial name mutation or jobs',
        (scenario) => {
            const user = User.reconstitute({
                ...User.create({
                    id,
                    email: 'profile@example.test',
                    name: 'User',
                    password: 'hash',
                    avatarKey: buildUserPendingAvatarKey(id, id),
                }).toSnapshot(),
                activationId: null,
                activationExpiresAt: null,
                activationRevocationVersion: null,
                avatarKey: buildUserPermanentAvatarKey(id, scenario === 'replay' ? next : previous),
                isBanned: scenario === 'banned',
            });
            const before = user.toSnapshot();
            expect(() =>
                user.update('Changed', {
                    fileKey: scenario === 'invalid-key' ? 'wrong' : buildUserPendingAvatarKey(id, next),
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
            expect(user.toSnapshot()).toEqual(before);
            expect(user.pullJobs()).toEqual([]);
        },
    );
    it('evicts the permanent transition once and makes repeated finalization a no-op', () => {
        const user = User.reconstitute({
            ...User.create({
                id,
                email: 'profile@example.test',
                name: 'User',
                password: 'hash',
                avatarKey: buildUserPendingAvatarKey(id, id),
            }).toSnapshot(),
            activationId: null,
            activationExpiresAt: null,
            activationRevocationVersion: null,
        });
        const source = buildUserPendingAvatarKey(id, next);
        const destination = buildUserPermanentAvatarKey(id, next);
        user.update(undefined, { fileKey: source, jti: next, revocationVersion: 0 });
        user.pullJobs();
        expect(user.finalizeAvatar(source, destination, next)).toBe(true);
        expect(user.pullJobs()).toEqual([
            {
                deliveryId: expect.any(String) as string,
                aggregateId: id,
                queueName: UserJobQueue.CACHE_INVALIDATE,
            },
        ]);
        const committed = user.toSnapshot();
        expect(user.finalizeAvatar(source, destination, next)).toBe(false);
        expect(user.toSnapshot()).toEqual(committed);
        expect(user.pullJobs()).toEqual([]);
    });
});
