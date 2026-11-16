import { expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import SocialLogin from '@/shared/Auth/Components/SocialLogin.tsx'
import type { SocialLoginLogicReturn } from '@/shared/Auth/Types/social-login.types.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

const logic: SocialLoginLogicReturn = {
    state: {
        providers: [
            { id: 'google', name: 'Google' },
            { id: 'github', name: 'GitHub' },
            { id: 'discord', name: 'Discord' },
        ],
        isPending: false,
        requiresTwoFactor: false,
        code: '',
        error: '',
    },
    handler: {
        handleBegin: mock(),
        handleSubmit: mock(),
        handleCancel: mock(),
    },
    setter: { setCode: mock() },
}

mock.module('@/shared/Auth/Hooks/useSocialLoginLogic.ts', () => ({
    default: () => logic,
}))
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: { provider: string }) =>
            values ? `${key}: ${values.provider}` : key,
    }),
}))

it('dispatches each provider and preserves pending and two-factor controls', () => {
    const tree = SocialLogin()
    const providers = elements(tree).filter(
        (element) => element.type === 'button',
    )
    expect(providers).toHaveLength(3)
    providers.forEach((button, index) => {
        expect(button.props).toMatchObject({ type: 'button', disabled: false })
        invoke(button, 'onClick')
        expect(logic.handler.handleBegin).toHaveBeenNthCalledWith(
            index + 1,
            logic.state.providers[index]!.id,
        )
        const html = renderToStaticMarkup(button)
        expect(html).toContain(logic.state.providers[index]!.name)
        expect(html).toContain('aria-hidden="true"')
        expect(button.props['aria-label']).toBe(
            `auth.social.continue: ${logic.state.providers[index]!.name}`,
        )
        expect(html).toContain('focusable="false"')
    })

    logic.state.isPending = true
    expect(
        elements(SocialLogin())
            .filter((element) => element.type === 'button')
            .every((button) => button.props.disabled === true),
    ).toBe(true)

    Object.assign(logic.state, {
        requiresTwoFactor: true,
        isPending: false,
        code: '123456',
        error: 'Invalid code',
    })
    const challenge = SocialLogin()
    const input = findElement(
        challenge,
        (element) => element.props.name === 'twoFactorCode',
    )
    expect(input.props).toMatchObject({
        value: '123456',
        autoComplete: 'one-time-code',
        inputMode: 'numeric',
        required: true,
        pattern: '[0-9]{6}',
        'aria-invalid': true,
        'aria-describedby': 'social-two-factor-error',
    })
    invoke(input, 'onValueChange', '654321')
    expect(logic.setter.setCode).toHaveBeenCalledWith('654321')
    const event = { preventDefault: mock() }
    invoke(
        findElement(challenge, (element) => element.type === 'form'),
        'onSubmit',
        event,
    )
    expect(logic.handler.handleSubmit).toHaveBeenCalledWith(event)
    invoke(
        findElement(challenge, (element) => element.props.type === 'button'),
        'onClick',
    )
    expect(logic.handler.handleCancel).toHaveBeenCalledTimes(1)
    const html = renderToStaticMarkup(challenge)
    expect(html).toContain('role="alert"')
    expect(html).toContain('id="social-two-factor-error"')
    expect(html).not.toContain('auth.social.continue')

    logic.state.isPending = true
    const pending = SocialLogin()
    expect(
        findElement(
            pending,
            (element) => element.props.name === 'twoFactorCode',
        ).props.disabled,
    ).toBe(true)
    expect(
        elements(pending)
            .filter((element) => element.type === 'button')
            .every((button) => button.props.disabled === true),
    ).toBe(true)
    expect(
        findElement(pending, (element) => element.type === 'form').props[
            'aria-busy'
        ],
    ).toBe(true)
})
