import { test } from 'bun:test'
import { exerciseSubmissionLifecycle } from './submission-lifecycle.fixture.ts'

test(
    'persists the app submission lifecycle through concurrent PostgreSQL connections',
    exerciseSubmissionLifecycle,
)
