import * as JSZip from "jszip";
import * as fs from "fs";
import { HwpxXmlRenderer } from "./hwpxXmlRenderer";
import { MarkdownPipeline } from "./markdownPipeline";

export class HwpxGenerator {
    private readonly markdownPipeline = new MarkdownPipeline();

    public async generate(mdContent: string, templatePath: string, outputPath: string) {
        try {
            const renderer = new HwpxXmlRenderer();
            const templateBuffer = fs.readFileSync(templatePath);
            const zip = await JSZip.loadAsync(templateBuffer);

            const headerXmlFile = zip.file("Contents/header.xml");
            if (headerXmlFile) {
                const headerXml = await headerXmlFile.async("string");
                const updatedHeaderXml = renderer.prepareHeaderXml(headerXml);
                zip.file("Contents/header.xml", updatedHeaderXml);
            }

            const parsedTokens = this.markdownPipeline.parseMarkdown(mdContent);
            const normalizedTokens = this.markdownPipeline.normalizeTokens(parsedTokens);
            const hwpxXmlContent = renderer.renderTokens(normalizedTokens);

            const sectionXmlFile = zip.file("Contents/section0.xml");
            if (!sectionXmlFile) {
                throw new Error("템플릿 파일 형식이 올바르지 않습니다.");
            }

            let sectionXml = await sectionXmlFile.async("string");
            if (sectionXml.includes("</hs:sec>")) {
                sectionXml = sectionXml.replace("</hs:sec>", `${hwpxXmlContent}</hs:sec>`);
            } else {
                sectionXml = sectionXml.replace(/<\/[a-zA-Z0-9:]*sec>/i, `${hwpxXmlContent}$&`);
            }

            zip.file("Contents/section0.xml", sectionXml);
            const generatedBuffer = await zip.generateAsync({ type: "nodebuffer" });
            fs.writeFileSync(outputPath, generatedBuffer);
        } catch (error) {
            console.error("HWPX 생성 중 오류 발생:", error);
            throw error;
        }
    }
}
