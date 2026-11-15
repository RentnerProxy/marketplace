import { createFileRoute } from '@tanstack/react-router'
import RegisterPage from '@/features/Auth/Register/index.tsx'

export const Route = createFileRoute('/_public/register')({
    component: RegisterPage,
})
