/**
 * @file admin.aggregate.ts
 * @description The Admin Aggregate Root. Encapsulates all business rules and state for an Admin.
 */

import {
    AdminBannedEvent,
    AdminCreatedEvent,
    AdminDeletedEvent,
    AdminUnbannedEvent,
} from 'src/module/admin/domain/event';
import { AdminRole } from 'src/shared/domain/admin';
import { AggregateRoot } from 'src/shared/domain/aggregate-root';

/**
 * Properties that define the state of an Admin aggregate.
 */
type AdminProps = {
    email: string;
    name: string;
    password: string;
    role: AdminRole;
    isActive: boolean;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

/**
 * The Admin aggregate root.
 * Encapsulates the core rules, state, and behaviors of an administrative user.
 */
export class Admin extends AggregateRoot {
    private props: AdminProps;

    /**
     * Initializes a new instance of the Admin aggregate.
     *
     * @param id The unique identifier
     * @param props The aggregate state properties
     */
    private constructor(id: string, props: AdminProps) {
        super(id);
        this.props = props;
    }

    /**
     * Factory method to create a new Admin.
     * Enforces invariant rules on creation and emits a CREATED event.
     *
     * @param id The new unique identifier
     * @param props The initial properties excluding managed fields
     * @returns The newly created aggregate
     */
    static create(id: string, props: Omit<AdminProps, 'isActive' | 'deletedAt' | 'createdAt' | 'updatedAt'>): Admin {
        const admin = new Admin(id, {
            ...props,
            isActive: true,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        admin.addDomainEvent(new AdminCreatedEvent(id));

        return admin;
    }

    /**
     * Factory method to reconstitute an existing Admin from the database.
     *
     * @param id The unique identifier
     * @param props The persisted aggregate state
     * @returns The reconstituted aggregate
     */
    static reconstitute(id: string, props: AdminProps): Admin {
        return new Admin(id, props);
    }

    /**
     * Creates a snapshot of the aggregate state for persistence.
     */
    toSnapshot(): AdminProps & { id: string } {
        return {
            id: this.id,
            ...this.props,
        };
    }

    /**
     * Updates the admin's active status.
     * Emits an UNBANNED or BANNED event if the status is altered.
     *
     * @param isActive The new status
     */
    updateStatus(isActive: boolean): void {
        if (this.props.isActive === isActive) {
            return;
        }

        this.props.isActive = isActive;

        if (isActive) {
            this.addDomainEvent(new AdminUnbannedEvent(this.id));
        } else {
            this.addDomainEvent(new AdminBannedEvent(this.id));
        }
    }

    /**
     * Soft-deletes the admin account.
     * Sets the deletion timestamp, deactivates the account, and emits a DELETED event.
     */
    markAsDeleted(): void {
        if (this.props.deletedAt) {
            return;
        }

        this.props.deletedAt = new Date();
        this.props.isActive = false;

        this.addDomainEvent(new AdminDeletedEvent(this.id));
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

    get role(): AdminRole {
        return this.props.role;
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
