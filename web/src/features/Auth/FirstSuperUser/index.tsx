import AccountSection from './Components/AccountSection.tsx'
import SetupHeader from './Components/SetupHeader.tsx'
import SetupSubmitButton from './Components/SetupSubmitButton.tsx'
import SetupAccessNotice from './Components/SetupAccessNotice.tsx'
import useCreateFirstSuperUserAccountLogic from './Hooks/useCreateFirstSuperUserAccountLogic.ts'

export default function CreateFirstSuperUserAccountPage() {
    const { state, handler, setter } = useCreateFirstSuperUserAccountLogic()

    if (state.setupAccessState !== 'granted') {
        return (
            <main className="flex min-h-screen w-full items-center justify-center bg-background-dark px-4 py-8 text-white">
                <section className="w-full max-w-2xl rounded-lg border border-border-dark bg-surface-dark p-6 md:p-8">
                    <SetupHeader />
                    <SetupAccessNotice
                        isChecking={state.setupAccessState === 'checking'}
                    />
                </section>
            </main>
        )
    }

    return (
        <main className="flex min-h-screen w-full items-center justify-center bg-background-dark px-4 py-8 text-white">
            <section className="w-full max-w-2xl rounded-lg border border-border-dark bg-surface-dark p-6 md:p-8">
                <SetupHeader />

                <form onSubmit={handler.handleSubmit} className="space-y-6">
                    <AccountSection
                        values={state.formValues}
                        onFieldChange={setter.setFieldValue}
                    />

                    <SetupSubmitButton isCreating={state.isCreating} />
                </form>
            </section>
        </main>
    )
}
