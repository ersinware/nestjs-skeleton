import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller({
    path: 'health',
    version: VERSION_NEUTRAL,
})
export class HealthController {
    @Get()
    @ApiOperation({
        summary: 'Health check endpoint.',
        description: 'Returns the health status of the API service.',
    })
    @ApiOkResponse({ description: 'Service is healthy and running.' })
    health(): void {}
}
