import { afterEach, describe, expect, it } from 'bun:test'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { getPasskeyConfig } from '@/server/Auth/Passkey/config.service.ts'

const previousEnvironment = {
    ORIGIN: process.env.ORIGIN,
    PASSKEY_ORIGIN: process.env.PASSKEY_ORIGIN,
    PASSKEY_RP_ID: process.env.PASSKEY_RP_ID,
    PASSKEY_RP_NAME: process.env.PASSKEY_RP_NAME,
}

afterEach(function () {
    for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) {
            delete process.env[key]
        } else {
            process.env[key] = value
        }
    }
})

describe('Passkey-Runtime-Konfiguration', function () {
    it('leitet die RP-ID aus der konfigurierten Origin ab', function () {
        process.env.PASSKEY_ORIGIN = 'https://login.example.test/'
        delete process.env.PASSKEY_RP_ID
        process.env.PASSKEY_RP_NAME = 'Example App'

        expect(getPasskeyConfig()).toEqual({
            rpName: 'Example App',
            rpID: 'login.example.test',
            origin: 'https://login.example.test',
        })
    })

    it('trims explicit passkey settings', function () {
        process.env.PASSKEY_ORIGIN = ' https://login.example.test '
        process.env.PASSKEY_RP_ID = ' example.test '
        process.env.PASSKEY_RP_NAME = ' Example App '

        expect(getPasskeyConfig()).toEqual({
            rpName: 'Example App',
            rpID: 'example.test',
            origin: 'https://login.example.test',
        })
    })

    it('uses defaults for blank passkey settings', function () {
        process.env.PASSKEY_ORIGIN = ''
        process.env.PASSKEY_RP_ID = ' '
        process.env.PASSKEY_RP_NAME = ''
        process.env.ORIGIN = ' https://app.example.test/ '

        expect(getPasskeyConfig()).toEqual({
            rpName: PROJECT_CONFIG.defaultName,
            rpID: 'app.example.test',
            origin: 'https://app.example.test',
        })

        process.env.ORIGIN = ' '
        expect(getPasskeyConfig()).toEqual({
            rpName: PROJECT_CONFIG.defaultName,
            rpID: 'localhost',
            origin: 'http://localhost:3000',
        })
    })
})
