import { useSyncExternalStore } from 'react'

function subscribe() {
    return function unsubscribe() {}
}

function getClientSnapshot() {
    return true
}

function getServerSnapshot() {
    return false
}

export default function useHasMounted() {
    return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
