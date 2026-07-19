/**
 * @file auth.controller.ts
 * @description Exposes HTTP endpoints for handling authentication workflows including login, token rotation, and logout. Most routes here are public or rely on specific security decorators to manage their own access control.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/core/config';
import {
    ApiDefaultInternalServerErrorResponse,
    ApiDefaultInvalidRequestResponse,
    ApiDefaultResourceConflictResponse,
    ApiDefaultTooManyRequestsResponse,
    ApiDefaultUnauthenticatedResponse,
} from 'src/core/doc';
import { NotEmptyBodyPipe } from 'src/core/http';
import { AccessTokenPayloadDecorator, Public } from 'src/core/security/auth';
import { CriticalThrottle } from 'src/core/security/throttle';
import type { AccessTokenPayload } from 'src/core/security/token';
import { LoginAdminCommand, type LoginAdminResult } from 'src/module/auth/application/command/login-admin/command';
import { LoginUserCommand, type LoginUserResult } from 'src/module/auth/application/command/login-user/command';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';
import { LogoutCommand } from 'src/module/auth/application/command/logout/command';
import {
    RefreshTokensCommand,
    RefreshTokensMessage,
    type RefreshTokensResult,
} from 'src/module/auth/application/command/refresh-tokens/command';
import { PostLoginDto } from 'src/module/auth/presentation/dto/post-login.dto';
import { PostRefreshDto } from 'src/module/auth/presentation/dto/post-refresh.dto';
import { ResponseTokensDto } from 'src/module/auth/presentation/dto/response-tokens.dto';
import { InvalidInputMessage, UnauthenticatedMessage } from 'src/shared/exception';

/**
 * The controller handling session lifecycle endpoints.
 * Provides routes for issuing, refreshing, and revoking JWT-based access and refresh tokens.
 */
@Controller({
    path: 'auth',
    version: VERSION_1,
})
@ApiTags('auth')
@ApiDefaultInternalServerErrorResponse()
@ApiDefaultTooManyRequestsResponse()
export class AuthController {
    /**
     * Initializes the controller with the command bus to dispatch authentication commands.
     *
     * @param commandBus The CQRS command bus
     */
    constructor(private readonly commandBus: CommandBus) {}

    /**
     * Authenticates standard user credentials and initializes a secure session.
     * If successful, it issues a pair of JWT tokens (access and refresh) to maintain statefulness on the client.
     *
     * @param dto The payload containing the user's email and password
     * @returns The generated access and refresh token pair
     * @throws {InvalidInputException} If the payload is invalid
     * @throws {UnauthenticatedException} If the credentials are invalid or the account is inactive
     */
    @Public()
    @CriticalThrottle()
    @Post('user/login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Authenticate user',
        description: 'Validates credentials and issues a JWT access and refresh token pair for a user.',
    })
    @ApiOkResponse({ description: 'Successfully authenticated.', type: ResponseTokensDto })
    @ApiDefaultInvalidRequestResponse(InvalidInputMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse(UnauthenticatedMessage.CREDENTIALS)
    async loginUser(@Body(NotEmptyBodyPipe) dto: PostLoginDto): Promise<ResponseTokensDto> {
        return plainToInstance(
            ResponseTokensDto,
            await this.commandBus.execute<LoginUserCommand, LoginUserResult>(
                new LoginUserCommand(dto.email, dto.password),
            ),
        );
    }

    /**
     * Authenticates administrative credentials and initializes a secure high-privilege session.
     * Identical in flow to user login but accesses the admin domain to verify roles and permissions.
     *
     * @param dto The payload containing the admin's email and password
     * @returns The generated access and refresh token pair
     * @throws {InvalidInputException} If the payload is invalid
     * @throws {UnauthenticatedException} If the credentials are invalid or the account is inactive
     */
    @Public()
    @CriticalThrottle()
    @Post('admin/login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Authenticate admin',
        description:
            'Validates administrative credentials and issues a JWT access and refresh token pair for an admin.',
    })
    @ApiOkResponse({ description: 'Successfully authenticated.', type: ResponseTokensDto })
    @ApiDefaultInvalidRequestResponse(InvalidInputMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse(UnauthenticatedMessage.CREDENTIALS)
    async loginAdmin(@Body(NotEmptyBodyPipe) dto: PostLoginDto): Promise<ResponseTokensDto> {
        return plainToInstance(
            ResponseTokensDto,
            await this.commandBus.execute<LoginAdminCommand, LoginAdminResult>(
                new LoginAdminCommand(dto.email, dto.password),
            ),
        );
    }

    /**
     * Rotates an active refresh token to issue a fresh access and refresh token pair.
     * Crucial for maintaining continuous access without requiring the user to re-enter credentials, while also invalidating the old refresh token to prevent reuse.
     *
     * @param dto The payload containing the current valid refresh token
     * @returns The newly generated access and refresh token pair
     * @throws {InvalidInputException} If the payload is invalid
     * @throws {UnauthenticatedException} If the refresh token is invalid or expired
     * @throws {ResourceConflictException} If a concurrent refresh already rotated the session; retry with the latest token pair
     */
    @Public()
    @CriticalThrottle()
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Refresh session tokens',
        description: 'Exchanges a valid refresh token for a new access and refresh token pair.',
    })
    @ApiOkResponse({ description: 'Tokens rotated successfully.', type: ResponseTokensDto })
    @ApiDefaultInvalidRequestResponse(InvalidInputMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultResourceConflictResponse(RefreshTokensMessage.CONCURRENT_REFRESH)
    async refresh(@Body(NotEmptyBodyPipe) dto: PostRefreshDto): Promise<ResponseTokensDto> {
        return plainToInstance(
            ResponseTokensDto,
            await this.commandBus.execute<RefreshTokensCommand, RefreshTokensResult>(
                new RefreshTokensCommand(dto.refreshToken),
            ),
        );
    }

    /**
     * Terminates the current active session.
     * Invalidates the provided refresh token in the backend cache to ensure it can no longer be used to generate new access tokens.
     *
     * @param dto The payload containing the refresh token to invalidate
     * @throws {InvalidInputException} If the payload is invalid
     * @throws {UnauthenticatedException} If the user is not authenticated
     */
    @Post('logout')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Logout from current device',
        description: 'Invalidates the current session by removing its refresh token from the cache.',
    })
    @ApiNoContentResponse({ description: 'Successfully logged out.' })
    @ApiDefaultInvalidRequestResponse(InvalidInputMessage.PAYLOAD)
    @ApiDefaultUnauthenticatedResponse()
    async logout(@Body(NotEmptyBodyPipe) dto: PostRefreshDto) {
        await this.commandBus.execute<LogoutCommand>(new LogoutCommand(dto.refreshToken));
    }

    /**
     * Terminates all active refresh sessions for the authenticated principal across all devices.
     * Useful for security breaches or password resets, ensuring no device can mint new tokens.
     *
     * @param accessTokenPayload The decoded payload of the currently authenticated request
     * @throws {UnauthenticatedException} If the user is not authenticated
     */
    @Post('logout-all')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Logout from all devices',
        description: 'Revokes all active refresh sessions for the current principal.',
    })
    @ApiNoContentResponse({ description: 'Successfully logged out from all devices.' })
    @ApiDefaultUnauthenticatedResponse()
    async logoutAll(@AccessTokenPayloadDecorator() accessTokenPayload: AccessTokenPayload) {
        await this.commandBus.execute<LogoutAllCommand>(new LogoutAllCommand(accessTokenPayload.sub));
    }
}
