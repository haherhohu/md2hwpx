import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { EmbeddedImageItem, MarkdownToken } from "../types";
import { extractImageDimensions } from "../image/imageSizeParser";
import { escapeXmlText, HwpxLayout, SvgHtmlEntityMap } from "../hwpxConstants";

interface ImageMetadata {
    width: number;
    height: number;
    dpi: number;
}

export interface ImageRendererCallbacks {
    generateHwpId: () => number;
    getContentWidth: () => number;
    getCenterParaPrId: () => number;
    createParagraphTag: (runXml: string, paraPrId?: number, pageBreak?: number, styleId?: number) => string;
    createCaptionXml: (captionText: string, side: "TOP" | "BOTTOM", width: number) => string;
}

// 1x1 solid white PNG fallback buffer
const FALLBACK_PNG_BUFFER = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
);

export class ImageRenderer {
    private static wasmInitialized = false;
    private static wasmInitPromise: Promise<void> | undefined = undefined;
    private static cachedFontBuffers: Uint8Array[] | undefined = undefined;
    private static crc32Table: Uint32Array | undefined = undefined;

    private embeddedImages: EmbeddedImageItem[] = [];
    private imageDedupeMap = new Map<string, string>();
    private imageMetadataMap = new Map<string, ImageMetadata>();
    private readonly baseDir: string;
    private readonly callbacks: ImageRendererCallbacks;

    public constructor(baseDir: string, callbacks: ImageRendererCallbacks) {
        this.baseDir = baseDir;
        this.callbacks = callbacks;
    }

    public static async ensureWasmInitialized(): Promise<void> {
        if (ImageRenderer.wasmInitialized) {
            return;
        }
        if (!ImageRenderer.wasmInitPromise) {
            ImageRenderer.wasmInitPromise = (async () => {
                const wasmCandidates = [
                    path.join(__dirname, "index_bg.wasm"),
                    path.resolve(__dirname, "../dist/index_bg.wasm"),
                    path.resolve(__dirname, "../../dist/index_bg.wasm"),
                    path.resolve(__dirname, "../node_modules/@resvg/resvg-wasm/index_bg.wasm"),
                    path.resolve(__dirname, "../../node_modules/@resvg/resvg-wasm/index_bg.wasm"),
                    path.resolve(process.cwd(), "dist/index_bg.wasm"),
                    path.resolve(process.cwd(), "node_modules/@resvg/resvg-wasm/index_bg.wasm"),
                ];
                let wasmPath: string | undefined;
                for (const candidate of wasmCandidates) {
                    if (fs.existsSync(candidate)) {
                        wasmPath = candidate;
                        break;
                    }
                }
                if (!wasmPath) {
                    throw new Error("Could not locate @resvg/resvg-wasm index_bg.wasm");
                }
                const wasmBuffer = fs.readFileSync(wasmPath);
                await initWasm(wasmBuffer);
                ImageRenderer.wasmInitialized = true;
            })();
        }
        await ImageRenderer.wasmInitPromise;
    }

    public reset(): void {
        this.embeddedImages = [];
        this.imageDedupeMap.clear();
        this.imageMetadataMap.clear();
    }

    public getEmbeddedImages(): EmbeddedImageItem[] {
        return this.embeddedImages;
    }

    public createImageParagraph(token: MarkdownToken, maxWidth?: number): string {
        const picRunXml = this.createImagePictureRun(token, maxWidth);
        return this.callbacks.createParagraphTag(picRunXml, this.callbacks.getCenterParaPrId());
    }

    public createImagePictureRun(token: MarkdownToken, maxContainerWidth?: number): string {
        const altText = typeof token.text === "string" && token.text.length > 0 ? token.text : "image";
        const source = typeof token.href === "string" && token.href.length > 0 ? token.href : "inline.svg";
        const svgContent = typeof token.svgContent === "string" ? token.svgContent : undefined;
        const captionComment = source ? `[Image] ${altText} (${source})` : `[Image] ${altText}`;

        const binaryId = this.registerImageAsset(source, svgContent);
        const picId = this.callbacks.generateHwpId();
        const instId = this.callbacks.generateHwpId();

        const maxW = Math.max(1000, maxContainerWidth ?? this.callbacks.getContentWidth());
        const maxH = HwpxLayout.MAX_IMAGE_PAGE_HEIGHT;
        const meta = this.imageMetadataMap.get(binaryId);
        const hwpPerPx = meta ? HwpxLayout.HWPUNIT_PER_INCH / meta.dpi : HwpxLayout.HWPUNIT_PER_INCH / HwpxLayout.DEFAULT_DPI;

        const naturalWidth = meta ? Math.max(1, Math.round(meta.width * hwpPerPx)) : maxW;
        const naturalHeight = meta ? Math.max(1, Math.round(meta.height * hwpPerPx)) : Math.round((maxW * 9) / 16);
        const scale = Math.min(1.0, maxW / naturalWidth, maxH / naturalHeight);

        const width = Math.max(1000, Math.round(naturalWidth * scale));
        const height = Math.max(1000, Math.round(naturalHeight * scale));
        const defaultHwpPerPx = HwpxLayout.HWPUNIT_PER_INCH / HwpxLayout.DEFAULT_DPI;
        const dimWidth = meta ? Math.max(1, Math.round(meta.width * defaultHwpPerPx)) : width;
        const dimHeight = meta ? Math.max(1, Math.round(meta.height * defaultHwpPerPx)) : height;
        const scaleX = (width / naturalWidth).toFixed(6);
        const scaleY = (height / naturalHeight).toFixed(6);

        const captionXml = token.caption
            ? this.callbacks.createCaptionXml(token.caption, token.captionSide ?? "BOTTOM", width)
            : "";

        return (
            `<hp:run charPrIDRef="0">` +
            `<hp:pic id="${picId}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${instId}" reverse="0">` +
            `<hp:offset x="0" y="0"/>` +
            `<hp:orgSz width="${naturalWidth}" height="${naturalHeight}"/>` +
            `<hp:curSz width="${width}" height="${height}"/>` +
            `<hp:flip horizontal="0" vertical="0"/>` +
            `<hp:rotationInfo angle="0"/>` +
            `<hp:renderingInfo>` +
            `<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
            `<hc:scaMatrix e1="${scaleX}" e2="0" e3="0" e4="0" e5="${scaleY}" e6="0"/>` +
            `<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
            `</hp:renderingInfo>` +
            `<hp:imgRect>` +
            `<hc:pt0 x="0" y="0"/>` +
            `<hc:pt1 x="${naturalWidth}" y="0"/>` +
            `<hc:pt2 x="${naturalWidth}" y="${naturalHeight}"/>` +
            `<hc:pt3 x="0" y="${naturalHeight}"/>` +
            `</hp:imgRect>` +
            `<hp:imgClip left="0" right="${dimWidth}" top="0" bottom="${dimHeight}"/>` +
            `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
            `<hp:imgDim dimwidth="${dimWidth}" dimheight="${dimHeight}"/>` +
            `<hc:img binaryItemIDRef="${binaryId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
            `<hp:effects/>` +
            `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
            `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
            `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
            captionXml +
            `<hp:shapeComment>${escapeXmlText(captionComment)}</hp:shapeComment>` +
            `</hp:pic>` +
            `<hp:t/>` +
            `</hp:run>`
        );
    }

    private registerImageAsset(source: string, inlineSvgContent?: string): string {
        if (inlineSvgContent) {
            const hash = crypto.createHash("sha256").update(inlineSvgContent).digest("hex").slice(0, 16);
            const dedupeKey = `svg:${hash}`;
            const existing = this.imageDedupeMap.get(dedupeKey);
            if (existing) {
                return existing;
            }

            const normalizedSvg = this.normalizeSvgString(inlineSvgContent);
            const pngBuffer = this.convertSvgToPngBuffer(normalizedSvg, HwpxLayout.SVG_RENDER_DPI);
            const idx = this.embeddedImages.length + 1;
            const id = `mdimg_${idx}`;
            const filename = `${id}.png`;
            this.embeddedImages.push({
                id,
                filename,
                mimeType: "image/png",
                data: pngBuffer,
            });
            const parsedDims = extractImageDimensions(pngBuffer);
            if (parsedDims && pngBuffer !== FALLBACK_PNG_BUFFER) {
                this.imageMetadataMap.set(id, { ...parsedDims, dpi: HwpxLayout.SVG_RENDER_DPI });
            } else {
                const svgDims = this.extractSvgDimensions(normalizedSvg);
                this.imageMetadataMap.set(id, { ...svgDims, dpi: HwpxLayout.DEFAULT_DPI });
            }
            this.imageDedupeMap.set(dedupeKey, id);
            return id;
        }

        const resolvedFile = this.resolveImageFile(source);
        const dedupeKey = resolvedFile ? `file:${resolvedFile}` : `ref:${source}`;
        const existing = this.imageDedupeMap.get(dedupeKey);
        if (existing) {
            return existing;
        }

        const idx = this.embeddedImages.length + 1;
        const id = `mdimg_${idx}`;
        const sourceExt = path.extname(resolvedFile ?? source).toLowerCase();
        let ext = ".png";
        let mimeType = "image/png";
        let data: Buffer = FALLBACK_PNG_BUFFER;
        let isSvgDerived = false;

        if (resolvedFile && fs.existsSync(resolvedFile)) {
            if (sourceExt === ".svg") {
                ext = ".png";
                mimeType = "image/png";
                const rawSvg = fs.readFileSync(resolvedFile, "utf-8");
                const normalizedSvg = this.normalizeSvgString(rawSvg);
                data = this.convertSvgToPngBuffer(normalizedSvg, HwpxLayout.SVG_RENDER_DPI);
                isSvgDerived = true;
            } else if (sourceExt === ".jpg" || sourceExt === ".jpeg") {
                ext = ".jpg";
                mimeType = "image/jpeg";
                data = fs.readFileSync(resolvedFile);
            } else if (sourceExt === ".gif") {
                ext = ".gif";
                mimeType = "image/gif";
                data = fs.readFileSync(resolvedFile);
            } else if (sourceExt === ".webp") {
                ext = ".webp";
                mimeType = "image/webp";
                data = fs.readFileSync(resolvedFile);
            } else {
                data = fs.readFileSync(resolvedFile);
            }
        } else {
            ext = ".png";
            mimeType = "image/png";
            const placeholderSvg = this.createPlaceholderSvg(source);
            data = this.convertSvgToPngBuffer(placeholderSvg, HwpxLayout.SVG_RENDER_DPI);
            isSvgDerived = true;
        }

        if (data !== FALLBACK_PNG_BUFFER) {
            const parsedDims = extractImageDimensions(data);
            if (parsedDims) {
                this.imageMetadataMap.set(id, {
                    ...parsedDims,
                    dpi: isSvgDerived ? HwpxLayout.SVG_RENDER_DPI : HwpxLayout.DEFAULT_DPI,
                });
            }
        }

        const filename = `${id}${ext}`;
        this.embeddedImages.push({
            id,
            filename,
            mimeType,
            data,
        });
        this.imageDedupeMap.set(dedupeKey, id);
        return id;
    }

    private getSystemCjkFontBuffers(): Uint8Array[] {
        if (ImageRenderer.cachedFontBuffers !== undefined) {
            return ImageRenderer.cachedFontBuffers;
        }

        const candidates = [
            "C:\\Windows\\Fonts\\malgun.ttf",
            "C:\\Windows\\Fonts\\malgunbd.ttf",
            "C:\\Windows\\Fonts\\arial.ttf",
            "C:\\Windows\\Fonts\\arialbd.ttf",
            "C:\\Windows\\Fonts\\seguisym.ttf",
            "/System/Library/Fonts/AppleSDGothicNeo.ttc",
            "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Apple Symbols.ttf",
            "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
            "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ];

        const found: Uint8Array[] = [];
        for (const fontPath of candidates) {
            if (fs.existsSync(fontPath)) {
                try {
                    found.push(new Uint8Array(fs.readFileSync(fontPath)));
                } catch {
                    // Ignore unreadable font file
                }
            }
        }

        ImageRenderer.cachedFontBuffers = found;
        return found;
    }

    private computeCrc32(buf: Buffer): number {
        if (!ImageRenderer.crc32Table) {
            const table = new Uint32Array(256);
            for (let i = 0; i < 256; i += 1) {
                let c = i;
                for (let k = 0; k < 8; k += 1) {
                    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
                }
                table[i] = c >>> 0;
            }
            ImageRenderer.crc32Table = table;
        }
        const table = ImageRenderer.crc32Table;
        let crc = 0xffffffff;
        for (let i = 0; i < buf.length; i += 1) {
            crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    private injectPngDpi(pngBuf: Buffer, dpi = 300): Buffer {
        if (pngBuf.length < 33 || pngBuf.toString("ascii", 12, 16) !== "IHDR") {
            return pngBuf;
        }
        const ppm = Math.round(dpi / 0.0254);
        const physData = Buffer.alloc(9);
        physData.writeUInt32BE(ppm, 0);
        physData.writeUInt32BE(ppm, 4);
        physData.writeUInt8(1, 8);
        const typeAndData = Buffer.concat([Buffer.from("pHYs", "ascii"), physData]);
        const crc = this.computeCrc32(typeAndData);
        const physChunk = Buffer.alloc(4 + 4 + 9 + 4);
        physChunk.writeUInt32BE(9, 0);
        typeAndData.copy(physChunk, 4);
        physChunk.writeUInt32BE(crc, 17);
        return Buffer.concat([pngBuf.subarray(0, 33), physChunk, pngBuf.subarray(33)]);
    }

    private convertSvgToPngBuffer(svgContent: string, dpi = 300): Buffer {
        try {
            const hasText = /<text\b|<tspan\b/i.test(svgContent);
            const fontBuffers = hasText ? this.getSystemCjkFontBuffers() : [];
            const defaultFont =
                process.platform === "win32"
                    ? "Malgun Gothic"
                    : process.platform === "darwin"
                      ? "Apple SD Gothic Neo"
                      : "NanumGothic";

            const resvg = new Resvg(svgContent, {
                dpi,
                fitTo: {
                    mode: "zoom",
                    value: dpi / 96.0,
                },
                background: "#ffffff",
                font: {
                    fontBuffers,
                    defaultFontFamily: defaultFont,
                    sansSerifFamily: defaultFont,
                    serifFamily: defaultFont,
                    monospaceFamily: defaultFont,
                },
            });

            const rendered = resvg.render();
            const rawPng = Buffer.from(rendered.asPng());
            rendered.free();
            resvg.free();
            return this.injectPngDpi(rawPng, dpi);
        } catch (err) {
            console.error("SVG to PNG conversion failed:", err);
            return FALLBACK_PNG_BUFFER;
        }
    }

    private resolveImageFile(source: string): string | undefined {
        if (!source || source === "inline.svg" || /^https?:\/\//i.test(source)) {
            return undefined;
        }

        const candidates = path.isAbsolute(source)
            ? [source]
            : [
                  path.resolve(this.baseDir, source),
                  path.resolve(this.baseDir, "images", path.basename(source)),
                  path.resolve(process.cwd(), source),
                  path.resolve(process.cwd(), "images", path.basename(source)),
              ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return candidate;
            }
        }
        return undefined;
    }

    private normalizeSvgString(svgContent: string): string {
        const svgMatch = svgContent.match(/<svg\b[\s\S]*<\/svg>|<svg\b[^>]*\/>/i);
        let normalizedSvg = svgMatch ? svgMatch[0] : svgContent.trim();

        normalizedSvg = normalizedSvg.replace(/&([a-zA-Z]+);/g, (full, name: string) => {
            if (name === "amp" || name === "lt" || name === "gt" || name === "quot" || name === "apos") {
                return full;
            }
            return SvgHtmlEntityMap[name] ?? full;
        });

        normalizedSvg = normalizedSvg.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
        normalizedSvg = this.normalizeSvgMarkers(normalizedSvg);

        const openTagMatch = normalizedSvg.match(/^<svg\b[^>]*>/i);
        const openTag = openTagMatch ? openTagMatch[0] : "";

        if (!/\bxmlns\s*=/.test(openTag)) {
            normalizedSvg = normalizedSvg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        }

        const dims = this.extractSvgDimensions(normalizedSvg);
        if (!/\bwidth\s*=/.test(openTag)) {
            normalizedSvg = normalizedSvg.replace(/^<svg\b/i, `<svg width="${dims.width}" height="${dims.height}"`);
        }

        return normalizedSvg;
    }

    private normalizeSvgMarkers(svgContent: string): string {
        const autoStartReverseIds = new Set<string>();
        const hasMarkerStart = /\bmarker-start\s*[=:]/i.test(svgContent);

        let updated = svgContent.replace(/<marker\b([^>]*)>([\s\S]*?)<\/marker>/gi, (_full, rawAttrs: string, inner: string) => {
            let attrs = rawAttrs;
            const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
            const markerId = idMatch ? idMatch[1] : undefined;
            const isAutoStartReverse = /\borient\s*=\s*["']\s*auto-start-reverse\s*["']/i.test(attrs);

            if (isAutoStartReverse) {
                attrs = attrs.replace(/\borient\s*=\s*["']\s*auto-start-reverse\s*["']/gi, 'orient="auto"');
                if (markerId && hasMarkerStart) {
                    autoStartReverseIds.add(markerId);
                    const vbMatch = attrs.match(/\bviewBox\s*=\s*["']\s*([-0-9.]+)\s+([-0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*["']/i);
                    let cx = 5;
                    let cy = 5;
                    if (vbMatch) {
                        cx = parseFloat(vbMatch[1]) + parseFloat(vbMatch[3]) / 2;
                        cy = parseFloat(vbMatch[2]) + parseFloat(vbMatch[4]) / 2;
                    } else {
                        const mwMatch = attrs.match(/\bmarkerWidth\s*=\s*["']\s*([0-9.]+)/i);
                        const mhMatch = attrs.match(/\bmarkerHeight\s*=\s*["']\s*([0-9.]+)/i);
                        const mw = mwMatch ? parseFloat(mwMatch[1]) : 10;
                        const mh = mhMatch ? parseFloat(mhMatch[1]) : 10;
                        cx = mw / 2;
                        cy = mh / 2;
                    }

                    const refXMatch = attrs.match(/\brefX\s*=\s*["']\s*([-0-9.]+)/i);
                    const refYMatch = attrs.match(/\brefY\s*=\s*["']\s*([-0-9.]+)/i);
                    const refX = refXMatch ? parseFloat(refXMatch[1]) : cx;
                    const refY = refYMatch ? parseFloat(refYMatch[1]) : cy;
                    const revRefX = 2 * cx - refX;
                    const revRefY = 2 * cy - refY;

                    let revAttrs = attrs.replace(/\bid\s*=\s*["'][^"']+["']/i, `id="${markerId}__start_rev"`);
                    if (refXMatch) {
                        revAttrs = revAttrs.replace(/\brefX\s*=\s*["'][^"']+["']/i, `refX="${revRefX}"`);
                    }
                    if (refYMatch) {
                        revAttrs = revAttrs.replace(/\brefY\s*=\s*["'][^"']+["']/i, `refY="${revRefY}"`);
                    }

                    const revMarker = `<marker${revAttrs}><g transform="rotate(180 ${cx} ${cy})">${inner}</g></marker>`;
                    return `<marker${attrs}>${inner}</marker>${revMarker}`;
                }
            } else if (!/\borient\s*=/i.test(attrs) && markerId && /arrow/i.test(markerId)) {
                attrs = `${attrs} orient="auto"`;
            }

            return `<marker${attrs}>${inner}</marker>`;
        });

        if (autoStartReverseIds.size > 0) {
            for (const markerId of autoStartReverseIds) {
                const escapedId = markerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                updated = updated.replace(
                    new RegExp(`(\\bmarker-start\\s*=\\s*["']\\s*url\\(\\s*#${escapedId})(\\s*\\)\\s*["'])`, "gi"),
                    `$1__start_rev$2`,
                );
                updated = updated.replace(
                    new RegExp(`(\\bmarker-start\\s*:\\s*url\\(\\s*['"]?#${escapedId})(['"]?\\s*\\))`, "gi"),
                    `$1__start_rev$2`,
                );
            }
        }

        return updated;
    }

    private extractSvgDimensions(svgContent: string): { width: number; height: number } {
        const viewBoxMatch = svgContent.match(/\bviewBox\s*=\s*["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)\s*["']/i);
        if (viewBoxMatch) {
            const vbW = parseFloat(viewBoxMatch[1]);
            const vbH = parseFloat(viewBoxMatch[2]);
            if (vbW > 0 && vbH > 0) {
                return { width: vbW, height: vbH };
            }
        }

        const widthMatch = svgContent.match(/\bwidth\s*=\s*["']\s*([0-9.]+)(?:px)?\s*["']/i);
        const heightMatch = svgContent.match(/\bheight\s*=\s*["']\s*([0-9.]+)(?:px)?\s*["']/i);
        if (widthMatch && heightMatch) {
            const w = parseFloat(widthMatch[1]);
            const h = parseFloat(heightMatch[1]);
            if (w > 0 && h > 0) {
                return { width: w, height: h };
            }
        }

        return { width: 800, height: 450 };
    }

    private createPlaceholderSvg(source: string): string {
        const safeLabel = escapeXmlText(path.basename(source));
        return (
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">` +
            `<rect width="800" height="450" fill="#f8fafc" stroke="#94a3b8" stroke-width="2" rx="8"/>` +
            `<text x="400" y="225" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="20" fill="#475569">${safeLabel}</text>` +
            `</svg>`
        );
    }
}
