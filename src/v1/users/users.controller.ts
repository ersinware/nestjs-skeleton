import { Controller, Get } from '@nestjs/common';
import { ApiBadRequestResponse, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DefaultErrorDto } from 'src/common/dto/default-error.dto';
import { UserHelloResponseDto } from './dto/user-hello-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller({
    path: 'users',
    version: '1',
})
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Get()
    @ApiOperation({
        summary: 'Get hello message',
        description: 'Returns a simple greeting string to verify the users service is working.',
    })
    @ApiOkResponse({
        description: 'The greeting message has been successfully retrieved.',
        type: UserHelloResponseDto,
    })
    @ApiBadRequestResponse({ description: 'Invalid input data.', type: DefaultErrorDto })
    @ApiForbiddenResponse({ description: 'Forbidden access.', type: DefaultErrorDto })
    getHello(): UserHelloResponseDto {
        return { message: this.usersService.getHello() };
    }
}
