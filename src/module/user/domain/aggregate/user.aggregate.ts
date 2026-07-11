/**
 * @file user.aggregate.ts
 * @description The User Aggregate Root. Encapsulates all business rules and state for a User.
 */

import {
    UserBannedEvent,
    UserDeletedEvent,
    UserPasswordChangedEvent,
    UserUnbannedEvent,
    UserUpdatedEvent,
} from 'src/module/user/domain/event';
import { AggregateRoot } from 'src/shared/domain/aggregate-root';

export interface UserProps {
    email: string;
    name: string;
    password: string;
    isActive: boolean;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export class User extends AggregateRoot {
    private props: UserProps;

    private constructor(id: string, props: UserProps) {
        super(id);
        this.props = props;
    }

    /**
     * Factory method to create a new User.
     * Enforces invariant rules on creation and emits a CREATED event.
     */
    static create(id: string, props: Omit<UserProps, 'isActive' | 'deletedAt' | 'createdAt' | 'updatedAt'>): User {
        const user = new User(id, {
            ...props,
            isActive: true,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        return user;
    }

    /**
     * Factory method to reconstitute an existing User from the database.
     */
    static reconstitute(id: string, props: UserProps): User {
        return new User(id, props);
    }

    /**
     * Creates a snapshot of the aggregate state for persistence.
     */
    toSnapshot(): UserProps & { id: string } {
        return {
            id: this.id,
            ...this.props,
        };
    }

    /**
     * Updates the basic profile information of the user.
     * Only applies changes if the provided values differ from the current state.
     */
    updateProfile(payload: { name?: string | undefined; email?: string | undefined }) {
        let isUpdated = false;

        if (payload.name && payload.name !== this.props.name) {
            this.props.name = payload.name;
            isUpdated = true;
        }

        if (payload.email && payload.email !== this.props.email) {
            this.props.email = payload.email;
            isUpdated = true;
        }

        if (isUpdated) {
            this.addDomainEvent(new UserUpdatedEvent(this.id));
        }
    }

    /**
     * Changes the user's password.
     */
    changePassword(password: string) {
        this.props.password = password;

        this.addDomainEvent(new UserPasswordChangedEvent(this.id));
    }

    /**
     * Updates the active status of the user.
     */
    updateStatus(isActive: boolean): void {
        if (this.props.isActive === isActive) {
            return;
        }

        this.props.isActive = isActive;

        if (isActive) {
            this.addDomainEvent(new UserUnbannedEvent(this.id));
        } else {
            this.addDomainEvent(new UserBannedEvent(this.id));
        }
    }

    /**
     * Soft deletes the user.
     */
    markAsDeleted(): void {
        if (this.props.deletedAt) {
            return;
        }

        this.props.deletedAt = new Date();
        this.props.isActive = false;

        this.addDomainEvent(new UserDeletedEvent(this.id));
    }

    get email(): string {
        return this.props.email;
    }

    get name(): string {
        return this.props.name;
    }

    get password(): string {
        return this.props.password;
    }

    get isActive(): boolean {
        return this.props.isActive;
    }

    get deletedAt(): Date | null {
        return this.props.deletedAt;
    }

    get createdAt(): Date {
        return this.props.createdAt;
    }

    get updatedAt(): Date {
        return this.props.updatedAt;
    }
}
