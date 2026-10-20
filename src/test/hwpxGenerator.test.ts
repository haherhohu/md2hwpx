import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as JSZip from "jszip";
import { HwpxGenerator } from "../hwpxGenerator";
import { MarkdownPipeline } from "../markdownPipeline";

async function generateHwpxArchive(markdown: string, customTemplatePath?: string) {
    const generator = new HwpxGenerator();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2hwpx-test-"));
    const outputPath = path.join(tempDir, "output.hwpx");
    const templatePath = customTemplatePath ?? path.resolve(__dirname, "../../template.hwpx");

    await generator.generate(markdown, templatePath, outputPath, tempDir);

    const fileBuffer = fs.readFileSync(outputPath);
    const zip = await JSZip.loadAsync(fileBuffer);
    const sectionXmlFile = zip.file("Contents/section0.xml");
    const headerXmlFile = zip.file("Contents/header.xml");
    const contentHpfFile = zip.file("Contents/content.hpf");
    assert.ok(sectionXmlFile, "section0.xml should exist in generated output");
    assert.ok(headerXmlFile, "header.xml should exist in generated output");
    assert.ok(contentHpfFile, "content.hpf should exist in generated output");

    return {
        sectionXml: await sectionXmlFile!.async("string"),
        headerXml: await headerXmlFile!.async("string"),
        contentHpf: await contentHpfFile!.async("string"),
        zip,
    };
}

async function generateSectionXml(markdown: string): Promise<string> {
    const { sectionXml } = await generateHwpxArchive(markdown);
    return sectionXml;
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

    test("renders table with template printable width (42520), pageBreak CELL, zero left/right outMargin, and non treat-as-character placement", async () => {
        const sectionXml = await generateSectionXml(`| A | B |\n| - | - |\n| 1 | 2 |`);
        assert.ok(sectionXml.includes('treatAsChar="0"'));
        assert.ok(sectionXml.includes('pageBreak="CELL"'));
        assert.ok(sectionXml.includes('width="42520"'));
        assert.ok(sectionXml.includes('<hp:outMargin left="0" right="0" top="141" bottom="141"/>'));
    });

    test("renders plain blockquote as 1x1 callout table", async () => {
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

    test("renders six-level nested list content with valid hanging indent paraPr", async () => {
        const { sectionXml, headerXml } = await generateHwpxArchive(
            `- l1\n  - l2\n    - l3\n      - l4\n        - l5\n          - l6`,
        );

        assert.ok(sectionXml.includes("l1"));
        assert.ok(sectionXml.includes("l6"));
        assert.ok(sectionXml.includes("□") || sectionXml.includes("‣"));
        assert.ok(sectionXml.includes('paraPrIDRef="20"') || sectionXml.includes('paraPrIDRef="21"'));
        assert.ok(headerXml.includes('<hc:intent value="-1200" unit="HWPUNIT"/>'));
    });

    test("renders markdown image token as HWPX <hp:pic> image node and embeds BinData once per duplicate image", async () => {
        const { sectionXml, contentHpf, zip } = await generateHwpxArchive(
            `![alt text](./assets/sample.png)\n\n![alt text 2](./assets/sample.png)`,
        );
        assert.ok(sectionXml.includes("<hp:pic"));
        assert.ok(sectionXml.includes("[Image] alt text (./assets/sample.png)"));
        const manifestMatches = contentHpf.match(/id="mdimg_1"/g) || [];
        assert.strictEqual(manifestMatches.length, 1);
        assert.ok(zip.file("BinData/mdimg_1.png"));
    });

    test("converts inline SVG HTML blocks to HWPX <hp:pic> nodes with 300 DPI .png BinData embedding and oriented markers", async () => {
        const { sectionXml, contentHpf, zip } = await generateHwpxArchive(
            `<svg viewBox="0 0 400 200"><defs><linearGradient id="g"><stop offset="0%" stop-color="#f8fafc"/></linearGradient><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb"/></marker></defs><rect width="400" height="200" fill="url(#g)"/><line x1="200" y1="30" x2="200" y2="170" stroke="#2563eb" stroke-width="2.5" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="200" y="100" text-anchor="middle" font-size="24" fill="#1e293b">한글 다이어그램 R&R / MITRE ATT&CK®</text></svg>`,
        );
        assert.ok(sectionXml.includes("<hp:pic"));
        assert.ok(sectionXml.includes("[Image] SVG diagram (inline.svg)"));
        assert.ok(!sectionXml.includes("<svg"));
        assert.ok(contentHpf.includes('id="mdimg_1"'));
        assert.ok(contentHpf.includes('media-type="image/png"'));
        const pngFile = zip.file("BinData/mdimg_1.png");
        assert.ok(pngFile, "BinData/mdimg_1.png should exist");
        const pngBuf = await pngFile!.async("nodebuffer");
        assert.strictEqual(pngBuf[0], 0x89);
        assert.strictEqual(pngBuf[1], 0x50); // 'P'
        assert.strictEqual(pngBuf[2], 0x4e); // 'N'
        assert.strictEqual(pngBuf[3], 0x47); // 'G'
        assert.ok(pngBuf.length > 5000, `Expected full 300 DPI PNG (> 5000 bytes), got ${pngBuf.length} bytes`);
    });

    test("normalizes common LaTeX symbols and renders superscript/subscript spans", async () => {
        const latexText = String.raw`$10^{-3} \sim 10^{-5}$ and $\pm 5\%$ and $\tau_{\text{mod}}$ and $\pm 110^\circ$`;
        const { sectionXml, headerXml } = await generateHwpxArchive(latexText);
        assert.ok(sectionXml.includes("<hp:t>10</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>-3</hp:t>"));
        assert.ok(sectionXml.includes("~"));
        assert.ok(sectionXml.includes("±"));
        assert.ok(sectionXml.includes("%"));
        assert.ok(sectionXml.includes("°"));
        assert.ok(sectionXml.includes("<hp:t>τ</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>mod</hp:t>"));
        assert.ok(headerXml.includes("<hh:supscript>1</hh:supscript>"));
        assert.ok(headerXml.includes("<hh:subscript>1</hh:subscript>"));
        assert.ok(!sectionXml.includes("\\sim"));
        assert.ok(!sectionXml.includes("\\circ"));
    });

    test("renders single horizontal rule as a selectable 0.5mm <hp:line> object with linesegarray, and consecutive separators as page breaks", async () => {
        const { sectionXml: singleRuleXml } = await generateHwpxArchive(`before\n\n---\n\nafter`);
        assert.ok(singleRuleXml.includes("before"));
        assert.ok(singleRuleXml.includes("after"));
        assert.ok(singleRuleXml.includes("<hp:line "));
        assert.ok(singleRuleXml.includes('width="141"'));
        assert.ok(singleRuleXml.includes('treatAsChar="1"'));
        assert.ok(singleRuleXml.includes("<hp:linesegarray><hp:lineseg "));
        assert.ok(!singleRuleXml.includes('pageBreak="1"'));

        const pageBreakXml = await generateSectionXml(`before\n\n---\n\n---\n\nafter`);
        assert.ok(pageBreakXml.includes('pageBreak="1"'));
    });

    test("renders markdown links as underlined HYPERLINK field controls without converting them into endnotes", async () => {
        const sectionXml = await generateSectionXml(`문장 [A](https://a.example) 과 [B](https://b.example)`);
        assert.ok(sectionXml.includes("<hp:t>A</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>B</hp:t>"));
        assert.ok(sectionXml.includes('charPrIDRef="8"'));
        assert.ok(sectionXml.includes('<hp:fieldBegin'));
        assert.ok(sectionXml.includes('type="HYPERLINK"'));
        assert.ok(sectionXml.includes('<hp:stringParam name="Path">https://a.example</hp:stringParam>'));
        assert.ok(sectionXml.includes('<hp:stringParam name="Category">HWPHYPERLINK_TYPE_URL</hp:stringParam>'));
        assert.ok(!sectionXml.includes("[1] https://a.example"));
        assert.ok(!sectionXml.includes("미주"));
    });

    test("renders raw URLs as underlined clickable HYPERLINK field controls", async () => {
        const sectionXml = await generateSectionXml(`문장 https://a.example 과 https://b.example`);
        assert.ok(sectionXml.includes("<hp:t>https://a.example</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>https://b.example</hp:t>"));
        assert.ok(sectionXml.includes('charPrIDRef="8"'));
        assert.ok(sectionXml.includes('<hp:stringParam name="Path">https://a.example</hp:stringParam>'));
        assert.ok(sectionXml.includes('<hp:stringParam name="Category">HWPHYPERLINK_TYPE_URL</hp:stringParam>'));
    });

    test("renders markdown footnote references as superscript bookmark links and endnotes with hanging indent paraPr 1050", async () => {
        const { sectionXml, headerXml } = await generateHwpxArchive(
            `참고[^REF-01]입니다.\n\n[^REF-01]: **FAA 보고서** https://a.example`,
        );
        assert.ok(sectionXml.includes("참고"));
        assert.ok(sectionXml.includes("<hp:t>[1]</hp:t>"));
        assert.ok(sectionXml.includes('<hp:stringParam name="Path">?ref_1</hp:stringParam>'));
        assert.ok(sectionXml.includes('<hp:stringParam name="Category">HWPHYPERLINK_TYPE_BOOKMARK</hp:stringParam>'));
        assert.ok(sectionXml.includes('<hp:bookmark name="ref_1"/>'));
        assert.ok(sectionXml.includes("FAA 보고서"));
        assert.ok(sectionXml.includes("https://a.example"));
        assert.ok(sectionXml.includes("미주"));
        assert.ok(sectionXml.includes('paraPrIDRef="1050"'));
        assert.ok(headerXml.includes('<hh:supscript>1</hh:supscript>'));
        assert.ok(headerXml.includes('<hc:intent value="-1800" unit="HWPUNIT"/>'));
        assert.ok(!sectionXml.includes("[^REF-01]"));
    });

    test("does not leave an initial empty template paragraph before the first generated heading/paragraph", async () => {
        const sectionXml = await generateSectionXml(`# 첫 제목\n\n첫 문단`);
        const paragraphs = sectionXml.match(/<hp:p\b[\s\S]*?<\/hp:p>/g) || [];
        assert.ok(paragraphs.length >= 2);
        const firstPara = paragraphs[0] ?? "";
        assert.ok(firstPara.includes("<hp:secPr"), "First paragraph should contain secPr");
        assert.ok(firstPara.includes("첫 제목"), "First paragraph should directly contain the first heading without a blank line before it");
    });

    test("attaches [표 1-1], [표 1], and image alt text as native <hp:caption> with bracket-to-period formatting", async () => {
        const sectionXml = await generateSectionXml(
            `**[표 1-1] 시스템 제원 비교**\n\n| 항목 | 값 |\n| - | - |\n| 무게 | 25kg |\n\n[표 1] 단일 번호 표 캡션\n\n| 구분 | 설명 |\n| - | - |\n| A | B |\n\n![그림 1-1](diagram.svg)`,
        );
        assert.ok(sectionXml.includes('<hp:caption side="TOP"'));
        assert.ok(sectionXml.includes("<hp:t>표 1-1. 시스템 제원 비교</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>표 1. 단일 번호 표 캡션</hp:t>"));
        assert.ok(!sectionXml.includes("[표 1-1]"));
        assert.ok(!sectionXml.includes("[표 1]"));
        assert.ok(sectionXml.includes('<hp:caption side="BOTTOM"'));
        assert.ok(sectionXml.includes("<hp:t>그림 1-1</hp:t>"));
        assert.ok(sectionXml.includes('styleIDRef="21"'));
    });

    test("handles bold, italic, and strikethrough followed immediately by Korean particles without exposing markers", async () => {
        const { sectionXml, headerXml } = await generateHwpxArchive(
            `**단어(ABC)**가 *강조*를 _문장_은 ~~취소~~도 자연스럽게 연결됩니다.`,
        );
        assert.ok(!sectionXml.includes("**"));
        assert.ok(!sectionXml.includes("~~"));
        assert.ok(sectionXml.includes("<hp:t>단어(ABC)</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>가 </hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>강조</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>문장</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>취소</hp:t>"));
        assert.ok(headerXml.includes("<hh:italic>1</hh:italic>"));
        assert.ok(headerXml.includes('<hh:strikeout shape="SOLID" color="#000000"/>'));
    });

    test("protects underscores inside inline code and URLs from italic conversion", async () => {
        const sectionXml = await generateSectionXml(
            `파일명 \`fig_3_2_vantis_to_kvantis.svg\` 및 [문서](https://example.com/a_b_c.pdf) 확인`,
        );
        assert.ok(sectionXml.includes("fig_3_2_vantis_to_kvantis.svg"));
        assert.ok(!sectionXml.includes("`"));
    });

    test("distributes bold emphasis across <br/> and </br> in table cells into multiple <hp:p> paragraphs", async () => {
        const sectionXml = await generateSectionXml(`| 구분 |\n| - |\n| **Layer 1.</br>부품 계층** |`);
        assert.ok(!sectionXml.includes("**"));
        assert.ok(!sectionXml.includes("</br>"));
        assert.ok(sectionXml.includes("<hp:t>Layer 1.</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>부품 계층</hp:t>"));
    });

    test("adds a leading blank space to ordinary paragraphs", async () => {
        const sectionXml = await generateSectionXml(`첫 문단입니다.`);
        assert.ok(sectionXml.includes("<hp:t> </hp:t>"));
        assert.ok(sectionXml.includes("첫 문단입니다."));
    });

    test("renders valid XML for both section0.xml and header.xml", async () => {
        const { sectionXml, headerXml } = await generateHwpxArchive(
            `# 제목 *이탤릭*\n\nA **bold** and _italic_ and ~~strike~~ text[^1]\n\n[^1]: 참고 https://a.example`,
        );
        const tempSecPath = path.join(os.tmpdir(), `md2hwpx-sec-check-${Date.now()}.xml`);
        const tempHdrPath = path.join(os.tmpdir(), `md2hwpx-hdr-check-${Date.now()}.xml`);
        fs.writeFileSync(tempSecPath, sectionXml);
        fs.writeFileSync(tempHdrPath, headerXml);

        try {
            require("child_process").execFileSync("xmllint", ["--noout", tempSecPath], { stdio: "pipe" });
            require("child_process").execFileSync("xmllint", ["--noout", tempHdrPath], { stdio: "pipe" });
        } finally {
            if (fs.existsSync(tempSecPath)) {
                fs.unlinkSync(tempSecPath);
            }
            if (fs.existsSync(tempHdrPath)) {
                fs.unlinkSync(tempHdrPath);
            }
        }
    });

    test("decodes escaped entities in normal and bold text", async () => {
        const sectionXml = await generateSectionXml(`plain: &apos; &quot; &lt; &gt;\n\n**bold: &apos; &quot; &lt; &gt;**`);
        assert.ok(sectionXml.includes("plain: ' \" &lt; &gt;"));
        assert.ok(sectionXml.includes("bold: ' \" &lt; &gt;"));
        assert.ok(!sectionXml.includes("&amp;lt;"));
        assert.ok(!sectionXml.includes("&amp;gt;"));
    });

    test("strips stray HTML closing tags from rendered text", async () => {
        const sectionXml = await generateSectionXml(`강조된 내용</span> 이어지는 문장`);
        assert.ok(sectionXml.includes("강조된 내용"));
        assert.ok(sectionXml.includes("이어지는 문장"));
        assert.ok(!sectionXml.includes("&lt;/span&gt;"));
    });

    test("converts table cell br, <br/>, and </br> tags to multiple <hp:p> paragraphs", async () => {
        const sectionXml = await generateSectionXml(`| A |\n| - |\n| line1<br>line2</br>line3<br/>line4 |`);
        assert.ok(sectionXml.includes("<hp:t>line1</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>line2</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>line3</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>line4</hp:t>"));
        assert.ok(!sectionXml.includes("&lt;br"));
        assert.ok(!sectionXml.includes("&lt;/br"));
    });

    test("converts escaped star into ※", async () => {
        const sectionXml = await generateSectionXml(String.raw`text \* mark`);
        assert.ok(sectionXml.includes("※"));
        assert.ok(!sectionXml.includes("\\*"));
    });
});
