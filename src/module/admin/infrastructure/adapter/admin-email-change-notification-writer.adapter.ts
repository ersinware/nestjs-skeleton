/**
 * @file admin-email-change-notification-writer.adapter.ts
 * @description Inserts immutable email-change recipients through the primary transaction executor.
 */

import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import type {
    AdminEmailChangeNotification,
    IAdminEmailChangeNotificationWriterPort,
} from 'src/module/admin/application/command/port/admin-email-change-notification-writer.port';
import { emailChangeNotification } from 'src/module/admin/infrastructure/admin.schema';

/**
 * Preserves each change's original recipient independently of later account changes or deletion.
 */
@Injectable()
export class AdminEmailChangeNotificationWriterAdapter implements IAdminEmailChangeNotificationWriterPort {
    /**
     * Uses the primary proxy so inserts join the caller's transaction.
     *
     * @param database Primary database executor
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase) {}

    /**
     * Inserts the recipient once without overwriting existing delivery evidence.
     *
     * @param notification Recipient evidence captured before the email mutation
     */
    async save(notification: AdminEmailChangeNotification) {
        try {
            await this.database.insert(emailChangeNotification).values(notification);
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
