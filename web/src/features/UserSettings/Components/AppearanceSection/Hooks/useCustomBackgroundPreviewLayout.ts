import { useEffect, useState } from 'react'
import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import { DEFAULT_FONT_SIZE } from '@/config/user-theme-colors.config.ts'
import type { CustomBackgroundPreviewViewport } from '../Types/custom-background-logic.types.ts'

const backgroundPreviewLayoutDimensions = {
    expandedSidebarRem: 18,
    collapsedSidebarRem: 5,
    topbarRem: 4.5,
    minimumSidebarRatio: 0.18,
} as const

export default function useCustomBackgroundPreviewLayout(
    isSidebarCollapsed: boolean,
) {
    const [viewport, setViewport] = useState<CustomBackgroundPreviewViewport>({
        width: IMAGE_UPLOAD_CONFIG.background.width,
        height: IMAGE_UPLOAD_CONFIG.background.height,
        rem: DEFAULT_FONT_SIZE,
    })

    useEffect(() => {
        function updateViewport() {
            const root = document.documentElement
            const width = root.clientWidth || window.innerWidth
            const height = window.innerHeight
            const rem = Number.parseFloat(
                window.getComputedStyle(root).fontSize,
            )

            if (
                width <= 0 ||
                height <= 0 ||
                !Number.isFinite(rem) ||
                rem <= 0
            ) {
                return
            }

            setViewport((previous) =>
                previous.width === width &&
                previous.height === height &&
                previous.rem === rem
                    ? previous
                    : { width, height, rem },
            )
        }

        updateViewport()
        const observer = new ResizeObserver(updateViewport)
        observer.observe(document.documentElement)
        window.addEventListener('resize', updateViewport)

        return () => {
            observer.disconnect()
            window.removeEventListener('resize', updateViewport)
        }
    }, [])

    const sidebarRem = isSidebarCollapsed
        ? backgroundPreviewLayoutDimensions.collapsedSidebarRem
        : backgroundPreviewLayoutDimensions.expandedSidebarRem
    const shellSidebarRatio = (sidebarRem * viewport.rem) / viewport.width
    const previewSidebarRatio = Math.max(
        shellSidebarRatio,
        isSidebarCollapsed
            ? 0
            : backgroundPreviewLayoutDimensions.minimumSidebarRatio,
    )

    return {
        state: {
            aspectRatio:
                (viewport.width * (1 - shellSidebarRatio)) /
                (viewport.height * (1 - previewSidebarRatio)),
            isSidebarCollapsed,
            sidebarWidth: `${previewSidebarRatio * 100}%`,
            topbarHeight: `${(backgroundPreviewLayoutDimensions.topbarRem * viewport.rem * 100) / viewport.height}%`,
        },
    }
}
