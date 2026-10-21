/**
 * @file avatar-delivery-state.enum.ts
 * @description Describes an account's selected avatar relative to a delivery identity.
 */

/**
 * Domain states used to reconcile repeated avatar deliveries.
 */
export enum AvatarDeliveryState {
    /**
     * The account has no attached avatar.
     */
    MISSING = 'missing',

    /**
     * The delivery's pending avatar is selected.
     */
    PENDING = 'pending',

    /**
     * The delivery's permanent avatar is selected.
     */
    FINALIZED = 'finalized',

    /**
     * Another avatar is selected instead of this delivery's avatar.
     */
    SUPERSEDED = 'superseded',
}
