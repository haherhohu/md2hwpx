import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as JSZip from "jszip";
import { HwpxGenerator } from "../hwpxGenerator";
import { MarkdownPipeline } from "../markdownPipeline";

async function generateSectionXml(markdown: string): Promise<string> {
    const generator = new HwpxGenerator();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2hwpx-test-"));
    const outputPath = path.join(tempDir, "output.hwpx");
    const templatePath = path.resolve(__dirname, "../../template.hwpx");

    await generator.generate(markdown, templatePath, outputPath);

    const fileBuffer = fs.readFileSync(outputPath);
    const zip = await JSZip.loadAsync(fileBuffer);
    const sectionXmlFile = zip.file("Contents/section0.xml");
    assert.ok(sectionXmlFile, "section0.xml should exist in generated output");

    return sectionXmlFile!.async("string");
}

suite("HWPX Generator Regression Suite", () => {
    test("normalizes blockquote-wrapped table into plain table token", () => {
        const pipeline = new MarkdownPipeline();
        const tokens = pipeline.parseMarkdown(`> | A | B |\n> | - | - |\n> | 1 | 2 |`);
        const normalized = pipeline.normalizeTokens(tokens);

        assert.ok(normalized.some((token) => token.type === "table"));
        assert.ok(!normalized.some((token) => token.type === "blockquote"));
    });

    test("renders table with non treat-as-character placement", async () => {
        const sectionXml = await generateSectionXml(`| A | B |\n| - | - |\n| 1 | 2 |`);
        assert.ok(sectionXml.includes('<hp:pos treatAsChar="0"/>'));
    });

    test("renders plain blockquote as quote-box table", async () => {
        const sectionXml = await generateSectionXml(`> just quote`);
        assert.ok(sectionXml.includes("just quote"));
        assert.ok(sectionXml.includes("<hp:tbl"));
    });

    test("renders plain tables and mixed list+table without dropping tables", async () => {
        const sectionXml = await generateSectionXml(`- item 1\n  - sub item\n\n| H1 | H2 |\n| - | - |\n| v1 | v2 |`);
        assert.ok(sectionXml.includes("<hp:tbl"));
        assert.ok(sectionXml.includes("item 1"));
        assert.ok(sectionXml.includes("sub item"));
    });

    test("renders long tables without table omission", async () => {
        const rows = Array.from({ length: 60 }, (_, i) => `| row-${i} | value-${i} |`).join("\n");
        const sectionXml = await generateSectionXml(`| C1 | C2 |\n| - | - |\n${rows}`);
        const tableCount = (sectionXml.match(/<hp:tbl/g) || []).length;
        assert.ok(tableCount >= 1);
    });
});
