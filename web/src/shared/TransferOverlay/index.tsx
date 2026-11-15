import TransferOverlayItem from './Components/TransferOverlayItem.tsx'
import useTransferOverlayTasks from './Hooks/useTransferOverlayTasks.ts'

export default function TransferOverlay() {
    const { state, handler } = useTransferOverlayTasks()

    if (state.tasks.length === 0) {
        return null
    }

    return (
        <div className="fixed right-4 bottom-4 z-[110] flex flex-col gap-3">
            {state.tasks.map((task) => (
                <TransferOverlayItem
                    key={task.id}
                    task={task}
                    onDismiss={handler.handleDismissTask}
                />
            ))}
        </div>
    )
}
