import * as assert from "assert";
import { extractImageDimensions } from "../image/imageSizeParser";

function createMinimalPng(width: number, height: number): Buffer {
    const buf = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write("IHDR", 12, "ascii");
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
}

function createMinimalJpeg(marker: number, width: number, height: number, withApp0AndDqt = true): Buffer {
    const chunks: Buffer[] = [Buffer.from([0xff, 0xd8])];

    if (withApp0AndDqt) {
        // APP0 (JFIF) segment: FF E0 + len(16) + 14 payload bytes
        const app0 = Buffer.alloc(18);
        app0[0] = 0xff;
        app0[1] = 0xe0;
        app0.writeUInt16BE(16, 2);
        app0.write("JFIF\0", 4, "ascii");
        chunks.push(app0);

        // DQT segment: FF DB + len(67) + 65 payload bytes
        const dqt = Buffer.alloc(69);
        dqt[0] = 0xff;
        dqt[1] = 0xdb;
        dqt.writeUInt16BE(67, 2);
        chunks.push(dqt);

        // DHT (0xFFC4) should be skipped, NOT treated as SOF
        const dht = Buffer.alloc(10);
        dht[0] = 0xff;
        dht[1] = 0xc4;
        dht.writeUInt16BE(8, 2);
        chunks.push(dht);
    }

    // SOF segment: FF marker + len(17) + precision(1) + height(2) + width(2) + components(10)
    const sof = Buffer.alloc(19);
    sof[0] = 0xff;
    sof[1] = marker;
    sof.writeUInt16BE(17, 2);
    sof[4] = 8;
    sof.writeUInt16BE(height, 5);
    sof.writeUInt16BE(width, 7);
    chunks.push(sof);

    chunks.push(Buffer.from([0xff, 0xd9]));
    return Buffer.concat(chunks);
}

function createMinimalGif(width: number, height: number, version: "GIF87a" | "GIF89a" = "GIF89a"): Buffer {
    const buf = Buffer.alloc(10);
    buf.write(version, 0, "ascii");
    buf.writeUInt16LE(width, 6);
    buf.writeUInt16LE(height, 8);
    return buf;
}

function createMinimalWebpLossless(width: number, height: number): Buffer {
    const buf = Buffer.alloc(25);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(17, 4);
    buf.write("WEBP", 8, "ascii");
    buf.write("VP8L", 12, "ascii");
    buf.writeUInt32LE(5, 16);
    buf[20] = 0x2f;
    const packed = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
    buf.writeUInt32LE(packed >>> 0, 21);
    return buf;
}

function createMinimalWebpExtended(width: number, height: number): Buffer {
    const buf = Buffer.alloc(30);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(22, 4);
    buf.write("WEBP", 8, "ascii");
    buf.write("VP8X", 12, "ascii");
    buf.writeUInt32LE(10, 16);
    buf.writeUIntLE(width - 1, 24, 3);
    buf.writeUIntLE(height - 1, 27, 3);
    return buf;
}

suite("Image Size Parser Suite", () => {
    test("extracts width and height from PNG IHDR header", () => {
        const dims = extractImageDimensions(createMinimalPng(1234, 567));
        assert.deepStrictEqual(dims, { width: 1234, height: 567 });
    });

    test("extracts width and height from baseline JPEG (SOF0) past APP0/DQT/DHT segments", () => {
        const dims = extractImageDimensions(createMinimalJpeg(0xc0, 640, 480, true));
        assert.deepStrictEqual(dims, { width: 640, height: 480 });
    });

    test("extracts width and height from progressive JPEG (SOF2)", () => {
        const dims = extractImageDimensions(createMinimalJpeg(0xc2, 1920, 1080, true));
        assert.deepStrictEqual(dims, { width: 1920, height: 1080 });
    });

    test("extracts width and height from GIF87a and GIF89a", () => {
        assert.deepStrictEqual(extractImageDimensions(createMinimalGif(320, 200, "GIF87a")), {
            width: 320,
            height: 200,
        });
        assert.deepStrictEqual(extractImageDimensions(createMinimalGif(150, 90, "GIF89a")), {
            width: 150,
            height: 90,
        });
    });

    test("extracts width and height from WebP VP8L and VP8X", () => {
        assert.deepStrictEqual(extractImageDimensions(createMinimalWebpLossless(512, 384)), {
            width: 512,
            height: 384,
        });
        assert.deepStrictEqual(extractImageDimensions(createMinimalWebpExtended(1024, 768)), {
            width: 1024,
            height: 768,
        });
    });

    test("returns undefined for invalid or truncated buffers", () => {
        assert.strictEqual(extractImageDimensions(Buffer.alloc(0)), undefined);
        assert.strictEqual(extractImageDimensions(Buffer.from("not an image")), undefined);
        assert.strictEqual(extractImageDimensions(createMinimalPng(100, 100).subarray(0, 16)), undefined);
        assert.strictEqual(extractImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), undefined);
    });
});
