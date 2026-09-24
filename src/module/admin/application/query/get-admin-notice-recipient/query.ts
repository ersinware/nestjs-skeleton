/**
 * @file query.ts
 * @description Defines the contact details required for an admin notice.
 */

/**
 * Contact details used to address an admin notice.
 */
export type GetAdminNoticeRecipientResult = {
    /**
     * Address to which the notice is sent.
     */
    readonly email: string;

    /**
     * Display name used to address the notice.
     */
    readonly name: string;
};
