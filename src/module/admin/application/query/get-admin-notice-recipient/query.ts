/**
 * @file query.ts
 * @description Defines the contact details required for an admin notice.
 */

/**
 * Contact details used to address an admin notice.
 */
export type GetAdminNoticeRecipientResult = {
    readonly email: string;
    readonly name: string;
};
