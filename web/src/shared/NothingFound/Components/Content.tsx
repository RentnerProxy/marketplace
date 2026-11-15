import useTranslationStore from '@/language/useTranslationStore.ts'

export default function Content() {
    const { t } = useTranslationStore()

    return (
        <>
            <h1 className="text-4xl font-bold text-gray-100 tracking-tight">
                404
            </h1>
            <h2 className="text-xl font-medium text-gray-300">
                {t('shared.notFound.title')}
            </h2>
            <p className="text-gray-400 text-sm leading-relaxed px-4">
                {t('shared.notFound.description')}
            </p>
        </>
    )
}
