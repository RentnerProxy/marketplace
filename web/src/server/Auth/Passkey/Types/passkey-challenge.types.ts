import type {
    REGISTRATION_CHALLENGE_TYPE,
    AUTHENTICATION_CHALLENGE_TYPE,
} from '../challenge.service.ts'

export type PasskeyChallengeType =
    typeof REGISTRATION_CHALLENGE_TYPE | typeof AUTHENTICATION_CHALLENGE_TYPE
