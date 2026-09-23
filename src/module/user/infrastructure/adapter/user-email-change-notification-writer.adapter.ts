/**
 * @file user-email-change-notification-writer.adapter.ts
 * @description Inserts immutable email-change recipients through the primary transaction executor.
 */

import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import type {
    IUserEmailChangeNotificationWriterPort,
    UserEmailChangeNotification,
} from 'src/module/user/application/command/port/user-email-change-notification-writer.port';
import { emailChangeNotification } from 'src/module/user/infrastructure/user.schema';

/**
 * Preserves each change's original recipient independently of later account changes or deletion.
 */
@Injectable()
export class UserEmailChangeNotificationWriterAdapter implements IUserEmailChangeNotificationWriterPort {
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
    async save(notification: UserEmailChangeNotification) {
        try {
            await this.database.insert(emailChangeNotification).values(notification);
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
