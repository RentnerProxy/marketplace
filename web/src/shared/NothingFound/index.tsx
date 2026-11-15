import { FileQuestion } from 'lucide-react'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import Content from '@/shared/NothingFound/Components/Content.tsx'
import Footer from '@/shared/NothingFound/Components/Footer.tsx'

export default function NotFound() {
    return (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background-dark p-4">
            <div className="relative flex flex-col items-center justify-center">
                <HeadingIcon icon={FileQuestion} size="lg" className="mb-6" />

                <div className="flex max-w-md flex-col items-center space-y-4 text-center">
                    <Content />

                    <div className="pt-4 flex justify-center w-full">
                        <Footer />
                    </div>
                </div>
            </div>
        </div>
    )
}
