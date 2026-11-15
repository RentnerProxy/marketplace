import PublicLayout from '@/layouts/PublicLayout/index.tsx'
import { createFileRoute } from '@tanstack/react-router'
import RegisterPage from '@/features/Auth/Register/index.tsx'

export const Route = createFileRoute('/register')({
    component: PublicPageRoute,
})

function PublicPageRoute() {
    return (
        <PublicLayout>
            <div className="mx-auto flex w-full max-w-3xl items-center justify-center px-5 py-12 sm:px-8 sm:py-16">
                <RegisterPage />
            </div>
        </PublicLayout>
    )
}
