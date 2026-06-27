/**
 * @file auth.controller.ts
 * @description Exposes HTTP endpoints for handling authentication workflows including login, token rotation, and logout. Most routes here are public or rely on specific security decorators to manage their own access control.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { ApiDefaultBadRequestResponse } from 'src/common/doc/decorator/api-default-bad-request-response.decorator';
import { ApiDefaultInternalServerErrorResponse } from 'src/common/doc/decorator/api-default-internal-server-error-response.decorator';
import { ApiDefaultTooManyRequestsResponse } from 'src/common/doc/decorator/api-default-too-many-requests-response.decorator';
import { ApiDefaultUnauthorizedResponse } from 'src/common/doc/decorator/api-default-unauthorized-response.decorator';
import { BadRequestType } from 'src/common/exception/enum/bad-request-type.enum';
import { UnauthorizedType } from 'src/common/exception/enum/unauthorized-type.enum';
import { NotEmptyBodyPipe } from 'src/common/validation/pipe/not-empty-body.pipe';
import { AccessTokenPayloadDecorator } from 'src/common/auth/decorator/access-token-payload.decorator';
import { Public } from 'src/common/auth/decorator/public.decorator';
import type { AccessTokenPayload } from 'src/common/auth/interface/access-token-payload.interface';
import { CriticalThrottle } from 'src/common/throttle/decorator/critical-throttle.decorator';
import { AuthService } from './auth.service';
import { PostAuthLoginDto } from './dto/post-auth-login.dto';
import { PostAuthRefreshDto } from './dto/post-auth-refresh.dto';
import { ResponseAuthTokensDto } from './dto/response-auth-tokens.dto';
import { VERSION_1 } from 'src/common/routing/constant/version.constant';

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
     * Injects the authentication service to execute session and credential business logic.
     *
     * @param authService The service handling core authentication operations
     */
    constructor(private readonly authService: AuthService) {}

    /**
     * Authenticates standard user credentials and initializes a secure session.
     * If successful, it issues a pair of JWT tokens (access and refresh) to maintain statefulness on the client.
     *
     * @param dto The payload containing the user's email and password
     * @returns The generated access and refresh token pair
     */
    @Public()
    @CriticalThrottle()
    @Post('user/login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Authenticate user',
        description: 'Validates credentials and issues a JWT access and refresh token pair for a user.',
    })
    @ApiOkResponse({ description: 'Successfully authenticated.', type: ResponseAuthTokensDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.CREDENTIALS)
    async loginUser(@Body(NotEmptyBodyPipe) dto: PostAuthLoginDto): Promise<ResponseAuthTokensDto> {
        return plainToInstance(ResponseAuthTokensDto, await this.authService.loginUser(dto));
    }

    /**
     * Authenticates administrative credentials and initializes a secure high-privilege session.
     * Identical in flow to user login but accesses the admin domain to verify roles and permissions.
     *
     * @param dto The payload containing the admin's email and password
     * @returns The generated access and refresh token pair
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
    @ApiOkResponse({ description: 'Successfully authenticated.', type: ResponseAuthTokensDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.CREDENTIALS)
    async loginAdmin(@Body(NotEmptyBodyPipe) dto: PostAuthLoginDto): Promise<ResponseAuthTokensDto> {
        return plainToInstance(ResponseAuthTokensDto, await this.authService.loginAdmin(dto));
    }

    /**
     * Rotates an active refresh token to issue a fresh access and refresh token pair.
     * Crucial for maintaining continuous access without requiring the user to re-enter credentials, while also invalidating the old refresh token to prevent reuse.
     *
     * @param dto The payload containing the current valid refresh token
     * @returns The newly generated access and refresh token pair
     */
    @Public()
    @CriticalThrottle()
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Refresh session tokens',
        description: 'Exchanges a valid refresh token for a new access and refresh token pair.',
    })
    @ApiOkResponse({ description: 'Tokens rotated successfully.', type: ResponseAuthTokensDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultUnauthorizedResponse()
    async refresh(@Body(NotEmptyBodyPipe) dto: PostAuthRefreshDto): Promise<ResponseAuthTokensDto> {
        return plainToInstance(ResponseAuthTokensDto, await this.authService.refresh(dto));
    }

    /**
     * Terminates the current active session.
     * Invalidates the provided refresh token in the backend cache to ensure it can no longer be used to generate new access tokens.
     *
     * @param dto The payload containing the refresh token to invalidate
     */
    @Post('logout')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Logout from current device',
        description: 'Invalidates the current session by removing its refresh token from the cache.',
    })
    @ApiNoContentResponse({ description: 'Successfully logged out.' })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultUnauthorizedResponse()
    async logout(@Body(NotEmptyBodyPipe) dto: PostAuthRefreshDto) {
        await this.authService.logout(dto);
    }

    /**
     * Terminates all active sessions for the authenticated principal across all devices.
     * Useful for security breaches or password resets, ensuring no rogue sessions remain active. Also blacklists the current access token.
     *
     * @param accessTokenPayload The decoded payload of the currently authenticated request
     */
    @Post('logout-all')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Logout from all devices',
        description: 'Revokes all active sessions for the current principal and blocklists the access token.',
    })
    @ApiNoContentResponse({ description: 'Successfully logged out from all devices.' })
    @ApiDefaultUnauthorizedResponse()
    async logoutAll(@AccessTokenPayloadDecorator() accessTokenPayload: AccessTokenPayload) {
        await this.authService.logoutAll(accessTokenPayload.role, accessTokenPayload.sub);
        await this.authService.ban(accessTokenPayload.role, accessTokenPayload.sub);
    }
}
