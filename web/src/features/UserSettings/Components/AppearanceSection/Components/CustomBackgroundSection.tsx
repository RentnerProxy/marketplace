import { Image, Upload } from 'lucide-react'
import CustomBackgroundControls from './CustomBackgroundControls.tsx'
import CustomBackgroundPreview from './CustomBackgroundPreview.tsx'
import useCustomBackgroundLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useCustomBackgroundLogic.ts'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function CustomBackgroundSection() {
    const { t } = useTranslationStore()
    const { refs, handler, state } = useCustomBackgroundLogic()

    return (
        <section className="rounded-lg border border-border-dark bg-input-dark/50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <Image className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold text-white">
                            {t('userSettings.background.custom')}
                        </h3>
                    </div>
                    <p className="mt-1 text-sm text-secondary-text">
                        {t('userSettings.background.description')}
                    </p>
                </div>

                <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover">
                    <Upload className="h-4 w-4" />
                    {t('userSettings.background.choose')}
                    <input
                        type="file"
                        accept={IMAGE_UPLOAD_CONFIG.allowedMimeTypes.join(',')}
                        className="hidden"
                        onChange={(event) =>
                            handler.handleSelectBackgroundImage(
                                event.target.files?.[0] ?? null,
                            )
                        }
                    />
                </label>
            </div>

            <CustomBackgroundPreview
                containerRef={refs.containerRef}
                handler={handler}
                state={state}
            />

            <CustomBackgroundControls handler={handler} state={state} />
        </section>
    )
}
