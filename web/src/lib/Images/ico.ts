export function createIcoFromPngBuffer(pngBuffer: Buffer) {
    const headerSize = 6
    const entrySize = 16
    const imageOffset = headerSize + entrySize
    const icoBuffer = Buffer.alloc(imageOffset + pngBuffer.length)

    icoBuffer.writeUInt16LE(0, 0)
    icoBuffer.writeUInt16LE(1, 2)
    icoBuffer.writeUInt16LE(1, 4)
    icoBuffer.writeUInt8(32, 6)
    icoBuffer.writeUInt8(32, 7)
    icoBuffer.writeUInt8(0, 8)
    icoBuffer.writeUInt8(0, 9)
    icoBuffer.writeUInt16LE(1, 10)
    icoBuffer.writeUInt16LE(32, 12)
    icoBuffer.writeUInt32LE(pngBuffer.length, 14)
    icoBuffer.writeUInt32LE(imageOffset, 18)

    pngBuffer.copy(icoBuffer, imageOffset)

    return icoBuffer
}
