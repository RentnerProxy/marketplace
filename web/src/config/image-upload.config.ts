export const IMAGE_UPLOAD_CONFIG = {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
    maxInputBytes: 8 * 1024 * 1024,
    maxInputPixels: 40000000,
    profile: {
        width: 512,
        height: 512,
        quality: 90,
        thumbnailWidth: 64,
        thumbnailHeight: 64,
        thumbnailQuality: 85,
    },
    background: {
        width: 1920,
        height: 1080,
        quality: 88,
    },
    systemLogo: {
        width: 512,
        height: 512,
        quality: 90,
        thumbnailWidth: 64,
        thumbnailHeight: 64,
        thumbnailQuality: 85,
    },
} as const
