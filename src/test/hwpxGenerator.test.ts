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

    test("normalizes blockquote-wrapped html table into plain table token", () => {
        const pipeline = new MarkdownPipeline();
        const tokens = pipeline.parseMarkdown(`> <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>`);
        const normalized = pipeline.normalizeTokens(tokens);

        assert.ok(normalized.some((token) => token.type === "table"));
        assert.ok(!normalized.some((token) => token.type === "blockquote"));
    });

    test("renders table with non treat-as-character placement", async () => {
        const sectionXml = await generateSectionXml(`| A | B |\n| - | - |\n| 1 | 2 |`);
        assert.ok(sectionXml.includes('<hp:pos treatAsChar="0"/>'));
    });

    test("renders plain blockquote as normal text content", async () => {
        const sectionXml = await generateSectionXml(`> just quote`);
        assert.ok(sectionXml.includes("just quote"));
        assert.ok(!sectionXml.includes("<hp:tbl"));
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

    test("renders six-level nested list content", async () => {
        const sectionXml = await generateSectionXml(
            `- l1\n  - l2\n    - l3\n      - l4\n        - l5\n          - l6`,
        );

        assert.ok(sectionXml.includes("l1"));
        assert.ok(sectionXml.includes("l6"));
        assert.ok(sectionXml.includes("▫") || sectionXml.includes("‣"));
    });

    test("renders markdown image token as image placeholder paragraph content", async () => {
        const sectionXml = await generateSectionXml(`![alt text](./assets/sample.png)`);
        assert.ok(sectionXml.includes("[Image] alt text (./assets/sample.png)"));
    });

    test("renders horizontal rule as page break paragraph", async () => {
        const sectionXml = await generateSectionXml(`before\n\n---\n\nafter`);
        assert.ok(sectionXml.includes("before"));
        assert.ok(sectionXml.includes("after"));
        assert.ok(sectionXml.includes('pageBreak="1"'));
    });

    test("renders markdown links as numbered markers and appends endnotes", async () => {
        const sectionXml = await generateSectionXml(`문장 [A](https://a.example) 과 [B](https://b.example)`);
        assert.ok(sectionXml.includes("A[1]"));
        assert.ok(sectionXml.includes("B[2]"));
        assert.ok(sectionXml.includes("미주"));
        assert.ok(sectionXml.includes("[1] https://a.example"));
        assert.ok(sectionXml.includes("[2] https://b.example"));
    });

    test("reuses the same endnote index for duplicate link urls", async () => {
        const sectionXml = await generateSectionXml(`[A](https://a.example) and [A2](https://a.example)`);
        assert.ok(sectionXml.includes("A[1]"));
        assert.ok(sectionXml.includes("A2[1]"));
        assert.ok(!sectionXml.includes("[2] https://a.example"));
    });
});
