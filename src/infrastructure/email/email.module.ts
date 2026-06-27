/**
 * @file email.module.ts
 * @description NestJS module configuring the BullMQ email queue, workers, and Gmail APIs.
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailProcessor } from './processor/email.processor';
import { EmailService } from './service/email.service';
import { GmailService } from './service/gmail.service';
import { TOKEN_EMAIL_SERVICE, TOKEN_MAILER_SERVICE } from 'src/common/port/email/email.constant';
import { QUEUE_EMAIL } from 'src/common/port/email/email.constant';

/**
 * Module responsible for configuring background queues and email integrations.
 */
@Module({
    imports: [
        BullModule.registerQueue({
            name: QUEUE_EMAIL,
        }),
    ],
    providers: [
        EmailProcessor,
        {
            provide: TOKEN_EMAIL_SERVICE,
            useClass: EmailService,
        },
        {
            provide: TOKEN_MAILER_SERVICE,
            useClass: GmailService,
        },
    ],
    exports: [TOKEN_EMAIL_SERVICE],
})
export class EmailModule {}
