/**
 * @file avatar-delivery.spec.ts
 * @description Verifies avatar delivery states and preservation of selected or in-flight objects.
 */

/// <reference types="vitest/globals" />

import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { AvatarDeliveryState } from 'src/shared/domain/avatar';

describe('User avatar delivery queries', () => {
    const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
    const avatarId = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';
    const pendingKey = buildUserPendingAvatarKey(id, avatarId);
    const permanentKey = buildUserPermanentAvatarKey(id, avatarId);

    it.each([
        { selectedKey: pendingKey, state: AvatarDeliveryState.PENDING, obsoleteKeys: [] },
        { selectedKey: permanentKey, state: AvatarDeliveryState.FINALIZED, obsoleteKeys: [pendingKey] },
        {
            selectedKey: buildUserPendingAvatarKey(id, id),
            state: AvatarDeliveryState.SUPERSEDED,
            obsoleteKeys: [pendingKey, permanentKey],
        },
        {
            selectedKey: buildUserPermanentAvatarKey(id, id),
            state: AvatarDeliveryState.SUPERSEDED,
            obsoleteKeys: [pendingKey, permanentKey],
        },
    ])('reports $state and protects selected objects without mutation', ({ selectedKey, state, obsoleteKeys }) => {
        const user = User.reconstitute({
            ...User.create({
                id,
                email: 'avatar@example.test',
                name: 'User',
                password: 'hash',
                avatarKey: buildUserPendingAvatarKey(id, id),
            }).toSnapshot(),
            avatarKey: selectedKey,
        });
        const before = user.toSnapshot();

        expect(user.getAvatarDeliveryState(avatarId)).toBe(state);
        expect(user.getObsoleteAvatarKeys(avatarId)).toEqual(obsoleteKeys);
        expect(user.toSnapshot()).toEqual(before);
        expect(user.pullJobs()).toEqual([]);
    });
});
