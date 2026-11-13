/**
 * @file jwt-token.adapter.ts
 * @description Generic HS256 JWT adapter bound to a single dedicated secret per DI instance.
 */

import { JsonWebTokenError, JwtService } from '@nestjs/jwt';
import type { ITokenPort, TokenPayload, TokenVerifyOptions } from 'src/core/security/token/port/token.port';
import { UnauthenticatedException, UnauthenticatedMessage } from 'src/shared/exception';

/**
 * Generic JWT token adapter bound to one secret; separate DI instances isolate unrelated secrets.
 */
export class JwtTokenAdapter<TType extends string = string> implements ITokenPort<TType> {
    /**
     * Binds the adapter instance to its JWT helper and dedicated signing secret.
     *
     * @param jwtService Underlying JWT signing and verification service.
     * @param secret Dedicated HMAC-SHA256 secret owned by this instance.
     */
    constructor(
        private readonly jwtService: JwtService,
        private readonly secret: string,
    ) {}

    /**
     * Signs caller-supplied claims and injects the token type discriminator without an automatic timestamp.
     *
     * @param type Discriminator embedded in the signed JWT payload.
     * @param payload Token claims excluding the `type` discriminator.
     * @returns Signed HS256 JWT string.
     */
    async sign<TPayload extends TokenPayload<TType>>(
        type: TPayload['type'],
        payload: Omit<TPayload, 'type'>,
    ): Promise<string> {
        return this.jwtService.signAsync(
            {
                ...payload,
                type,
            },
            {
                secret: this.secret,
                algorithm: 'HS256',
                noTimestamp: true,
            },
        );
    }

    /**
     * Verifies the token signature with pinned `HS256`, enforces expiration unless bypassed, and checks `payload.type`.
     *
     * @param token Signed JWT string.
     * @param expectedType Expected `type` claim discriminator.
     * @param options Verification options controlling expiration enforcement.
     * @returns Decoded token payload matching the expected type discriminator.
     */
    async verify<TPayload extends TokenPayload<TType>>(
        token: string,
        expectedType: TPayload['type'],
        options?: TokenVerifyOptions,
    ): Promise<TPayload> {
        try {
            const payload = await this.jwtService.verifyAsync<TPayload>(token, {
                secret: this.secret,
                algorithms: ['HS256'],
                ignoreExpiration: options?.ignoreExpiration === true,
            });

            if (payload?.type !== expectedType) {
                throw new UnauthenticatedException();
            }

            return payload;
        } catch (error) {
            if (error instanceof JsonWebTokenError) {
                throw new UnauthenticatedException(UnauthenticatedMessage.DEFAULT, { cause: error });
            }

            throw error;
        }
    }
}
