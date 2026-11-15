import type { CustomBackgroundLogicReturn } from '../Types/custom-background-logic.types.ts'
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_BACKGROUND_DARKNESS } from '@/config/user-theme-colors.config.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import { getUserBackgroundSrc } from '@/lib/Images/userImageUrls.ts'
import useCustomBackgroundAppearanceMutation from './useCustomBackgroundAppearanceMutation.ts'
import useCustomBackgroundImageMutations from './useCustomBackgroundImageMutations.ts'
import useCustomBackgroundSelection from './useCustomBackgroundSelection.ts'
import useCustomBackgroundPreviewLayout from './useCustomBackgroundPreviewLayout.ts'
import useAuthenticatedShellUiStore from '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedShellUiStore.ts'

export default function useCustomBackgroundLogic(): CustomBackgroundLogicReturn {
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())
    const { state: shellUiState } = useAuthenticatedShellUiStore()
    const previewLayout = useCustomBackgroundPreviewLayout(
        shellUiState.isCollapsed,
    )
    const customBackgroundUpdatedAt =
        sessionData?.user?.customBackgroundUpdatedAt ?? null
    const customBackgroundSrc = getUserBackgroundSrc(
        sessionData?.user?.id,
        customBackgroundUpdatedAt,
    )
    const customBackgroundDarkness =
        sessionData?.user?.customBackgroundDarkness ??
        DEFAULT_BACKGROUND_DARKNESS
    const selection = useCustomBackgroundSelection(customBackgroundSrc)
    const appearance = useCustomBackgroundAppearanceMutation(
        customBackgroundDarkness,
    )
    const imageMutations = useCustomBackgroundImageMutations({
        backgroundCroppedAreaPixels:
            selection.state.backgroundCroppedAreaPixels,
        backgroundImageSrc: selection.state.backgroundImageSrc,
        customBackgroundDarknessValue:
            appearance.state.customBackgroundDarknessValue,
        resetSelectedBackgroundImage:
            selection.handler.handleResetSelectedBackgroundImage,
    })

    return {
        refs: {
            containerRef: selection.refs.containerRef,
        },
        handler: {
            handleBackgroundCropChange:
                selection.handler.handleBackgroundCropChange,
            handleBackgroundCropComplete:
                selection.handler.handleBackgroundCropComplete,
            handleBackgroundDarknessChange:
                appearance.handler.handleBackgroundDarknessChange,
            handleBackgroundZoomChange:
                selection.handler.handleBackgroundZoomChange,
            handleDeleteBackgroundImage:
                imageMutations.handler.handleDeleteBackgroundImage,
            handleResetSelectedBackgroundImage:
                selection.handler.handleResetSelectedBackgroundImage,
            handleSaveBackgroundAppearance:
                appearance.handler.handleSaveBackgroundAppearance,
            handleSaveBackgroundImage:
                imageMutations.handler.handleSaveBackgroundImage,
            handleSelectBackgroundImage:
                selection.handler.handleSelectBackgroundImage,
        },
        state: {
            backgroundCrop: selection.state.backgroundCrop,
            backgroundCroppedAreaPixels:
                selection.state.backgroundCroppedAreaPixels,
            backgroundImageSrc: selection.state.backgroundImageSrc,
            backgroundZoom: selection.state.backgroundZoom,
            cropSize: selection.state.cropSize,
            customBackgroundDarknessValue:
                appearance.state.customBackgroundDarknessValue,
            customBackgroundSrc,
            hasCustomBackground: Boolean(customBackgroundUpdatedAt),
            isDeletingBackgroundImage:
                imageMutations.state.isDeletingBackgroundImage,
            isSavingBackgroundAppearance:
                appearance.state.isSavingBackgroundAppearance,
            isSavingBackgroundImage:
                imageMutations.state.isSavingBackgroundImage,
            previewBackgroundSrc: selection.state.previewBackgroundSrc,
            previewLayout: {
                aspectRatio: previewLayout.state.aspectRatio,
                isSidebarCollapsed: previewLayout.state.isSidebarCollapsed,
                sidebarWidth: previewLayout.state.sidebarWidth,
                topbarHeight: previewLayout.state.topbarHeight,
            },
        },
    }
}
