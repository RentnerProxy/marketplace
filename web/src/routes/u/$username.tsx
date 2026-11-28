import { createFileRoute, notFound } from '@tanstack/react-router'
import PublicProfilePage from '@/features/PublicProfile/index.tsx'
import PublicProfileNotFound from '@/features/PublicProfile/Components/PublicProfileNotFound.tsx'
import { buildPublicProfileHead } from '@/features/PublicProfile/seo.ts'
import { publicProfileSearchSchema } from '@/features/Social/validation.ts'
import PublicLayout from '@/layouts/PublicLayout/index.tsx'
import { publicProfileQueryOptions } from '@/lib/Social/socialQueries.ts'

export const Route = createFileRoute('/u/$username')({
    validateSearch: publicProfileSearchSchema,
    loader: async function ({ context, params }) {
        const profile = await context.queryClient.ensureQueryData(
            publicProfileQueryOptions(params.username),
        )
        if (!profile) throw notFound()
        return { username: profile.username }
    },
    head: ({ loaderData }) =>
        loaderData ? buildPublicProfileHead(loaderData.username) : {},
    component: PublicProfileRoute,
    notFoundComponent: PublicProfileNotFoundRoute,
})

function PublicProfileRoute() {
    const { username } = Route.useLoaderData()

    return (
        <PublicLayout>
            <PublicProfilePage username={username} />
        </PublicLayout>
    )
}

function PublicProfileNotFoundRoute() {
    return (
        <PublicLayout>
            <PublicProfileNotFound />
        </PublicLayout>
    )
}
