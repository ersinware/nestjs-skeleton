import { Test, TestingModule } from '@nestjs/testing';
import { USERS_REPOSITORY_TOKEN } from './constant/user.constant';
import { UserService } from './user.service';

describe('UserService', () => {
    let service: UserService;

    const mockRepository = {
        create: jest.fn(),
        findAll: jest.fn(),
        findById: jest.fn(),
        findByEmail: jest.fn(),
        findPasswordById: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserService,
                {
                    provide: USERS_REPOSITORY_TOKEN,
                    useValue: mockRepository,
                },
            ],
        }).compile();

        service = module.get<UserService>(UserService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
