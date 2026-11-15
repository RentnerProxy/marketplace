import RestoreProgressCard from './Components/RestoreProgressCard.tsx'
import useRestoreProgressLogic from './Hooks/useRestoreProgressLogic.ts'

export default function RestoreProgress() {
    const { state } = useRestoreProgressLogic()

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background-dark px-4 py-8 text-white">
            <RestoreProgressCard {...state} />
        </main>
    )
}
