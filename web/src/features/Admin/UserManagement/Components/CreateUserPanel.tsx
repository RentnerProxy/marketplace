import { EmailInput, TextInput } from '@rentnerkev/inputs'
import { Mail, UserPlus } from 'lucide-react'
import type { CreateUserPanelProps } from '../Types/user-management-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function CreateUserPanel({
    form,
    isCreatingUser,
    onSubmit,
}: CreateUserPanelProps) {
    const { t } = useTranslationStore()

    return (
        <section className="rounded-lg border border-border-dark bg-surface-dark p-5">
            <div className="mb-4 flex items-start gap-3">
                <HeadingIcon icon={UserPlus} />
                <div>
                    <h2 className="text-lg font-bold text-white">
                        {t('admin.users.createTitle')}
                    </h2>
                    <p className="text-sm text-secondary-text">
                        {t('admin.users.createDescription')}
                    </p>
                </div>
            </div>

            <form
                className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]"
                onSubmit={onSubmit}
            >
                <form.Field
                    name="username"
                    children={(field) => (
                        <TextInput
                            id={field.name}
                            value={field.state.value}
                            onValueChange={field.handleChange}
                            required
                            placeholder={t('admin.users.username')}
                            icon={<UserPlus className="h-5 w-5" />}
                            maxLength={50}
                            showLength
                        />
                    )}
                />

                <form.Field
                    name="email"
                    children={(field) => (
                        <EmailInput
                            id={field.name}
                            value={field.state.value}
                            onValueChange={field.handleChange}
                            required
                            placeholder={t('admin.users.email')}
                            icon={<Mail className="h-5 w-5" />}
                            maxLength={255}
                            showLength
                        />
                    )}
                />

                <button
                    type="submit"
                    disabled={isCreatingUser}
                    className="flex h-12 cursor-pointer items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {isCreatingUser
                        ? t('common.saving')
                        : t('admin.users.create')}
                </button>
            </form>
        </section>
    )
}
