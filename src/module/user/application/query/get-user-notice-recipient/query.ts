/**
 * @file query.ts
 * @description Defines the contact details required for a user notice.
 */

/**
 * Contact details used to address a user notice.
 */
export type GetUserNoticeRecipientResult = {
    /**
     * Address to which the notice is sent.
     */
    readonly email: string;

    /**
     * Display name used to address the notice.
     */
    readonly name: string;
};
