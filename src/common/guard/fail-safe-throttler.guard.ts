import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerRequest, ThrottlerException } from '@nestjs/throttler';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';

@Injectable()
export class FailSafeThrottlerGuard extends ThrottlerGuard {
    constructor(
        options: ThrottlerModuleOptions,
        storageService: ThrottlerStorage,
        reflector: Reflector,
        private readonly configService: ConfigService,
    ) {
        super(options, storageService, reflector);
    }

    protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
        if (this.configService.get<string>('NODE_ENV') === 'test') {
            return true;
        }

        try {
            return await super.handleRequest(requestProps);
        } catch (error) {
            if (error instanceof ThrottlerException) {
                throw error;
            }

            console.error(`Throttler storage error, failing open: ${(error as Error).message}`);

            return true;
        }
    }
}
