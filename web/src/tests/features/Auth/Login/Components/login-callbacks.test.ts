import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoginHeader } from '@/features/Auth/Login/Components/LoginHeader.tsx'
import TwoFactorForm from '@/features/Auth/Login/Components/TwoFactorForm.tsx'
import type { TwoFactorFormProps } from '@/features/Auth/Login/Types/login-component-props.types.ts'
import {
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

const header = {
    state: {
        companyName: 'Example GmbH',
        logoSrc: '/company.webp',
        hasCustomLogo: true,
    },
}
mock.module('@/features/Auth/Login/Hooks/useLoginHeaderLogic.ts', () => ({
    default: () => header,
}))
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))

describe('Login component callbacks', () => {
    it('prioritizes the company logo and replaces failed images with the default', () => {
        const tree = LoginHeader()
        const image = findElement(tree, (element) => element.type === 'img')
        expect(image.props).toMatchObject({
            loading: 'eager',
            decoding: 'sync',
            fetchPriority: 'high',
            alt: 'Example GmbH',
        })
        const target = { src: '/company.webp', dataset: {} }
        invoke(image, 'onError', { currentTarget: target })
        expect(target.src).not.toBe('/company.webp')
        header.state.hasCustomLogo = false
        expect(renderToStaticMarkup(LoginHeader())).toContain('<img')
    })

    it('forwards OTP, trusted device, input ref, submit and back actions', () => {
        const props: TwoFactorFormProps = {
            code: ['1', '2', '3', '', '', ''],
            isLoading: false,
            isError: true,
            trustThisDevice: false,
            onSubmit: mock(),
            onChange: mock(),
            setRef: mock(),
            onTrustThisDeviceChange: mock(),
            onBackToLogin: mock(),
        }
        const tree = TwoFactorForm(props)
        const otp = findElement(
            tree,
            (element) => element.props.triggerRef === props.setRef,
        )
        expect(otp.props).toMatchObject({
            status: 'error',
            error: 'auth.login.twoFactorCodeIncomplete',
        })
        invoke(otp, 'onValueChange', ['1', '2', '3', '4', '5', '6'])
        invoke(otp, 'triggerRef', null)
        invoke(
            findElement(tree, (element) => element.props.type === 'checkbox'),
            'onChange',
            { target: { checked: true } },
        )
        const event = { preventDefault: mock() }
        invoke(
            findElement(tree, (element) => element.type === 'form'),
            'onSubmit',
            event,
        )
        invoke(
            findElement(
                tree,
                (element) => element.props.onClick === props.onBackToLogin,
            ),
            'onClick',
        )
        expect(props.onChange).toHaveBeenCalledWith([
            '1',
            '2',
            '3',
            '4',
            '5',
            '6',
        ])
        expect(props.setRef).toHaveBeenCalledWith(null)
        expect(props.onTrustThisDeviceChange).toHaveBeenCalledWith(true)
        expect(props.onSubmit).toHaveBeenCalledWith(event)
        expect(props.onBackToLogin).toHaveBeenCalledTimes(1)
        const pending = TwoFactorForm({
            ...props,
            isLoading: true,
            trustThisDevice: true,
            code: ['1', '2', '3', '4', '5', '6'],
        })
        expect(
            findElement(pending, (element) => element.props.type === 'checkbox')
                .props.disabled,
        ).toBe(true)
        expect(
            findElement(
                pending,
                (element) => element.props.triggerRef === props.setRef,
            ).props.error,
        ).toBeUndefined()
        expect(renderToStaticMarkup(pending)).toContain('animate-spin')
    })
})
