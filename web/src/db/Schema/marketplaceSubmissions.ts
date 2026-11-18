import { sql } from 'drizzle-orm'
import {
    check,
    index,
    integer,
    jsonb,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import type { Publication } from '../../../../contracts/v1/index.ts'
import type {
    PublicationRun,
    SubmissionApproval,
    SubmissionEvent,
    SubmissionInput,
    SubmissionStatus,
    ValidatedSubmission,
} from '@/lib/Marketplace/Types/submission.types.ts'
import { appSchema } from './base.ts'

export const marketplaceRepositoryClaims = appSchema.table(
    'marketplace_repository_claims',
    {
        id: uuid('id').primaryKey(),
        submitterId: uuid('submitter_id').notNull(),
        repository: varchar('repository', { length: 140 }).notNull(),
        repositoryId: varchar('repository_id', { length: 20 }).notNull(),
        ownerId: varchar('owner_id', { length: 20 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        uniqueIndex('marketplace_repository_claim_identity_idx').on(
            table.submitterId,
            table.repositoryId,
            table.ownerId,
            table.repository,
        ),
    ],
)

export const marketplaceOfficialApps = appSchema.table(
    'marketplace_official_apps',
    {
        appId: varchar('app_id', { length: 97 }).primaryKey(),
        claimId: uuid('claim_id').references(
            () => marketplaceRepositoryClaims.id,
        ),
        revision: integer('revision').notNull(),
    },
)

export const marketplaceSubmissions = appSchema.table(
    'marketplace_submissions',
    {
        id: uuid('id').primaryKey(),
        submitterId: uuid('submitter_id').notNull(),
        claimId: uuid('claim_id')
            .notNull()
            .references(() => marketplaceRepositoryClaims.id),
        namespaceRevision: integer('namespace_revision'),
        appId: varchar('app_id', { length: 97 }).notNull(),
        version: varchar('version', { length: 64 }).notNull(),
        request: jsonb('request').$type<SubmissionInput>().notNull(),
        status: varchar('status', { length: 24 })
            .$type<SubmissionStatus>()
            .notNull(),
        revision: integer('revision').notNull(),
        history: jsonb('history').$type<SubmissionEvent[]>().notNull(),
        createdAt: timestamp('created_at', { withTimezone: true })
            .defaultNow()
            .notNull(),
        nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
        dispatchRequestedAt: timestamp('dispatch_requested_at', {
            withTimezone: true,
        }),
        buildKey: uuid('build_key').notNull(),
        buildRunId: varchar('build_run_id', { length: 20 }),
        validation: jsonb('validation').$type<ValidatedSubmission>(),
        approval: jsonb('approval').$type<SubmissionApproval>(),
        publicationRun: jsonb('publication_run').$type<PublicationRun>(),
        publication: jsonb('publication').$type<Publication>(),
    },
    (table) => [
        check(
            'marketplace_submission_status_check',
            sql`${table.status} in (
            'submitted', 'validating', 'awaitingReview', 'approved', 'publishing',
            'published', 'rejected', 'failed', 'withdrawn', 'revoked'
        )`,
        ),
        uniqueIndex('marketplace_submission_active_version_idx').on(
            table.appId,
            table.version,
        ).where(sql`${table.status} in (
                'submitted', 'validating', 'awaitingReview', 'approved',
                'publishing', 'published', 'revoked'
            ) or ${table.publicationRun} is not null`),
        uniqueIndex('marketplace_submission_build_run_idx').on(
            table.buildRunId,
        ),
        uniqueIndex('marketplace_submission_build_key_idx').on(table.buildKey),
        index('marketplace_submission_due_idx')
            .on(table.nextCheckAt)
            .where(sql`${table.nextCheckAt} is not null`),
        index('marketplace_submission_owner_idx').on(
            table.submitterId,
            table.createdAt,
        ),
        index('marketplace_submission_history_idx').on(table.createdAt),
    ],
)
