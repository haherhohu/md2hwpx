import * as JSZip from "jszip";
import * as fs from "fs";
import * as path from "path";
import { HwpxXmlRenderer } from "./hwpxXmlRenderer";
import { MarkdownPipeline } from "./markdownPipeline";
import { EmbeddedImageItem } from "./types";

export class HwpxGenerator {
    private readonly markdownPipeline = new MarkdownPipeline();

    public async generate(mdContent: string, templatePath: string, outputPath: string, baseDir?: string) {
        try {
            const effectiveBaseDir = baseDir ?? path.dirname(path.resolve(outputPath));
            const renderer = new HwpxXmlRenderer(effectiveBaseDir);
            const resolvedTemplatePath = this.resolveTemplatePath(templatePath);
            const templateBuffer = fs.readFileSync(resolvedTemplatePath);
            const zip = await JSZip.loadAsync(templateBuffer);

            const sectionXmlFile = zip.file("Contents/section0.xml");
            if (!sectionXmlFile) {
                throw new Error("템플릿 파일 형식이 올바르지 않습니다.");
            }
            const rawSectionXml = await sectionXmlFile.async("string");
            const contentWidth = this.extractContentWidthFromSectionXml(rawSectionXml);
            renderer.setContentWidth(contentWidth);

            const headerXmlFile = zip.file("Contents/header.xml");
            let headerXml = "";
            if (headerXmlFile) {
                headerXml = await headerXmlFile.async("string");
                const updatedHeaderXml = renderer.prepareHeaderXml(headerXml);
                zip.file("Contents/header.xml", updatedHeaderXml);
                headerXml = updatedHeaderXml;
            }

            const parsedTokens = this.markdownPipeline.parseMarkdown(mdContent);
            const normalizedTokens = this.markdownPipeline.normalizeTokens(parsedTokens);
            const hwpxXmlContent = renderer.renderTokens(normalizedTokens);

            if (headerXml) {
                const finalizedHeaderXml = renderer.finalizeHeaderXml(headerXml);
                zip.file("Contents/header.xml", finalizedHeaderXml);
            }

            const cleanedSectionXml = this.buildCleanSectionXml(rawSectionXml, hwpxXmlContent);
            zip.file("Contents/section0.xml", cleanedSectionXml);

            const embeddedImages = renderer.getEmbeddedImages();
            if (embeddedImages.length > 0) {
                for (const img of embeddedImages) {
                    zip.file(`BinData/${img.filename}`, img.data);
                }
                const contentHpfFile = zip.file("Contents/content.hpf");
                if (contentHpfFile) {
                    const rawHpf = await contentHpfFile.async("string");
                    const updatedHpf = this.injectImagesToContentHpf(rawHpf, embeddedImages);
                    zip.file("Contents/content.hpf", updatedHpf);
                }
            }

            const generatedBuffer = await zip.generateAsync({ type: "nodebuffer" });
            fs.writeFileSync(outputPath, generatedBuffer);
        } catch (error) {
            console.error("HWPX 생성 중 오류 발생:", error);
            throw error;
        }
    }

    private extractContentWidthFromSectionXml(sectionXml: string): number {
        const pagePrMatch = sectionXml.match(/<([a-zA-Z0-9]+:)?pagePr\b([^>]*)>([\s\S]*?)<\/([a-zA-Z0-9]+:)?pagePr>/);
        if (pagePrMatch) {
            const pagePrAttrs = pagePrMatch[2] ?? "";
            const pagePrInner = pagePrMatch[3] ?? "";
            const widthMatch = pagePrAttrs.match(/\bwidth="(\d+)"/);
            const marginMatch = pagePrInner.match(/<([a-zA-Z0-9]+:)?margin\b([^>]*)\/>/);
            if (widthMatch && marginMatch) {
                const pageWidth = parseInt(widthMatch[1], 10);
                const marginAttrs = marginMatch[2] ?? "";
                const left = parseInt(marginAttrs.match(/\bleft="(\d+)"/)?.[1] ?? "0", 10);
                const right = parseInt(marginAttrs.match(/\bright="(\d+)"/)?.[1] ?? "0", 10);
                const gutter = parseInt(marginAttrs.match(/\bgutter="(\d+)"/)?.[1] ?? "0", 10);
                const computed = pageWidth - left - right - gutter;
                if (computed > 10000) {
                    return computed;
                }
            }
        }
        return 42520;
    }

    private buildCleanSectionXml(sectionXml: string, hwpxXmlContent: string): string {
        const secOpenMatch = sectionXml.match(/^[\s\S]*?<([a-zA-Z0-9]+:)?sec\b[^>]*>/);
        const secCloseMatch = sectionXml.match(/<\/([a-zA-Z0-9]+:)?sec>\s*$/);

        const secPrMatch = sectionXml.match(/<([a-zA-Z0-9]+:)?secPr\b[\s\S]*?<\/([a-zA-Z0-9]+:)?secPr>/);
        const colPrCtrlMatch = sectionXml.match(
            /<([a-zA-Z0-9]+:)?ctrl>\s*<([a-zA-Z0-9]+:)?colPr\b[\s\S]*?<\/([a-zA-Z0-9]+:)?ctrl>/,
        );

        if (secOpenMatch && secCloseMatch && secPrMatch) {
            const secOpen = secOpenMatch[0];
            const secClose = secCloseMatch[0];
            const secPrXml = secPrMatch[0];
            const colPrXml = colPrCtrlMatch
                ? colPrCtrlMatch[0]
                : `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>`;

            const initRun = `<hp:run charPrIDRef="0">${secPrXml}${colPrXml}</hp:run>`;
            if (/^\s*<hp:p\b[^>]*>/.test(hwpxXmlContent)) {
                const mergedContent = hwpxXmlContent.replace(/^(\s*<hp:p\b[^>]*>)/, `$1${initRun}`);
                return `${secOpen}${mergedContent}${secClose}`;
            }

            const initParagraph = `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${secPrXml}${colPrXml}<hp:t/></hp:run></hp:p>`;
            return `${secOpen}${initParagraph}${hwpxXmlContent}${secClose}`;
        }

        const sectionEndMarker = "</hs:sec>";
        if (sectionXml.includes(sectionEndMarker)) {
            return sectionXml.replace(sectionEndMarker, `${hwpxXmlContent}${sectionEndMarker}`);
        }
        return sectionXml.replace(/<\/\w*:?sec>/i, `${hwpxXmlContent}$&`);
    }

    private injectImagesToContentHpf(hpfXml: string, images: EmbeddedImageItem[]): string {
        const insertMarker = "</opf:manifest>";
        if (!hpfXml.includes(insertMarker)) {
            return hpfXml;
        }

        const newItems: string[] = [];
        for (const img of images) {
            const itemPattern = new RegExp(`id="${img.id}"`);
            if (!itemPattern.test(hpfXml)) {
                newItems.push(
                    `<opf:item id="${img.id}" href="BinData/${img.filename}" media-type="${img.mimeType}" isEmbeded="1"/>`,
                );
            }
        }

        if (newItems.length === 0) {
            return hpfXml;
        }

        return hpfXml.replace(insertMarker, `${newItems.join("")}${insertMarker}`);
    }

    private resolveTemplatePath(templatePath: string): string {
        if (templatePath && fs.existsSync(templatePath)) {
            return templatePath;
        }

        const candidatePaths = [
            templatePath,
            "template.hwpx",
            "./template.hwpx",
            path.join(process.cwd(), "template.hwpx"),
            path.resolve(__dirname, "../template.hwpx"),
            path.resolve(__dirname, "../../template.hwpx"),
        ];

        for (const candidate of candidatePaths) {
            if (candidate && fs.existsSync(candidate)) {
                return candidate;
            }
        }

        throw new Error(`템플릿 파일을 찾을 수 없습니다: ${templatePath}`);
    }
}
