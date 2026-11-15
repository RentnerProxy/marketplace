import useTranslationStore from '@/language/useTranslationStore.ts'
import { legalContent, legalOperator } from '../legal-content.ts'
import type { LegalPageKind, LegalPageLogicReturn } from '../Types/legal-content.types.ts'

export default function useLegalPageLogic(kind: LegalPageKind): LegalPageLogicReturn {
    const { language } = useTranslationStore()
    const locale = language === 'de' ? 'de' : 'en'

    return {
        state: {
            page: legalContent[locale][kind],
            contentLanguage: locale,
            email: legalOperator.email,
            siblingPath: kind === 'imprint' ? '/privacy' : '/imprint',
        },
    }
}
