import { LoaderCircle, Save } from 'lucide-react'
import { APP_STORE_CONFIG } from '@/config/app-store.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useStoreDescriptionLogic from '../Hooks/useStoreDescriptionLogic.ts'
import type { StoreDescriptionEditorProps } from '../Types/app-store-component.types.ts'

export default function StoreDescriptionEditor({
    appId,
    description,
}: StoreDescriptionEditorProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useStoreDescriptionLogic(appId, description)

    return (
        <section
            aria-labelledby="store-description-title"
            className="rounded-lg border border-border-dark bg-surface-dark p-5 sm:p-6"
        >
            <h2 id="store-description-title" className="comic-title text-3xl">
                {t('appStore.description.title')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-secondary-text">
                {t('appStore.description.hint')}
            </p>
            <label className="mt-4 block">
                <span className="sr-only">
                    {t('appStore.description.title')}
                </span>
                <textarea
                    value={state.value}
                    maxLength={APP_STORE_CONFIG.descriptionMaxLength}
                    rows={10}
                    placeholder={t('appStore.description.placeholder')}
                    onChange={(event) =>
                        handler.handleChange(event.target.value)
                    }
                    className="w-full resize-y rounded-md border-2 border-border-dark bg-input-dark p-3 text-sm leading-6 text-foreground outline-none focus:border-primary"
                />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs tabular-nums text-secondary-text">
                    {state.value.length}/{APP_STORE_CONFIG.descriptionMaxLength}
                </span>
                <div className="flex gap-3">
                    <button
                        type="button"
                        disabled={!state.hasChanged || state.isSaving}
                        onClick={handler.handleReset}
                        className="comic-btn comic-btn-sm comic-btn-white"
                    >
                        {t('profile.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={!state.hasChanged || state.isSaving}
                        onClick={handler.handleSave}
                        className="comic-btn comic-btn-sm"
                    >
                        {state.isSaving ? (
                            <LoaderCircle
                                aria-hidden="true"
                                className="h-4 w-4 animate-spin"
                            />
                        ) : (
                            <Save aria-hidden="true" className="h-4 w-4" />
                        )}
                        {t('appStore.description.save')}
                    </button>
                </div>
            </div>
        </section>
    )
}
