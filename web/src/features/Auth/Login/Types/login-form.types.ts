import type { LoginInput } from './login-server-input.types.ts'

export type LoginFormValues = Pick<LoginInput, 'username' | 'password'>
export type LoginRequestValues = LoginInput
type TwoFactorLoginValues = Required<
    Pick<LoginInput, 'twoFactorCode' | 'trustThisDevice'>
>
export type SubmitTwoFactorLogin = (values: TwoFactorLoginValues) => void
