/**
 * @file auth.controller.ts
 * @description Exposes the session lifecycle endpoints: login, token refresh, and logout.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiExtraModels,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    getSchemaPath,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/core/config';
import { CommandPipeline } from 'src/core/cqrs';
import {
    ApiDefaultDependencyUnavailableResponse,
    ApiDefaultInternalServerErrorResponse,
    ApiDefaultInvalidRequestResponse,
    ApiDefaultResourceConflictResponse,
    ApiDefaultUnauthenticatedResponse,
} from 'src/core/doc';
import { RequestValidationMessage } from 'src/core/http';
import { Authenticated, CurrentPrincipal, Public } from 'src/core/security/auth';
import { SessionOutcome } from 'src/core/security/session';
import { LoginAdminCommand } from 'src/module/auth/application/command/login-admin/command';
import { LoginUserCommand } from 'src/module/auth/application/command/login-user/command';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';
import { LogoutCommand } from 'src/module/auth/application/command/logout/command';
import {
    RefreshTokensCommand,
    RefreshTokensRejectionMessage,
} from 'src/module/auth/application/command/refresh-tokens/command';
import { PostLoginDto } from 'src/module/auth/presentation/dto/post-login.dto';
import { PostRefreshDto } from 'src/module/auth/presentation/dto/post-refresh.dto';
import { ResponseTokensDto } from 'src/module/auth/presentation/dto/response-tokens.dto';
import {
    ResponseUserLoginActivationRequiredDto,
    ResponseUserLoginSessionDto,
} from 'src/module/auth/presentation/dto/response-user-login.dto';
import type { Principal } from 'src/shared/domain/principal';
import { UnauthenticatedMessage } from 'src/shared/exception';

/**
 * Controller for the session lifecycle: issuing, rotating, and revoking JWT token pairs.
 */
@Controller({
    path: 'auth',
    version: VERSION_1,
})
@ApiTags('auth')
@ApiDefaultInternalServerErrorResponse()
@ApiDefaultDependencyUnavailableResponse()
export class AuthController {
    /**
     * Initializes the controller with the command pipeline to dispatch authentication commands.
     *
     * @param commandPipeline The CQRS command pipeline (invalidation behavior applies)
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Authenticates a user's credentials and opens a session.
     *
     * @param dto The user's email and password
     * @returns A new session with tokens, or an activation-required outcome without tokens
     * @throws {UnauthenticatedException} When credentials are invalid, the account is inactive, or session registration is superseded.
     * @throws {DependencyUnavailableException} When identity lookup, session registration, or audit persistence is unavailable
     */
    @Public()
    @Post('user/login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Authenticate user',
        description: 'Validates user credentials and opens a session only for activated accounts.',
    })
    @ApiExtraModels(ResponseUserLoginSessionDto, ResponseUserLoginActivationRequiredDto)
    @ApiOkResponse({
        description: 'Authenticated or awaiting account activation.',
        schema: {
            type: 'object',
            oneOf: [
                { $ref: getSchemaPath(ResponseUserLoginSessionDto) },
                { $ref: getSchemaPath(ResponseUserLoginActivationRequiredDto) },
            ],
            discriminator: {
                propertyName: 'session',
                mapping: {
                    [SessionOutcome.CREATED]: getSchemaPath(ResponseUserLoginSessionDto),
                    [SessionOutcome.ACTIVATION_REQUIRED]: getSchemaPath(ResponseUserLoginActivationRequiredDto),
                },
            },
        },
    })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse(UnauthenticatedMessage.CREDENTIALS)
    async loginUser(
        @Body() dto: PostLoginDto,
    ): Promise<ResponseUserLoginSessionDto | ResponseUserLoginActivationRequiredDto> {
        const result = await this.commandPipeline.execute(new LoginUserCommand(dto.email, dto.password));

        return result.session === SessionOutcome.CREATED
            ? plainToInstance(ResponseUserLoginSessionDto, result)
            : plainToInstance(ResponseUserLoginActivationRequiredDto, result);
    }

    /**
     * Authenticates an admin's credentials and opens a session.
     *
     * @param dto The admin's email and password
     * @returns The generated access and refresh token pair
     * @throws {UnauthenticatedException} When credentials are invalid, the account is inactive, or session registration is superseded.
     * @throws {DependencyUnavailableException} When identity lookup, session registration, or audit persistence is unavailable
     */
    @Public()
    @Post('admin/login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Authenticate admin',
        description: 'Validates admin credentials and issues a JWT access and refresh token pair.',
    })
    @ApiOkResponse({ description: 'Successfully authenticated.', type: ResponseTokensDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse(UnauthenticatedMessage.CREDENTIALS)
    async loginAdmin(@Body() dto: PostLoginDto): Promise<ResponseTokensDto> {
        return plainToInstance(
            ResponseTokensDto,
            await this.commandPipeline.execute(new LoginAdminCommand(dto.email, dto.password)),
        );
    }

    /**
     * Exchanges a valid refresh token for a new token pair, invalidating the old refresh token.
     *
     * @param dto The refresh token being rotated away
     * @returns The newly generated access and refresh token pair
     * @throws {UnauthenticatedException} When the token is invalid, the account is inactive, the session was superseded, or refresh-token reuse is detected.
     * @throws {ResourceConflictException} When the token was already rotated within grace; the client needs the latest token pair.
     * @throws {DependencyUnavailableException} When identity lookup, session rotation, job persistence, or audit persistence is unavailable.
     * @throws {SystemException} When rotation returns an unsupported outcome or the remediation job is not accepted
     */
    @Public()
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Refresh session tokens',
        description:
            'Exchanges a valid refresh token for a new access and refresh token pair, invalidating the old refresh token.',
    })
    @ApiOkResponse({ description: 'Tokens rotated successfully.', type: ResponseTokensDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultResourceConflictResponse(RefreshTokensRejectionMessage.CONCURRENT_REFRESH)
    async refresh(@Body() dto: PostRefreshDto): Promise<ResponseTokensDto> {
        return plainToInstance(
            ResponseTokensDto,
            await this.commandPipeline.execute(new RefreshTokensCommand(dto.refreshToken)),
        );
    }

    /**
     * Closes the session identified by a signed refresh credential, even after rotation or credential expiry.
     *
     * @param dto Refresh credential identifying the session; no access token is required.
     * @throws {DependencyUnavailableException} When session closure or audit persistence is unavailable
     */
    @Post('logout')
    @Public()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Log out a session',
        description:
            'Closes the refresh token session, including its access tokens. Accepts an expired refresh credential within the absolute session lifetime. Invalid or already-closed credentials return 204. No access token is required.',
    })
    @ApiNoContentResponse({ description: 'Logout processed; discard local credentials.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    async logout(@Body() dto: PostRefreshDto) {
        await this.commandPipeline.execute(new LogoutCommand(dto.refreshToken));
    }

    /**
     * Commits an account-wide revocation request; the owning context revokes sessions asynchronously.
     *
     * @param principal The verified principal of the current request
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the revocation job is not accepted
     */
    @Post('logout-all')
    @Authenticated()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Log out all sessions',
        description:
            'Commits an account-wide revocation request and its audit record. The owning context processes it asynchronously; this response does not guarantee that all sessions are already revoked.',
    })
    @ApiNoContentResponse({ description: 'Session revocation request and audit record committed.' })
    @ApiDefaultUnauthenticatedResponse()
    async logoutAll(@CurrentPrincipal() principal: Principal) {
        await this.commandPipeline.execute(new LogoutAllCommand(principal.id, principal.type));
    }
}
