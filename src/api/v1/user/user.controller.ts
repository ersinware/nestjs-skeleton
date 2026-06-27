/**
 * @file user.controller.ts
 * @description Exposes HTTP endpoints for user profile management. Enforces role-based access control (RBAC) to ensure standard users can only modify themselves while administrators can manage all users.
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/common/routing/constant/version.constant';
import { ApiDefaultBadRequestResponse } from 'src/common/doc/decorator/api-default-bad-request-response.decorator';
import { ApiDefaultConflictResponse } from 'src/common/doc/decorator/api-default-conflict-response.decorator';
import { ApiDefaultForbiddenResponse } from 'src/common/doc/decorator/api-default-forbidden-response.decorator';
import { ApiDefaultInternalServerErrorResponse } from 'src/common/doc/decorator/api-default-internal-server-error-response.decorator';
import { ApiDefaultNotFoundResponse } from 'src/common/doc/decorator/api-default-not-found-response.decorator';
import { ApiDefaultOkResponsePaginated } from 'src/common/doc/decorator/api-default-ok-response-paginated.decorator';
import { ApiDefaultTooManyRequestsResponse } from 'src/common/doc/decorator/api-default-too-many-requests-response.decorator';
import { ApiDefaultUnauthorizedResponse } from 'src/common/doc/decorator/api-default-unauthorized-response.decorator';
import { ParamIdDto } from 'src/common/validation/dto/param-id.dto';
import { ResponsePaginationDto } from 'src/common/pagination/dto/response-pagination.dto';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { BadRequestType } from 'src/common/exception/enum/bad-request-type.enum';
import { ConflictType } from 'src/common/exception/enum/conflict-type.enum';
import { NotEmptyBodyPipe } from 'src/common/validation/pipe/not-empty-body.pipe';
import { AccessTokenPayloadDecorator } from 'src/common/auth/decorator/access-token-payload.decorator';
import { Public } from 'src/common/auth/decorator/public.decorator';
import { Roles } from 'src/common/auth/decorator/roles.decorator';
import type { AccessTokenPayload } from 'src/common/auth/interface/access-token-payload.interface';
import { CriticalThrottle } from 'src/common/throttle/decorator/critical-throttle.decorator';
import { PatchUserPasswordDto } from './dto/patch-user-password.dto';
import { PatchUserStatusDto } from './dto/patch-user-status.dto';
import { PatchUserDto } from './dto/patch-user.dto';
import { PostUserDto } from './dto/post-user.dto';
import { QuerySearchDto } from 'src/common/search/dto/query-search.dto';
import { ResponseUserDto } from './dto/response-user.dto';
import { UserService } from './user.service';

/**
 * The controller providing routing and handling for user domain API requests.
 * Maps incoming HTTP payloads to business logic operations and serializes the responses to prevent data leaks.
 */
@Controller({
    path: 'user',
    version: VERSION_1,
})
@ApiTags('user')
@ApiDefaultInternalServerErrorResponse()
@ApiDefaultTooManyRequestsResponse()
export class UserController {
    /**
     * Injects the user service to execute business logic.
     *
     * @param userService The service handling core user operations
     */
    constructor(private readonly userService: UserService) {}

    /**
     * Registers a new user account.
     * Typically public, allowing unauthenticated guests to sign up.
     *
     * @param postUserDto The payload containing registration details
     * @returns The newly created and serialized user profile
     */
    @Public()
    @CriticalThrottle()
    @Post()
    @ApiOperation({
        summary: 'Register user',
        description: 'Creates a new user profile.',
    })
    @ApiCreatedResponse({ description: 'User account successfully created.', type: ResponseUserDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultConflictResponse(ConflictType.EMAIL_IN_USE)
    async create(@Body(NotEmptyBodyPipe) postUserDto: PostUserDto): Promise<ResponseUserDto> {
        return plainToInstance(ResponseUserDto, await this.userService.create(postUserDto));
    }

    /**
     * Retrieves all registered users in a paginated format.
     * Exclusively available to administrators for back-office management.
     *
     * @param query The pagination limits and optional search parameters
     * @returns A paginated response containing a list of serialized user profiles
     */
    @Get()
    @Roles(AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get all users',
        description:
            'Retrieves registered users with pagination and optional search query. Requires administrator-level authorization.',
    })
    @ApiDefaultOkResponsePaginated({ description: 'Users successfully retrieved.', type: ResponseUserDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PARAM)
    @ApiDefaultUnauthorizedResponse()
    @ApiDefaultForbiddenResponse()
    async findAll(@Query() query: QuerySearchDto): Promise<ResponsePaginationDto<ResponseUserDto>> {
        const { data, total } = await this.userService.findAll(query);

        return new ResponsePaginationDto<ResponseUserDto>(
            plainToInstance(ResponseUserDto, data),
            total,
            query.page,
            query.limit,
        );
    }

    /**
     * Retrieves the profile details of the currently authenticated user.
     * Relies on the decoded JWT payload to infer the target user ID safely.
     *
     * @param payload The decoded access token payload of the requester
     * @returns The serialized profile of the current user
     */
    @Get('me')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get current user profile',
        description: 'Retrieves profile details of the currently authenticated user.',
    })
    @ApiOkResponse({ description: 'User details successfully retrieved.', type: ResponseUserDto })
    @ApiDefaultUnauthorizedResponse()
    @ApiDefaultNotFoundResponse()
    async findMe(@AccessTokenPayloadDecorator() payload: AccessTokenPayload): Promise<ResponseUserDto> {
        return plainToInstance(ResponseUserDto, await this.userService.findById(payload.sub));
    }

    /**
     * Retrieves the profile details of a specific user by their unique identifier.
     * Exclusively available to administrators for support and auditing purposes.
     *
     * @param params The path parameters containing the target user ID
     * @returns The serialized profile of the requested user
     */
    @Get(':id')
    @Roles(AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get user by ID',
        description: 'Retrieves details of a specific user. Requires administrator-level authorization.',
    })
    @ApiOkResponse({ description: 'User details successfully retrieved.', type: ResponseUserDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PARAM)
    @ApiDefaultUnauthorizedResponse()
    @ApiDefaultForbiddenResponse()
    @ApiDefaultNotFoundResponse()
    async findById(@Param() params: ParamIdDto): Promise<ResponseUserDto> {
        return plainToInstance(ResponseUserDto, await this.userService.findById(params.id));
    }

    /**
     * Updates the profile details of the currently authenticated user.
     * Allows users to modify their own non-sensitive information like names.
     *
     * @param payload The decoded access token payload of the requester
     * @param patchUserDto The sparse payload containing the fields to update
     * @returns The updated and serialized profile of the current user
     */
    @Patch('me')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Update current user profile',
        description: "Updates details of the currently authenticated user's profile.",
    })
    @ApiOkResponse({ description: 'User successfully updated.', type: ResponseUserDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultUnauthorizedResponse()
    @ApiDefaultNotFoundResponse()
    @ApiDefaultConflictResponse(ConflictType.EMAIL_IN_USE)
    async updateMe(
        @AccessTokenPayloadDecorator() payload: AccessTokenPayload,
        @Body(NotEmptyBodyPipe) patchUserDto: PatchUserDto,
    ): Promise<ResponseUserDto> {
        return plainToInstance(ResponseUserDto, await this.userService.update(payload.sub, patchUserDto));
    }

    /**
     * Changes the password of the currently authenticated user.
     * Requires the current password to be verified to prevent unauthorized account takeovers.
     *
     * @param payload The decoded access token payload of the requester
     * @param patchUserPasswordDto The payload containing the current and new passwords
     */
    @Patch('me/password')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Change current user password',
        description: "Updates the currently authenticated user's password.",
    })
    @ApiNoContentResponse({ description: 'Password successfully changed.' })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultUnauthorizedResponse()
    @ApiDefaultNotFoundResponse()
    async changePasswordMe(
        @AccessTokenPayloadDecorator() payload: AccessTokenPayload,
        @Body(NotEmptyBodyPipe) patchUserPasswordDto: PatchUserPasswordDto,
    ) {
        await this.userService.changePassword(payload.sub, patchUserPasswordDto);
    }

    /**
     * Permanently deletes or deactivates the currently authenticated user's account.
     * A destructive action initiated by the user to leave the platform.
     *
     * @param payload The decoded access token payload of the requester
     */
    @Delete('me')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Delete current user account',
        description: 'Soft deletes the currently authenticated user account.',
    })
    @ApiNoContentResponse({ description: 'User account successfully deleted.' })
    @ApiDefaultUnauthorizedResponse()
    @ApiDefaultNotFoundResponse()
    async deleteMe(@AccessTokenPayloadDecorator() payload: AccessTokenPayload) {
        await this.userService.delete(payload.sub);
    }

    /**
     * Modifies the active status of a user, allowing administrators to suspend or unsuspend accounts.
     * Suspending a user immediately revokes all their active sessions.
     *
     * @param params The path parameters containing the target user ID
     * @param dto The payload containing the desired active state
     */
    @Patch(':id/status')
    @Roles(AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Update user status',
        description:
            'Updates active status and revokes sessions if deactivated. Requires administrator-level authorization.',
    })
    @ApiNoContentResponse({ description: 'User status successfully updated.' })
    @ApiDefaultBadRequestResponse()
    @ApiDefaultUnauthorizedResponse()
    @ApiDefaultForbiddenResponse()
    @ApiDefaultNotFoundResponse()
    async updateStatus(@Param() params: ParamIdDto, @Body(NotEmptyBodyPipe) dto: PatchUserStatusDto) {
        await this.userService.updateStatus(params.id, dto.active);
    }
}
