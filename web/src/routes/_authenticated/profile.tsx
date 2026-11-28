import { createFileRoute } from '@tanstack/react-router'
import UserProfilePage from '@/features/UserProfile/index.tsx'
import { userProfileSearchSchema } from '@/features/UserProfile/validation.ts'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/profile')({
    validateSearch: userProfileSearchSchema,
    component: UserProfilePage,
    errorComponent: RouteErrorComponent,
})
