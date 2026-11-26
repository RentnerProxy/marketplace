import { Link } from '@tanstack/react-router'
import { FileQuestion, Home } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function NotFound() {
    const { t } = useTranslationStore()
    const backToDashboard = t('shared.notFound.backToDashboard')

    return (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background-dark p-4">
            <div className="relative flex flex-col items-center justify-center">
                <HeadingIcon icon={FileQuestion} size="lg" className="mb-6" />

                <div className="flex max-w-md flex-col items-center space-y-4 text-center">
                    <h1 className="text-4xl font-bold text-gray-100 tracking-tight">
                        404
                    </h1>
                    <h2 className="text-xl font-medium text-gray-300">
                        {t('shared.notFound.title')}
                    </h2>
                    <p className="text-gray-400 text-sm leading-relaxed px-4">
                        {t('shared.notFound.description')}
                    </p>

                    <div className="pt-4 flex justify-center w-full">
                        <Link
                            aria-label={backToDashboard}
                            to="/"
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
                        >
                            <Home size={18} />
                            {backToDashboard}
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    )
}
