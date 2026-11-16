import { z } from 'zod'
import { optionalEnvironmentValue } from './environment-schema.service.ts'

export const socialAuthEnvironmentFields = {
    OAUTH_GOOGLE_CLIENT_ID: optionalEnvironmentValue,
    OAUTH_GOOGLE_CLIENT_SECRET: optionalEnvironmentValue,
    OAUTH_GITHUB_CLIENT_ID: optionalEnvironmentValue,
    OAUTH_GITHUB_CLIENT_SECRET: optionalEnvironmentValue,
    OAUTH_DISCORD_CLIENT_ID: optionalEnvironmentValue,
    OAUTH_DISCORD_CLIENT_SECRET: optionalEnvironmentValue,
}

export const socialAuthEnvironmentSchema = z.object(socialAuthEnvironmentFields).superRefine((environment, context) => {
    const groups = [
        ['OAUTH_GOOGLE_CLIENT_ID', 'OAUTH_GOOGLE_CLIENT_SECRET'],
        ['OAUTH_GITHUB_CLIENT_ID', 'OAUTH_GITHUB_CLIENT_SECRET'],
        ['OAUTH_DISCORD_CLIENT_ID', 'OAUTH_DISCORD_CLIENT_SECRET'],
    ] as const
    for (const keys of groups) {
        if (!keys.some((key) => environment[key])) continue
        for (const key of keys) {
            if (!environment[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} wird für diesen Anmeldeanbieter benötigt.` })
        }
    }
})

export function parseSocialAuthEnvironmentService(environment: unknown = process.env) {
    return socialAuthEnvironmentSchema.parse(environment)
}
