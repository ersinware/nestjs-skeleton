/**
 * @file query.ts
 * @description Defines the contact details required for a user notice.
 */

/**
 * Contact details used to address a user notice.
 */
export type GetUserNoticeRecipientResult = {
    readonly email: string;
    readonly name: string;
};
