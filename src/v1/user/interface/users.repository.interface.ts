import type { NewUser, User } from '../type/user.type';

export interface IUsersRepository {
    create(data: NewUser): Promise<User | null>;
    findAll(): Promise<User[]>;
    findById(id: number): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
    findPasswordById(id: number): Promise<string | null>;
    update(id: number, data: Partial<NewUser>): Promise<User | null>;
    delete(id: number): Promise<boolean>;
}
