/**
 * @file email.module.ts
 * @description NestJS module configuring the BullMQ email queue, workers, and Gmail APIs.
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAME_EMAIL, TOKEN_EMAIL_SERVICE } from './constant/email.constant';
import { EmailProcessor } from './processor/email.processor';
import { EmailService } from './service/email.service';
import { GmailService } from './service/gmail.service';

/**
 * Module responsible for configuring background queues and email integrations.
 */
@Module({
    imports: [
        BullModule.registerQueue({
            name: QUEUE_NAME_EMAIL,
        }),
    ],
    providers: [
        GmailService,
        EmailProcessor,
        {
            provide: TOKEN_EMAIL_SERVICE,
            useClass: EmailService,
        },
    ],
    exports: [TOKEN_EMAIL_SERVICE],
})
export class EmailModule {}
