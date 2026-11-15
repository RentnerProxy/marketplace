export function readImageFileAsDataUrl(
    file: File,
    onLoad: (imageSource: string) => void,
): void {
    const reader = new FileReader()
    reader.addEventListener(
        'load',
        function () {
            if (typeof reader.result === 'string') {
                onLoad(reader.result)
            }
        },
        { once: true },
    )
    reader.readAsDataURL(file)
}
