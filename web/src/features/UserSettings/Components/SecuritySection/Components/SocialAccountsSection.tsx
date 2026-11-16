import { Link2, LoaderCircle } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useSocialAccountsLogic from '../Hooks/useSocialAccountsLogic.ts'
import ReauthenticationInput from './ReauthenticationInput.tsx'

export default function SocialAccountsSection() {
    const { t } = useTranslationStore()
    const { state, handler } = useSocialAccountsLogic()

    return (
        <section className="rounded-lg border border-border-dark bg-background-dark p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                <Link2 className="h-5 w-5 text-primary" />
                {t('userSettings.security.socialAccounts.title')}
            </h2>
            <p className="mt-2 text-sm text-secondary-text">
                {t('userSettings.security.socialAccounts.description')}
            </p>
            <div className="mt-4 space-y-3">
                {state.isLoading ? (
                    <p role="status" className="text-sm text-secondary-text">
                        {t('userSettings.security.socialAccounts.loading')}
                    </p>
                ) : state.hasLoadError ? (
                    <p role="alert" className="text-sm text-danger">
                        {t('userSettings.security.socialAccounts.loadError')}
                    </p>
                ) : state.providers.length === 0 ? (
                    <p className="text-sm text-secondary-text">
                        {t('userSettings.security.socialAccounts.unavailable')}
                    </p>
                ) : (
                    state.providers.map((provider) => (
                        <div
                            key={provider.id}
                            className="flex items-center justify-between gap-3 rounded-md border border-border-dark bg-surface-dark/60 p-3"
                        >
                            <span className="text-sm font-semibold text-white">
                                {provider.name}
                            </span>
                            {provider.isConnected ? (
                                <span className="text-sm text-secondary-text">
                                    {t(
                                        'userSettings.security.socialAccounts.connected',
                                    )}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    disabled={!state.canLink}
                                    onClick={() =>
                                        handler.handleConnect(provider.id)
                                    }
                                    className="flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {state.isLinking && (
                                        <LoaderCircle className="h-4 w-4 animate-spin" />
                                    )}
                                    {t(
                                        'userSettings.security.socialAccounts.connect',
                                        { provider: provider.name },
                                    )}
                                </button>
                            )}
                        </div>
                    ))
                )}
                {state.hasUnlinkedProviders && (
                    <>
                        <ReauthenticationInput
                            id="social-account-reauthentication"
                            isTotp={state.reauthenticationMethod === 'totp'}
                            value={state.reauthenticationValue}
                            onChange={handler.handleReauthenticationValueChange}
                            disabled={state.isLinking}
                        />
                        {state.reauthenticationMethod === 'password' && (
                            <p className="text-xs text-secondary-text">
                                {t(
                                    'userSettings.security.socialAccounts.passwordRequiredHint',
                                )}
                            </p>
                        )}
                    </>
                )}
            </div>
        </section>
    )
}
