/**
 * @file avatar-delivery.spec.ts
 * @description Verifies avatar delivery states and preservation of selected or in-flight objects.
 */

/// <reference types="vitest/globals" />

import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AvatarDeliveryState } from 'src/shared/domain/avatar';

describe('Admin avatar delivery queries', () => {
    const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
    const avatarId = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';
    const pendingKey = buildAdminPendingAvatarKey(id, avatarId);
    const permanentKey = buildAdminPermanentAvatarKey(id, avatarId);

    it.each([
        { selectedKey: null, state: AvatarDeliveryState.MISSING, obsoleteKeys: [pendingKey, permanentKey] },
        { selectedKey: pendingKey, state: AvatarDeliveryState.PENDING, obsoleteKeys: [] },
        { selectedKey: permanentKey, state: AvatarDeliveryState.FINALIZED, obsoleteKeys: [pendingKey] },
        {
            selectedKey: buildAdminPendingAvatarKey(id, id),
            state: AvatarDeliveryState.SUPERSEDED,
            obsoleteKeys: [pendingKey, permanentKey],
        },
        {
            selectedKey: buildAdminPermanentAvatarKey(id, id),
            state: AvatarDeliveryState.SUPERSEDED,
            obsoleteKeys: [pendingKey, permanentKey],
        },
    ])('reports $state and protects selected objects without mutation', ({ selectedKey, state, obsoleteKeys }) => {
        const admin = Admin.reconstitute({
            ...Admin.create({ id, email: 'avatar@example.test', name: 'Admin' }).toSnapshot(),
            password: 'hash',
            inviteId: null,
            inviteExpiresAt: null,
            inviteRevocationVersion: null,
            avatarKey: selectedKey,
        });
        const before = admin.toSnapshot();

        expect(admin.getAvatarDeliveryState(avatarId)).toBe(state);
        expect(admin.getObsoleteAvatarKeys(avatarId)).toEqual(obsoleteKeys);
        expect(admin.toSnapshot()).toEqual(before);
        expect(admin.pullJobs()).toEqual([]);
    });
});
