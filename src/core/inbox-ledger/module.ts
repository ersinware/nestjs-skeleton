/**
 * @file module.ts
 * @description Inbox ledger module that provides consumer-side idempotency (the inbox pattern)
 * globally, so any listener can guard its side effects against duplicate delivery.
 */

import { Global, Module } from '@nestjs/common';
import { InboxLedgerAdapter } from 'src/core/inbox-ledger/adapter';
import { TOKEN_INBOX_LEDGER_PORT } from 'src/core/inbox-ledger/port';
import { InboxLedgerPruneCron } from 'src/core/inbox-ledger/prune.cron';

@Global()
@Module({
    providers: [
        InboxLedgerPruneCron,
        {
            provide: TOKEN_INBOX_LEDGER_PORT,
            useClass: InboxLedgerAdapter,
        },
    ],
    exports: [TOKEN_INBOX_LEDGER_PORT],
})
export class InboxLedgerModule {}
