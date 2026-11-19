export interface ImageDimensions {
    width: number;
    height: number;
}

function parsePngDimensions(buffer: Buffer): ImageDimensions | undefined {
    if (buffer.length < 24) {
        return undefined;
    }
    const isPngSignature =
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a;
    if (!isPngSignature || buffer.toString("ascii", 12, 16) !== "IHDR") {
        return undefined;
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
}

function parseJpegDimensions(buffer: Buffer): ImageDimensions | undefined {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return undefined;
    }

    let offset = 2;
    while (offset < buffer.length) {
        while (offset < buffer.length && buffer[offset] !== 0xff) {
            offset += 1;
        }
        while (offset + 1 < buffer.length && buffer[offset + 1] === 0xff) {
            offset += 1;
        }
        if (offset + 1 >= buffer.length) {
            break;
        }

        const marker = buffer[offset + 1];
        if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            offset += 2;
            continue;
        }
        if (marker === 0xd9 || marker === 0xda) {
            break;
        }
        if (offset + 3 >= buffer.length) {
            break;
        }

        const segmentLength = buffer.readUInt16BE(offset + 2);
        if (segmentLength < 2) {
            break;
        }

        const isSofMarker =
            marker >= 0xc0 &&
            marker <= 0xcf &&
            marker !== 0xc4 &&
            marker !== 0xc8 &&
            marker !== 0xcc;
        if (isSofMarker) {
            if (offset + 8 >= buffer.length) {
                break;
            }
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            return width > 0 && height > 0 ? { width, height } : undefined;
        }

        offset += 2 + segmentLength;
    }

    return undefined;
}

function parseGifDimensions(buffer: Buffer): ImageDimensions | undefined {
    if (buffer.length < 10) {
        return undefined;
    }
    const sig = buffer.toString("ascii", 0, 6);
    if (sig !== "GIF87a" && sig !== "GIF89a") {
        return undefined;
    }
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    return width > 0 && height > 0 ? { width, height } : undefined;
}

function parseWebpDimensions(buffer: Buffer): ImageDimensions | undefined {
    if (
        buffer.length < 25 ||
        buffer.toString("ascii", 0, 4) !== "RIFF" ||
        buffer.toString("ascii", 8, 12) !== "WEBP"
    ) {
        return undefined;
    }

    const chunkType = buffer.toString("ascii", 12, 16);
    if (chunkType === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (chunkType === "VP8L" && buffer[20] === 0x2f) {
        const bits = buffer.readUInt32LE(21);
        const width = (bits & 0x3fff) + 1;
        const height = ((bits >> 14) & 0x3fff) + 1;
        return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (chunkType === "VP8X" && buffer.length >= 30) {
        const width = 1 + buffer.readUIntLE(24, 3);
        const height = 1 + buffer.readUIntLE(27, 3);
        return width > 0 && height > 0 ? { width, height } : undefined;
    }

    return undefined;
}

/**
 * Extracts pixel width and height directly from binary image headers (PNG, JPEG, GIF, WebP).
 */
export function extractImageDimensions(buffer: Buffer): ImageDimensions | undefined {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
        return undefined;
    }
    return (
        parsePngDimensions(buffer) ??
        parseJpegDimensions(buffer) ??
        parseGifDimensions(buffer) ??
        parseWebpDimensions(buffer)
    );
}
