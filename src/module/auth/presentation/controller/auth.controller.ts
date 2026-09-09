/**
 * @file auth.controller.ts
 * @description Exposes the session lifecycle endpoints: login, token refresh, and logout.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { CurrentPrincipal, Public } from 'src/core/security/auth';
import { LoginAdminCommand } from 'src/module/auth/application/command/login-admin/command';
import { LoginUserCommand } from 'src/module/auth/application/command/login-user/command';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';
import { LogoutCommand } from 'src/module/auth/application/command/logout/command';
import { RefreshTokensCommand, RefreshTokensMessage } from 'src/module/auth/application/command/refresh-tokens/command';
import { PostLoginDto } from 'src/module/auth/presentation/dto/post-login.dto';
import { PostRefreshDto } from 'src/module/auth/presentation/dto/post-refresh.dto';
import { ResponseTokensDto } from 'src/module/auth/presentation/dto/response-tokens.dto';
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
     * @returns The generated access and refresh token pair
     * @throws {InvalidInputException} If the payload is invalid
     * @throws {UnauthenticatedException} If the credentials are invalid or the account is inactive
     */
    @Public()
    @Post('user/login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Authenticate user',
        description: 'Validates user credentials and issues a JWT access and refresh token pair.',
    })
    @ApiOkResponse({ description: 'Successfully authenticated.', type: ResponseTokensDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse(UnauthenticatedMessage.CREDENTIALS)
    async loginUser(@Body() dto: PostLoginDto): Promise<ResponseTokensDto> {
        return plainToInstance(
            ResponseTokensDto,
            await this.commandPipeline.execute(new LoginUserCommand(dto.email, dto.password)),
        );
    }

    /**
     * Authenticates an admin's credentials and opens a session.
     *
     * @param dto The admin's email and password
     * @returns The generated access and refresh token pair
     * @throws {InvalidInputException} If the payload is invalid
     * @throws {UnauthenticatedException} If the credentials are invalid or the account is inactive
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
     * @throws {InvalidInputException} If the payload is invalid
     * @throws {UnauthenticatedException} If the refresh token is invalid or expired
     * @throws {ResourceConflictException} If a concurrent refresh already rotated the session; retry with the latest token pair
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
    @ApiDefaultResourceConflictResponse(RefreshTokensMessage.CONCURRENT_REFRESH)
    async refresh(@Body() dto: PostRefreshDto): Promise<ResponseTokensDto> {
        return plainToInstance(
            ResponseTokensDto,
            await this.commandPipeline.execute(new RefreshTokensCommand(dto.refreshToken)),
        );
    }

    /**
     * Revokes the session bound to the provided refresh token. Idempotent: an invalid or
     * already-revoked token still answers 204.
     *
     * @param principal The verified principal of the current request
     * @param dto The refresh token identifying the session to revoke
     * @throws {InvalidInputException} If the payload is invalid
     * @throws {UnauthenticatedException} If the user is not authenticated
     */
    @Post('logout')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Log out a session',
        description:
            'Revokes the session bound to the provided refresh token. Responds 204 even if the token is invalid or already revoked.',
    })
    @ApiNoContentResponse({ description: 'Session revoked.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    async logout(@CurrentPrincipal() principal: Principal, @Body() dto: PostRefreshDto) {
        await this.commandPipeline.execute(new LogoutCommand(dto.refreshToken, principal));
    }

    /**
     * Revokes every active session of the authenticated principal, across all devices.
     *
     * @param principal The verified principal of the current request
     * @throws {UnauthenticatedException} If the user is not authenticated
     */
    @Post('logout-all')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Log out all sessions',
        description: 'Revokes every active session of the authenticated principal, across all devices.',
    })
    @ApiNoContentResponse({ description: 'All sessions revoked.' })
    @ApiDefaultUnauthenticatedResponse()
    async logoutAll(@CurrentPrincipal() principal: Principal) {
        await this.commandPipeline.execute(new LogoutAllCommand(principal.id, principal.type));
    }
}
