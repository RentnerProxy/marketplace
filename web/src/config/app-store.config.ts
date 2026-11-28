/** Limits of the web-editable store listing (logo, gallery, description). */
export const APP_STORE_CONFIG = {
    descriptionMaxLength: 5000,
    maxScreenshots: 8,
    screenshotAspectRatio: 16 / 9,
    logo: { width: 512, height: 512, quality: 90 },
    screenshot: { width: 1920, height: 1080, quality: 85 },
    catalogLimit: 200,
} as const
