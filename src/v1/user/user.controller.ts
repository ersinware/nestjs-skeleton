/**
 * @file user.controller.ts
 * @description REST API controller exposing CRUD endpoints for user management, protected by JWT and RBAC guards.
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
import { QueryPaginationDto } from 'src/common/dto/query-pagination.dto';
import { ResponsePaginationDto } from 'src/common/dto/response-pagination.dto';
import { plainToInstance } from 'class-transformer';
import { ApiDefaultBadRequestResponse } from 'src/common/decorator/doc/api-default-bad-request-response.decorator';
import { ApiDefaultOkResponsePaginated } from 'src/common/decorator/doc/api-default-ok-response-paginated.decorator';
import { BadRequestType } from 'src/common/enum/error/bad-request-type.enum';
import { ApiDefaultConflictResponse } from 'src/common/decorator/doc/api-default-conflict-response.decorator';
import { ApiDefaultForbiddenResponse } from 'src/common/decorator/doc/api-default-forbidden-response.decorator';
import { ApiDefaultInternalServerErrorResponse } from 'src/common/decorator/doc/api-default-internal-server-error-response.decorator';
import { ApiDefaultNotFoundResponse } from 'src/common/decorator/doc/api-default-not-found-response.decorator';
import { ApiDefaultUnauthorizedResponse } from 'src/common/decorator/doc/api-default-unauthorized-response.decorator';
import { UnauthorizedType } from 'src/common/enum/error/unauthorized-type.enum';
import { AccessTokenPayloadDecorator } from 'src/common/decorator/auth/access-token-payload.decorator';
import { Public } from 'src/common/decorator/auth/public.decorator';
import { Roles } from 'src/common/decorator/auth/roles.decorator';
import { ParamIdDto } from 'src/common/dto/param-id.dto';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import type { AccessTokenPayload } from 'src/common/guard/interface/auth.interface';
import { NotEmptyBodyPipe } from 'src/common/pipe/not-empty-body.pipe';
import { GetUserDto } from './dto/get-user.dto';
import { PatchUserPasswordDto } from './dto/patch-user-password.dto';
import { PatchUserStatusDto } from './dto/patch-user-status.dto';
import { PatchUserDto } from './dto/patch-user.dto';
import { PostUserDto } from './dto/post-user.dto';
import { UserService } from './user.service';

/**
 * Controller class providing routing and handling for User API requests.
 */
@Controller({
    path: 'user',
    version: '1',
})
@ApiTags('user')
@ApiDefaultInternalServerErrorResponse()
export class UserController {
    /**
     * Creates an instance of UserController.
     *
     * @param userService User business logic service.
     */
    constructor(private readonly userService: UserService) {}

    /**
     * Endpoint to register a new user account.
     *
     * @param postUserDto Payload with account details.
     * @returns A promise resolving to the created and serialized GetUserDto.
     */
    @Public()
    @Post()
    @ApiOperation({
        summary: 'Register user',
        description: 'Creates a new user profile.',
    })
    @ApiCreatedResponse({ description: 'User account successfully created.', type: GetUserDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultConflictResponse()
    async create(@Body(NotEmptyBodyPipe) postUserDto: PostUserDto): Promise<GetUserDto> {
        return plainToInstance(GetUserDto, await this.userService.create(postUserDto));
    }

    /**
     * Endpoint to retrieve all users with pagination. Requires administrator-level authorization.
     *
     * @param query The query pagination parameters.
     * @returns A promise resolving to a paginated response of GetUserDto.
     */
    @Get()
    @Roles(AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get all users',
        description: 'Retrieves registered users with pagination. Requires administrator-level authorization.',
    })
    @ApiDefaultOkResponsePaginated({ description: 'Users successfully retrieved.', type: GetUserDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PARAM)
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
    @ApiDefaultForbiddenResponse()
    async findAll(@Query() query: QueryPaginationDto): Promise<ResponsePaginationDto<GetUserDto>> {
        const { data, total } = await this.userService.findAll(query);

        return new ResponsePaginationDto<GetUserDto>(plainToInstance(GetUserDto, data), total, query.page, query.limit);
    }

    /**
     * Endpoint to retrieve details of the currently authenticated user's profile.
     *
     * @param payload The authenticated access token payload.
     * @returns A promise resolving to the serialized GetUserDto.
     */
    @Get('me')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get current user profile',
        description: 'Retrieves profile details of the currently authenticated user.',
    })
    @ApiOkResponse({ description: 'User details successfully retrieved.', type: GetUserDto })
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
    @ApiDefaultNotFoundResponse()
    async findMe(@AccessTokenPayloadDecorator() payload: AccessTokenPayload): Promise<GetUserDto> {
        return plainToInstance(GetUserDto, await this.userService.findById(payload.sub));
    }

    /**
     * Endpoint to retrieve details of a specific user. Requires administrator-level authorization.
     *
     * @param params URL path parameters containing the user ID.
     * @returns A promise resolving to the serialized GetUserDto.
     */
    @Get(':id')
    @Roles(AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get user by ID',
        description: 'Retrieves details of a specific user. Requires administrator-level authorization.',
    })
    @ApiOkResponse({ description: 'User details successfully retrieved.', type: GetUserDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PARAM)
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
    @ApiDefaultForbiddenResponse()
    @ApiDefaultNotFoundResponse()
    async findById(@Param() params: ParamIdDto): Promise<GetUserDto> {
        return plainToInstance(GetUserDto, await this.userService.findById(params.id));
    }

    /**
     * Endpoint to update the currently authenticated user's profile details.
     *
     * @param payload The authenticated access token payload.
     * @param patchUserDto Payload with update details.
     * @returns A promise resolving to the updated and serialized GetUserDto.
     */
    @Patch('me')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Update current user profile',
        description: "Updates details of the currently authenticated user's profile.",
    })
    @ApiOkResponse({ description: 'User successfully updated.', type: GetUserDto })
    @ApiDefaultBadRequestResponse(BadRequestType.PAYLOAD)
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
    @ApiDefaultNotFoundResponse()
    @ApiDefaultConflictResponse()
    async updateMe(
        @AccessTokenPayloadDecorator() payload: AccessTokenPayload,
        @Body(NotEmptyBodyPipe) patchUserDto: PatchUserDto,
    ): Promise<GetUserDto> {
        return plainToInstance(GetUserDto, await this.userService.update(payload.sub, patchUserDto));
    }

    /**
     * Endpoint to change the currently authenticated user's password.
     *
     * @param payload The authenticated access token payload.
     * @param patchUserPasswordDto Payload with current and new password.
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
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
    @ApiDefaultNotFoundResponse()
    async changePasswordMe(
        @AccessTokenPayloadDecorator() payload: AccessTokenPayload,
        @Body(NotEmptyBodyPipe) patchUserPasswordDto: PatchUserPasswordDto,
    ) {
        await this.userService.changePassword(payload.sub, patchUserPasswordDto);
    }

    /**
     * Endpoint to delete (deactivate) the currently authenticated user's account.
     *
     * @param payload The authenticated access token payload.
     */
    @Delete('me')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Delete current user account',
        description: 'Soft deletes the currently authenticated user account.',
    })
    @ApiNoContentResponse({ description: 'User account successfully deleted.' })
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
    @ApiDefaultNotFoundResponse()
    async deleteMe(@AccessTokenPayloadDecorator() payload: AccessTokenPayload) {
        await this.userService.delete(payload.sub);
    }

    /**
     * Update a user account status (active/inactive). Requires administrator-level authorization.
     *
     * @param params URL path parameters containing the user ID.
     * @param dto User status update payload.
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
    @ApiDefaultBadRequestResponse(BadRequestType.BOTH)
    @ApiDefaultUnauthorizedResponse(UnauthorizedType.TOKEN)
    @ApiDefaultForbiddenResponse()
    @ApiDefaultNotFoundResponse()
    async updateStatus(@Param() params: ParamIdDto, @Body(NotEmptyBodyPipe) dto: PatchUserStatusDto) {
        await this.userService.updateStatus(params.id, dto.active);
    }
}
