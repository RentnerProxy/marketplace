import { execFile } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { faker } from '@faker-js/faker'
import { eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { DEFAULT_BACKGROUND_DARKNESS } from '@/config/user-theme-colors.config.ts'
import {
    getSystemLogoPublicImagePaths,
    getUserPublicImagePaths,
} from '@/lib/Images/publicImagePaths.ts'
import * as schema from '@/db/schema.ts'
import { closeTestDatabase, db } from '@/tests/shared/testDatabase.ts'

const execFileAsync = promisify(execFile)
const TEST_MARKER = 'vitest-demo'
const DEFAULT_TEST_USER_PASSWORD = 'user123'
const DEFAULT_TEST_USER_BACKGROUND_DARKNESS = DEFAULT_BACKGROUND_DARKNESS
const BUN_EXECUTABLE = process.env.npm_execpath ?? 'bun'
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const TEST_RUN_ID = faker.string.uuid()
const TEST_SETTINGS_ID = `${TEST_MARKER}-${TEST_RUN_ID}`.slice(0, 50)
const TEST_CREATOR_EMAIL = `test-db-creator+${TEST_RUN_ID}@example.com`
const TEST_CREATOR_USERNAME = `${TEST_MARKER}-creator-${TEST_RUN_ID}`.slice(
    0,
    50,
)
const testUserEmails = new Set<string>([TEST_CREATOR_EMAIL])
if (!TEST_DATABASE_URL) {
    throw new Error(
        'TEST_DATABASE_URL wurde nicht durch das DB-Test-Setup bereitgestellt.',
    )
}

let creatorUserId: string
let isDbReady = false

function createDemoImageBuffer() {
    return sharp({
        create: {
            width: 512,
            height: 512,
            channels: 4,
            background: faker.color.rgb(),
        },
    })
        .png()
        .toBuffer()
}

async function createBunPasswordHash(password: string) {
    const { stdout } = await execFileAsync(BUN_EXECUTABLE, [
        '-e',
        'console.log(await Bun.password.hash(Bun.argv[1]))',
        password,
    ])

    return stdout.trim()
}

async function verifyBunPassword(password: string, passwordHash: string) {
    const { stdout } = await execFileAsync(BUN_EXECUTABLE, [
        '-e',
        'console.log(await Bun.password.verify(Bun.argv[1], Bun.argv[2]) ? "true" : "false")',
        password,
        passwordHash,
    ])

    return stdout.trim() === 'true'
}

async function expectFileExists(filePath: string) {
    await expect(access(filePath)).resolves.toBeUndefined()
}

async function uploadDemoUserImages(userId: string) {
    const imageBuffer = await createDemoImageBuffer()
    const paths = getUserPublicImagePaths(userId)
    const updatedAt = new Date()

    await Promise.all([
        mkdir(paths.absoluteDir, { recursive: true }),
        mkdir(paths.absoluteBackgroundDir, { recursive: true }),
    ])

    await sharp(imageBuffer)
        .resize(512, 512, { fit: 'cover' })
        .webp({ quality: 90 })
        .toFile(paths.absoluteProfile)

    await sharp(imageBuffer)
        .resize(64, 64, { fit: 'cover' })
        .webp({ quality: 85 })
        .toFile(paths.absoluteProfileSmall)

    await sharp(imageBuffer)
        .resize(1920, 1080, { fit: 'cover' })
        .webp({ quality: 88 })
        .toFile(paths.absoluteBackground)

    await db
        .insert(schema.user_settings)
        .values({
            userId,
            customBackgroundDarkness: DEFAULT_TEST_USER_BACKGROUND_DARKNESS,
            customBackgroundUpdatedAt: updatedAt,
        })
        .onConflictDoUpdate({
            target: schema.user_settings.userId,
            set: {
                customBackgroundDarkness: DEFAULT_TEST_USER_BACKGROUND_DARKNESS,
                customBackgroundUpdatedAt: updatedAt,
            },
        })

    return { paths, updatedAt }
}

async function createTestCreatorUser() {
    const insertedUsers = await db
        .insert(schema.users)
        .values({
            username: TEST_CREATOR_USERNAME,
            email: TEST_CREATOR_EMAIL,
            passwordHash: await createBunPasswordHash(
                DEFAULT_TEST_USER_PASSWORD,
            ),
            isActive: true,
        })
        .returning({ id: schema.users.id })
    const userId = insertedUsers.at(0)?.id

    if (!userId) {
        throw new Error('Test-Ersteller konnte nicht angelegt werden.')
    }

    return userId
}

describe('Systemsettings DB-Demodaten', function () {
    beforeAll(async function () {
        isDbReady = true

        await db.insert(schema.systemSettings).values({
            id: TEST_SETTINGS_ID,
            companyName: `${TEST_MARKER} ${TEST_RUN_ID}`.slice(0, 100),
        })

        creatorUserId = await createTestCreatorUser()
    })

    afterAll(async function () {
        const cleanupErrors: Array<Error> = []

        if (isDbReady) {
            try {
                await db
                    .delete(schema.systemSettings)
                    .where(eq(schema.systemSettings.id, TEST_SETTINGS_ID))
            } catch (error) {
                cleanupErrors.push(
                    error instanceof Error ? error : new Error(String(error)),
                )
            }

            try {
                await db
                    .delete(schema.users)
                    .where(inArray(schema.users.email, [...testUserEmails]))
            } catch (error) {
                cleanupErrors.push(
                    error instanceof Error ? error : new Error(String(error)),
                )
            }
        }

        try {
            await closeTestDatabase()
        } catch (error) {
            cleanupErrors.push(
                error instanceof Error ? error : new Error(String(error)),
            )
        }

        if (cleanupErrors.length > 0) {
            throw new AggregateError(
                cleanupErrors,
                'DB-Testdaten konnten nicht vollständig entfernt werden.',
            )
        }
    })

    it('schreibt einen isolierten Test-Benutzer mit Bildern in die Datenbank', async function () {
        const uniqueId = faker.string.uuid()
        const demoUserEmail = `test-db-user+${TEST_RUN_ID}-${uniqueId}@example.com`
        const demoUser = {
            username: `${TEST_MARKER}-user-${TEST_RUN_ID}-${uniqueId}`.slice(
                0,
                50,
            ),
            email: demoUserEmail,
            passwordHash: await createBunPasswordHash(
                DEFAULT_TEST_USER_PASSWORD,
            ),
            createdByUserId: creatorUserId,
            isActive: true,
        }

        testUserEmails.add(demoUserEmail)

        const inserted = await db
            .insert(schema.users)
            .values(demoUser)
            .returning({
                id: schema.users.id,
                email: schema.users.email,
                passwordHash: schema.users.passwordHash,
                createdByUserId: schema.users.createdByUserId,
            })

        const storedUsers = await db
            .select({
                id: schema.users.id,
                email: schema.users.email,
                passwordHash: schema.users.passwordHash,
                createdByUserId: schema.users.createdByUserId,
            })
            .from(schema.users)
            .where(eq(schema.users.email, inserted[0].email))
            .limit(1)

        expect(storedUsers[0]?.id).toBe(inserted[0].id)
        expect(storedUsers[0]?.email).toBe(inserted[0].email)
        expect(storedUsers[0]?.passwordHash).toBe(inserted[0].passwordHash)
        expect(storedUsers[0]?.createdByUserId).toBe(creatorUserId)
        expect(
            await verifyBunPassword(
                DEFAULT_TEST_USER_PASSWORD,
                storedUsers[0].passwordHash,
            ),
        ).toBe(true)

        const upload = await uploadDemoUserImages(inserted[0].id)
        const storedUsersWithImages = await db
            .select({
                customBackgroundDarkness:
                    schema.user_settings.customBackgroundDarkness,
                customBackgroundUpdatedAt:
                    schema.user_settings.customBackgroundUpdatedAt,
            })
            .from(schema.user_settings)
            .where(eq(schema.user_settings.userId, inserted[0].id))
            .limit(1)

        await expectFileExists(upload.paths.absoluteProfile)
        await expectFileExists(upload.paths.absoluteProfileSmall)
        await expectFileExists(upload.paths.absoluteBackground)
        expect(storedUsersWithImages[0]?.customBackgroundDarkness).toBe(
            DEFAULT_TEST_USER_BACKGROUND_DARKNESS,
        )
        expect(
            storedUsersWithImages[0]?.customBackgroundUpdatedAt?.getTime(),
        ).toBe(upload.updatedAt.getTime())
    })

    it('erzeugt lokale Bilddaten und schreibt isolierte Systemlogo-Dateien', async function () {
        const imageBuffer = await createDemoImageBuffer()
        const logoUpdatedAt = new Date()
        const paths = getSystemLogoPublicImagePaths()

        await mkdir(paths.absoluteDir, { recursive: true })

        await sharp(imageBuffer)
            .resize(512, 512, { fit: 'cover' })
            .webp({ quality: 90 })
            .toFile(paths.absoluteLarge)

        await sharp(imageBuffer)
            .resize(64, 64, { fit: 'cover' })
            .webp({ quality: 85 })
            .toFile(paths.absoluteSmall)

        const updated = await db
            .update(schema.systemSettings)
            .set({
                logoUpdatedAt,
                updatedAt: logoUpdatedAt,
            })
            .where(eq(schema.systemSettings.id, TEST_SETTINGS_ID))
            .returning({
                logoUpdatedAt: schema.systemSettings.logoUpdatedAt,
            })

        await expectFileExists(paths.absoluteLarge)
        await expectFileExists(paths.absoluteSmall)
        expect(updated[0]?.logoUpdatedAt?.getTime()).toBe(
            logoUpdatedAt.getTime(),
        )
    })
})
