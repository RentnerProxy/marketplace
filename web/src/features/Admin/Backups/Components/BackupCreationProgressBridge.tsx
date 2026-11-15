import useBackupCreationProgressBridgeLogic from '../Hooks/useBackupCreationProgressBridgeLogic.ts'
import type { BackupCreationProgressBridgeProps } from '../Types/backup-component-props.types.ts'

export default function BackupCreationProgressBridge({
    userId,
}: BackupCreationProgressBridgeProps) {
    useBackupCreationProgressBridgeLogic(userId)
    return null
}
