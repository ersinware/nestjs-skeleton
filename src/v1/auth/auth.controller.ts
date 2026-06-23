/**
 * @file auth.controller.ts
 * @description Controller handling all public and session-based authentication actions.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { AccessTokenPayloadDecorator } from 'src/common/decorator/auth/access-token-payload.decorator';
import { ApiDefaultBadRequestResponse } from 'src/common/decorator/doc/api-default-bad-request-response.decorator';
import { BadRequestType } from 'src/common/enum/error/bad-request-type.enum';
import { ApiDefaultInternalServerErrorResponse } from 'src/common/decorator/doc/api-default-internal-server-error-response.decorator';
import { ApiDefaultUnauthorizedResponse } from 'src/common/decorator/doc/api-default-unauthorized-response.decorator';
import { UnauthorizedType } from 'src/common/enum/error/unauthorized-type.enum';
import { Public } from 'src/common/decorator/auth/public.decorator';
import { CriticalThrottle } from 'src/throttle/decorator/critical-throttle.decorator';
import type { AccessTokenPayload } from 'src/common/guard/interface/auth.interface';
import { NotEmptyBodyPipe } from 'src/common/pipe/not-empty-body.pipe';
import { AuthService } from './auth.service';
import { GetAuthTokensDto } from './dto/get-auth-tokens.dto';
import { PostAuthLoginDto } from './dto/post-auth-login.dto';
import { PostAuthRefreshDto } from './dto/post-auth-refresh.dto';

/**
 * Controller handling session lifecycle endpoints.
 */
@Controller({
    path: 'auth',
    version: '1',
})
@ApiTags('auth')
@ApiDefaultInternalServerErrorResponse()
export class AuthController {
    /**
     * Creates an instance of AuthController.
     *
     * @param authService Authentication business logic service.
     */
    constructor(private readonly authService: AuthService) {}

    /**
     * Authenticates user credentials.
     *
     * @param dto User login credentials.
     * @returns Access and refresh token pair.
     */
    @Public()
    @CriticalThrottle()
    @Post('user/login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Authenticate user',
        description: 'Validates credentials and issues a JWT access and refresh token pair for a user.',
    })
    @ApiOkResponse({ description: 'Successfully authenticated.', type: GetAuthTokensDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.CREDENTIALS)
    async loginUser(@Body(NotEmptyBodyPipe) dto: PostAuthLoginDto): Promise<GetAuthTokensDto> {
        return plainToInstance(GetAuthTokensDto, await this.authService.loginUser(dto));
    }

    /**
     * Authenticates admin credentials.
     *
     * @param dto Admin login credentials.
     * @returns Access and refresh token pair.
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
    @ApiOkResponse({ description: 'Successfully authenticated.', type: GetAuthTokensDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.CREDENTIALS)
    async loginAdmin(@Body(NotEmptyBodyPipe) dto: PostAuthLoginDto): Promise<GetAuthTokensDto> {
        return plainToInstance(GetAuthTokensDto, await this.authService.loginAdmin(dto));
    }

    /**
     * Rotates access and refresh tokens.
     *
     * @param dto Token rotation refresh payload.
     * @returns A fresh access and refresh token pair.
     */
    @Public()
    @CriticalThrottle()
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Refresh session tokens',
        description: 'Exchanges a valid refresh token for a new access and refresh token pair.',
    })
    @ApiOkResponse({ description: 'Tokens rotated successfully.', type: GetAuthTokensDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
    async refresh(@Body(NotEmptyBodyPipe) dto: PostAuthRefreshDto): Promise<GetAuthTokensDto> {
        return plainToInstance(GetAuthTokensDto, await this.authService.refresh(dto));
    }

    /**
     * Terminate the current user session.
     *
     * @param dto Refresh token payload.
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
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
    async logout(@Body(NotEmptyBodyPipe) dto: PostAuthRefreshDto) {
        await this.authService.logout(dto);
    }

    /**
     * Terminate all active sessions for the current user across all devices.
     *
     * @param accessTokenPayload Currently authenticated access token payload.
     */
    @Post('logout-all')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Logout from all devices',
        description: 'Revokes all active sessions for the current principal and blocklists the access token.',
    })
    @ApiNoContentResponse({ description: 'Successfully logged out from all devices.' })
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
    async logoutAll(@AccessTokenPayloadDecorator() accessTokenPayload: AccessTokenPayload) {
        await this.authService.logoutAll(accessTokenPayload.role, accessTokenPayload.sub);
        await this.authService.ban(accessTokenPayload.role, accessTokenPayload.sub);
    }
}
