/**
 * @file token.port.ts
 * @description Generic port contract for signing and verifying typed JWT payloads.
 */

/**
 * Base shape shared by all typed token payloads.
 */
export type TokenPayload<TType extends string = string> = {
    /**
     * Discriminator naming the token contract that produced the payload.
     */
    readonly type: TType;
};

/**
 * Optional verification controls supported by {@link ITokenPort.verify}.
 */
export type TokenVerifyOptions = {
    /**
     * Defers JWT expiration checks when an expired credential still identifies a recoverable operation.
     */
    readonly ignoreExpiration?: boolean;
};

/**
 * Generic contract for signing and verifying JWT payloads bound to a dedicated secret and type discriminator.
 */
export interface ITokenPort<TType extends string = string> {
    /**
     * Signs caller-supplied claims and attaches the token type discriminator.
     *
     * @param type Token type discriminator to stamp into the signed payload.
     * @param payload Token claims without the `type` discriminator.
     * @returns Signed compact JWT string.
     */
    sign<TPayload extends TokenPayload<TType>>(
        type: TPayload['type'],
        payload: Omit<TPayload, 'type'>,
    ): Promise<string>;

    /**
     * Verifies the JWT signature, pinned algorithm, optional expiration, and expected type discriminator.
     *
     * @param token Compact JWT string to verify.
     * @param expectedType Expected `type` claim discriminator.
     * @param options Optional verification flags.
     * @returns Verified token payload cast to the caller's typed contract.
     * @throws {UnauthenticatedException} When signature, lifetime, or type verification fails.
     */
    verify<TPayload extends TokenPayload<TType>>(
        token: string,
        expectedType: TPayload['type'],
        options?: TokenVerifyOptions,
    ): Promise<TPayload>;
}
