/**
 * @file index.ts
 * @description Public account avatar file contracts.
 */

export {
    AVATAR_PENDING_CACHE_POLICY,
    AVATAR_PERMANENT_CACHE_POLICY,
} from 'src/shared/domain/avatar/avatar-cache-policy';
export { AvatarDeliveryState } from 'src/shared/domain/avatar/avatar-delivery-state.enum';
export {
    AVATAR_CONTENT_TYPES,
    AVATAR_MAX_SIZE_BYTES,
    assertAvatarUploadMatchesDescriptor,
} from 'src/shared/domain/avatar/avatar-upload';
export type { AvatarContentType, AvatarUploadDescriptor } from 'src/shared/domain/avatar/avatar-upload';
