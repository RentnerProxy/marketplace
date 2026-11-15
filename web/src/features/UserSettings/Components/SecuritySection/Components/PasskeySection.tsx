import { motion } from 'motion/react'
import {
    CalendarClock,
    Fingerprint,
    KeyRound,
    LoaderCircle,
    Trash2,
} from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import usePasskeyLogic from '@/features/UserSettings/Components/SecuritySection/Hooks/usePasskeyLogic.ts'
import { formatDate, formatNullableDate } from '@/lib/Date/date.ts'
import ReauthenticationInput from './ReauthenticationInput.tsx'
import SecurityChangeLoginNotice from './SecurityChangeLoginNotice.tsx'

export default function PasskeySection() {
    const { t } = useTranslationStore()
    const { state, handler } = usePasskeyLogic()

    return (
        <motion.section
            layout
            className="relative overflow-hidden rounded-lg border border-border-dark bg-input-dark/50 p-4"
        >
            {state.isReauthenticationRequired && (
                <div className="relative mb-4">
                    <SecurityChangeLoginNotice />
                </div>
            )}
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <Fingerprint className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold text-white">
                            {t('userSettings.security.passkeysTitle')}
                        </h3>
                    </div>

                    <p className="mt-1 text-sm text-secondary-text">
                        {t('userSettings.security.passkeysDescription')}
                    </p>
                </div>

                <div className="w-full space-y-3 sm:max-w-sm">
                    <ReauthenticationInput
                        id="passkey-reauthentication"
                        isTotp={state.reauthenticationMethod === 'totp'}
                        value={state.reauthenticationValue}
                        disabled={
                            state.isAddingPasskey ||
                            state.isDeletingPasskey ||
                            state.isLoadingReauthenticationMethod ||
                            state.isReauthenticationRequired
                        }
                        onChange={handler.handleReauthenticationValueChange}
                    />
                    <motion.button
                        type="button"
                        disabled={
                            state.isAddingPasskey ||
                            state.isDeletingPasskey ||
                            !state.isReauthenticationReady
                        }
                        onClick={handler.handleAddPasskey}
                        whileTap={
                            state.isAddingPasskey ||
                            state.isDeletingPasskey ||
                            !state.isReauthenticationReady
                                ? undefined
                                : { scale: 0.97 }
                        }
                        className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {state.isAddingPasskey ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                            <KeyRound className="h-4 w-4" />
                        )}

                        {state.isAddingPasskey
                            ? t('userSettings.security.passkeyAdding')
                            : t('userSettings.security.passkeyAdd')}
                    </motion.button>
                </div>
            </div>

            <div className="relative mt-4 space-y-3">
                {state.isLoadingPasskeys ? (
                    <div className="flex items-center gap-2 rounded-md border border-border-dark bg-surface-dark/60 px-3 py-2 text-sm text-secondary-text">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        {t('userSettings.security.passkeysLoading')}
                    </div>
                ) : state.passkeys.length === 0 ? (
                    <div className="rounded-md border border-border-dark bg-surface-dark/60 px-3 py-2 text-sm text-secondary-text">
                        {t('userSettings.security.passkeysEmpty')}
                    </div>
                ) : (
                    <>
                        {state.passkeys.map((passkey) => {
                            const createdAt = formatDate(passkey.createdAt)
                            const lastUsedAt = formatNullableDate(
                                passkey.lastUsedAt,
                                '',
                            )
                            const isDeleting =
                                state.isDeletingPasskey &&
                                state.deletingPasskeyId === passkey.id

                            return (
                                <div
                                    key={passkey.id}
                                    className="flex flex-col gap-3 rounded-md border border-border-dark bg-surface-dark/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div>
                                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                                            <Fingerprint className="h-4 w-4 text-primary" />
                                            {passkey.name}
                                        </div>

                                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-secondary-text">
                                            {createdAt && (
                                                <span className="inline-flex items-center gap-1 rounded-md border border-border-dark px-2 py-1">
                                                    <CalendarClock className="h-3.5 w-3.5" />
                                                    {t(
                                                        'userSettings.security.passkeyCreatedAt',
                                                    )}
                                                    : {createdAt}
                                                </span>
                                            )}

                                            <span className="inline-flex items-center gap-1 rounded-md border border-border-dark px-2 py-1">
                                                {passkey.backedUp
                                                    ? t(
                                                          'userSettings.security.passkeyBackedUp',
                                                      )
                                                    : t(
                                                          'userSettings.security.passkeySingleDevice',
                                                      )}
                                            </span>

                                            {lastUsedAt && (
                                                <span className="inline-flex items-center gap-1 rounded-md border border-border-dark px-2 py-1">
                                                    {t(
                                                        'userSettings.security.passkeyLastUsedAt',
                                                    )}
                                                    : {lastUsedAt}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        disabled={
                                            state.isAddingPasskey ||
                                            state.isDeletingPasskey ||
                                            !state.isReauthenticationReady
                                        }
                                        onClick={() =>
                                            handler.handleDeletePasskey(
                                                passkey.id,
                                            )
                                        }
                                        className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-background-dark px-3 text-sm font-semibold text-danger transition-colors hover:border-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {isDeleting ? (
                                            <LoaderCircle className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                        {t(
                                            'userSettings.security.passkeyDelete',
                                        )}
                                    </button>
                                </div>
                            )
                        })}
                    </>
                )}
            </div>
        </motion.section>
    )
}
