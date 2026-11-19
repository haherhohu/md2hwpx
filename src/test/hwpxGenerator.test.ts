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
        const pngFile = zip.file("BinData/mdimg_1.png");
        assert.ok(pngFile);
        const pngBuf = await pngFile!.async("nodebuffer");
        assert.strictEqual(pngBuf[0], 0x89);
        assert.strictEqual(pngBuf[1], 0x50);
        assert.strictEqual(pngBuf[2], 0x4e);
        assert.strictEqual(pngBuf[3], 0x47);
        assert.ok(pngBuf.length > 2000, `Expected visible placeholder PNG (> 2000 bytes), got ${pngBuf.length}`);
        const curSzMatch = sectionXml.match(/<hp:curSz width="(\d+)" height="(\d+)"\/>/);
        assert.ok(curSzMatch);
        const picW = parseInt(curSzMatch![1], 10);
        const picH = parseInt(curSzMatch![2], 10);
        assert.strictEqual(picW, 42520);
        assert.ok(Math.abs(picH / picW - 9 / 16) < 0.01, `Expected ~16:9 aspect ratio, got ${picW}x${picH}`);
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

    test("renders inline and block LaTeX equations as native <hp:equation> objects and HTML sup/sub as charPr spans", async () => {
        const latexText = String.raw`$10^{-3} \sim 10^{-5}$ and $\pm 5\%$ and $\tau_{\text{mod}}$ and $\pm 110^\circ$` + "\n\n$$\n\\frac{\\frac{a}{b}}{\\sqrt{c}}\n$$\n\nH<sub>2</sub>O and 10<sup>-3</sup>";
        const { sectionXml, headerXml } = await generateHwpxArchive(latexText);
        assert.ok(sectionXml.includes("<hp:equation "));
        assert.ok(sectionXml.includes('treatAsChar="1"'));
        assert.ok(sectionXml.includes("<hp:script>"));
        assert.ok(sectionXml.includes("10 ^{-3} sim 10 ^{-5}"));
        assert.ok(sectionXml.includes("+- 5%"));
        assert.ok(sectionXml.includes('tau _{rm "mod"}'));
        assert.ok(sectionXml.includes("+- 110 ^{deg}"));
        assert.ok(sectionXml.includes("{{{{a} over {b}}} over {sqrt {c}}}"));
        assert.ok(!/<hp:t(?:\s[^>]*)?>[^<]*\\(?:sim|circ|frac|sqrt)/.test(sectionXml));
        assert.ok(headerXml.includes("<hh:supscript>1</hh:supscript>"));
        assert.ok(headerXml.includes("<hh:subscript>1</hh:subscript>"));

        const tempSecPath = path.join(os.tmpdir(), `md2hwpx-eq-sec-${Date.now()}.xml`);
        fs.writeFileSync(tempSecPath, sectionXml);
        try {
            require("child_process").execFileSync("xmllint", ["--noout", tempSecPath], { stdio: "pipe" });
        } finally {
            if (fs.existsSync(tempSecPath)) {
                fs.unlinkSync(tempSecPath);
            }
        }
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

    test("renders markdown footnote references as superscript bookmark links and endnotes with contiguous hanging indent paraPr", async () => {
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
        assert.ok(!headerXml.includes('<hh:paraPr id="1050"'));
        assert.ok(!sectionXml.includes('paraPrIDRef="1050"'));
        assert.ok(sectionXml.includes('paraPrIDRef="29"'));
        assert.ok(headerXml.includes("<hh:supscript>1</hh:supscript>"));
        assert.ok(headerXml.includes('<hc:intent value="-2200" unit="HWPUNIT"/>'));
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

    test("prevents blockquote lazy continuation from swallowing trailing unquoted paragraphs", () => {
        const pipeline = new MarkdownPipeline();
        const tokens = pipeline.parseMarkdown(`> quoted line\nunquoted paragraph`);
        const normalized = pipeline.normalizeTokens(tokens);

        assert.strictEqual(normalized.filter((t) => t.type === "blockquote").length, 1);
        assert.strictEqual(normalized.filter((t) => t.type === "paragraph").length, 1);
    });

    test("separates pipe tables from adjacent paragraphs without blank lines and avoids fake callouts", () => {
        const pipeline = new MarkdownPipeline();
        const tokens = pipeline.parseMarkdown(`Intro paragraph\n| A | B |\n| - | - |\n| 1 | 2 |\nTrailing paragraph`);
        const normalized = pipeline.normalizeTokens(tokens);

        assert.strictEqual(normalized.filter((t) => t.type === "table").length, 1);
        assert.strictEqual(normalized.filter((t) => t.type === "blockquote").length, 0);
        assert.strictEqual(normalized.filter((t) => t.type === "paragraph").length, 2);
    });

    test("preserves inline AST tokens on ordinary body paragraphs during caption binding", () => {
        const pipeline = new MarkdownPipeline();
        const tokens = pipeline.parseMarkdown(`[표 1] 본문에서 참조하는 설명이며 뒤에 표가 없습니다.`);
        const normalized = pipeline.normalizeTokens(tokens);
        const para = normalized.find((t) => t.type === "paragraph");

        assert.ok(para, "Expected ordinary paragraph to remain a paragraph");
        assert.ok(Array.isArray(para!.tokens) && para!.tokens!.length > 0, "Paragraph tokens must not be cleared");
    });

    test("promotes standalone image with brackets in alt and parens in href into block image token", () => {
        const pipeline = new MarkdownPipeline();
        const tokens = pipeline.parseMarkdown(`![그림 [1]](assets/diagram(v2).png)`);
        const normalized = pipeline.normalizeTokens(tokens);
        const img = normalized.find((t) => t.type === "image");

        assert.ok(img, "Expected standalone image token");
        assert.strictEqual(img!.href, "assets/diagram(v2).png");
        assert.strictEqual(img!.text, "그림 [1]");
    });

    test("renders inline image with nested brackets and parens as <hp:pic> rather than broken ! link", async () => {
        const sectionXml = await generateSectionXml(`설명 중 ![alt [inner]](dir/file(1).png) 계속`);
        assert.ok(sectionXml.includes("<hp:pic"));
        assert.ok(!sectionXml.includes('type="HYPERLINK"'));
        assert.ok(!/<hp:t[^>]*>[^<]*!<\/hp:t>/.test(sectionXml));
    });

    test("renders nested emphasis (*안**쪽**에*서) without dropping styles or leaking markers", async () => {
        const { sectionXml, headerXml } = await generateHwpxArchive(`*안**쪽**에*서 계속`);
        assert.ok(!sectionXml.includes("*"));
        assert.ok(!sectionXml.includes("\u200B"));
        assert.ok(!sectionXml.includes("\uFEFF"));
        assert.ok(sectionXml.includes("<hp:t>안</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>쪽</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>에</hp:t>"));
        assert.ok(sectionXml.includes("<hp:t>서 계속</hp:t>"));
        assert.ok(headerXml.includes("<hh:bold>1</hh:bold><hh:italic>1</hh:italic>"));
    });

    test("renders inline codespan literally without triggering emphasis, math, or footnote parsing", async () => {
        const sectionXml = await generateSectionXml("코드 `*a_b* $x$ [^1]` 확인");
        assert.ok(sectionXml.includes("*a_b* $x$ [^1]"));
        assert.ok(!sectionXml.includes("미주"));
        assert.ok(!sectionXml.includes("?ref_1"));
    });

    test("renders images inside table cells as <hp:pic> without [Image] dummy text in <hp:t>", async () => {
        const sectionXml = await generateSectionXml(`| 그림 | 설명 |\n| - | - |\n| ![아이콘](icon.png) | 설명 |`);
        assert.ok(sectionXml.includes("<hp:pic"));
        assert.ok(!/<hp:t(?:\s[^>]*)?>[^<]*\[Image\]/.test(sectionXml));
    });

    test("renders blockquotes recursively (nested callouts and images) with LEFT alignment", async () => {
        const { sectionXml, headerXml } = await generateHwpxArchive(
            `> 외부 콜아웃\n>\n> ![콜아웃 그림](box.png)\n>\n> > 내부 중첩 콜아웃`,
        );
        const tblCount = (sectionXml.match(/<hp:tbl\b/g) ?? []).length;
        assert.ok(tblCount >= 2, `Expected nested callout tables (>= 2), got ${tblCount}`);
        assert.ok(sectionXml.includes("<hp:pic"));

        const leftMatch = headerXml.match(/<hh:paraPr\s+id="(\d+)"[^>]*>(?:(?!<\/hh:paraPr>)[\s\S])*?<hh:align\s+horizontal="LEFT"/g) ?? [];
        const leftIds = new Set(leftMatch.map((m) => m.match(/id="(\d+)"/)![1]));
        assert.ok(leftIds.size > 0);
        assert.ok(sectionXml.includes("외부 콜아웃"));
        assert.ok(sectionXml.includes("내부 중첩 콜아웃"));

        // Every paragraph inside callouts containing quote text must be LEFT-aligned, not CENTER
        const centerMatch = headerXml.match(/<hh:paraPr\s+id="(\d+)"[^>]*>(?:(?!<\/hh:paraPr>)[\s\S])*?<hh:align\s+horizontal="CENTER"/g) ?? [];
        const centerIds = new Set(centerMatch.map((m) => m.match(/id="(\d+)"/)![1]));
        const outerParaMatch = sectionXml.match(/<hp:p\b[^>]*paraPrIDRef="(\d+)"[^>]*>(?:(?!<hp:p\b|<\/hp:p>)[\s\S])*?외부 콜아웃/);
        assert.ok(outerParaMatch && leftIds.has(outerParaMatch[1]) && !centerIds.has(outerParaMatch[1]));
    });

    test("renders fenced code blocks literally inside left-aligned callouts without markdown parsing", async () => {
        const { sectionXml, headerXml } = await generateHwpxArchive("```text\n**not bold** ![not pic](x.png)\n```");
        assert.ok(sectionXml.includes("**not bold** ![not pic](x.png)"));
        assert.ok(!sectionXml.includes("<hp:pic"));

        const leftMatch = headerXml.match(/<hh:paraPr\s+id="(\d+)"[^>]*>(?:(?!<\/hh:paraPr>)[\s\S])*?<hh:align\s+horizontal="LEFT"/g) ?? [];
        const leftIds = new Set(leftMatch.map((m) => m.match(/id="(\d+)"/)![1]));
        const codeParaMatch = sectionXml.match(
            /<hp:p\b[^>]*paraPrIDRef="(\d+)"[^>]*>(?:(?!<hp:p\b|<\/hp:p>)[\s\S])*?\*\*not bold\*\*/,
        );
        assert.ok(codeParaMatch && leftIds.has(codeParaMatch[1]));
    });

    test("keeps small PNG images at 100% original size and preserves aspect ratio for oversized wide/portrait PNGs", async () => {
        const makePng = (w: number, h: number): Buffer => {
            const buf = Buffer.alloc(33);
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
            buf.writeUInt32BE(13, 8);
            buf.write("IHDR", 12, "ascii");
            buf.writeUInt32BE(w, 16);
            buf.writeUInt32BE(h, 20);
            buf[24] = 8;
            buf[25] = 2;
            return buf;
        };

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2hwpx-img-size-"));
        fs.writeFileSync(path.join(tempDir, "small.png"), makePng(100, 80));
        fs.writeFileSync(path.join(tempDir, "portrait.png"), makePng(1000, 2000));
        fs.writeFileSync(path.join(tempDir, "wide.png"), makePng(1600, 400));

        const md = `![small](small.png)\n\n![portrait](portrait.png)\n\n![wide](wide.png)`;
        const outputPath = path.join(tempDir, "out.hwpx");
        const templatePath = path.resolve(__dirname, "../../template.hwpx");
        await new HwpxGenerator().generate(md, templatePath, outputPath, tempDir);

        const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
        const sectionXml = await zip.file("Contents/section0.xml")!.async("string");
        const curSizes = Array.from(sectionXml.matchAll(/<hp:curSz\s+width="(\d+)"\s+height="(\d+)"\/>/g)).map((m) => ({
            width: parseInt(m[1], 10),
            height: parseInt(m[2], 10),
        }));

        assert.strictEqual(curSizes.length, 3);
        // small 100x80 -> 7500x6000 (not upscaled to 42520)
        assert.deepStrictEqual(curSizes[0], { width: 7500, height: 6000 });
        // portrait 1000x2000 -> constrained by maxH=56000 -> 28000x56000
        assert.deepStrictEqual(curSizes[1], { width: 28000, height: 56000 });
        // wide 1600x400 -> constrained by maxW=42520 -> 42520x10630
        assert.deepStrictEqual(curSizes[2], { width: 42520, height: 10630 });
    });

    test("renders endnotes with contiguous paraPr IDs, LEFT alignment, autoTabLeft tabPrIDRef, HwpUnitChar hanging indent, and <hp:tab>", async () => {
        const { sectionXml, headerXml } = await generateHwpxArchive(
            `본문 참조[^1]입니다.\n\n[^1]: 아주 긴 URL https://example.com/very/long/path/with/many/segments`,
        );

        assert.ok(sectionXml.includes('<hp:t>[1]<hp:tab width="2200" leader="0" type="0"/></hp:t>'));

        const paraPropsMatch = headerXml.match(/<hh:paraProperties\b[^>]*itemCnt="(\d+)"[^>]*>/);
        assert.ok(paraPropsMatch);
        const itemCnt = parseInt(paraPropsMatch![1], 10);
        const paraIds = Array.from(headerXml.matchAll(/<hh:paraPr\s+id="(\d+)"/g)).map((m) => parseInt(m[1], 10));
        assert.strictEqual(paraIds.length, itemCnt);
        paraIds.forEach((id, idx) => assert.strictEqual(id, idx, `Expected contiguous paraPr id ${idx}, got ${id}`));

        const refParaPrId = itemCnt - 1;
        assert.ok(sectionXml.includes(`paraPrIDRef="${refParaPrId}"`));
        const refParaPr = headerXml.match(new RegExp(`<hh:paraPr\\s+id="${refParaPrId}"([^>]*)>([\\s\\S]*?)<\\/hh:paraPr>`));
        assert.ok(refParaPr, `paraPr ${refParaPrId} should exist`);
        assert.ok(/\btabPrIDRef="1"/.test(refParaPr![1]), "reference paraPr should reference autoTabLeft tabPrIDRef");
        assert.ok(/<hh:align\b[^>]*horizontal="LEFT"/.test(refParaPr![2]));
        assert.ok(refParaPr![2].includes('breakLatinWord="BREAK_WORD"'));
        assert.ok(refParaPr![2].includes('breakNonLatinWord="BREAK_WORD"'));

        const hwpUnitCharCase = refParaPr![2].match(/<hp:case\b[^>]*HwpUnitChar[^>]*>([\s\S]*?)<\/hp:case>/);
        const defaultCase = refParaPr![2].match(/<hp:default>([\s\S]*?)<\/hp:default>/);
        assert.ok(hwpUnitCharCase && hwpUnitCharCase[1].includes('<hc:left value="0" unit="HWPUNIT"/>'));
        assert.ok(hwpUnitCharCase && hwpUnitCharCase[1].includes('<hc:intent value="-2200" unit="HWPUNIT"/>'));
        assert.ok(defaultCase && defaultCase[1].includes('<hc:left value="0" unit="HWPUNIT"/>'));
        assert.ok(defaultCase && defaultCase[1].includes('<hc:intent value="-4400" unit="HWPUNIT"/>'));

        const tempSecPath = path.join(os.tmpdir(), `md2hwpx-fn-sec-${Date.now()}.xml`);
        const tempHdrPath = path.join(os.tmpdir(), `md2hwpx-fn-hdr-${Date.now()}.xml`);
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

    test("applies markdown table alignments (header center default, body left default) and splits <br/> into separate <hp:p>", async () => {
        const { sectionXml, headerXml } = await generateHwpxArchive(
            `| L | C | R | D |\n| :--- | :---: | ---: | --- |\n| a<br/>b | c | d | e |`,
        );

        const findIdByAlign = (align: string): Set<string> => {
            const matches =
                headerXml.match(new RegExp(`<hh:paraPr\\s+id="(\\d+)"[^>]*>(?:(?!<\\/hh:paraPr>)[\\s\\S])*?<hh:align\\s+horizontal="${align}"`, "g")) ??
                [];
            return new Set(matches.map((m) => m.match(/id="(\d+)"/)![1]));
        };

        const leftIds = findIdByAlign("LEFT");
        const centerIds = findIdByAlign("CENTER");
        const rightIds = findIdByAlign("RIGHT");

        const cells = sectionXml.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) ?? [];
        assert.strictEqual(cells.length, 8);

        // Header row: L (left), C (center), R (right), D (default center)
        assert.ok(leftIds.has(cells[0].match(/paraPrIDRef="(\d+)"/)![1]));
        assert.ok(centerIds.has(cells[1].match(/paraPrIDRef="(\d+)"/)![1]));
        assert.ok(rightIds.has(cells[2].match(/paraPrIDRef="(\d+)"/)![1]));
        assert.ok(centerIds.has(cells[3].match(/paraPrIDRef="(\d+)"/)![1]));

        // Body row: cell 4 has a<br/>b -> 2 separate <hp:p> paragraphs, LEFT aligned
        const body0Paras = cells[4].match(/<hp:p\b[^>]*paraPrIDRef="(\d+)"/g) ?? [];
        assert.strictEqual(body0Paras.length, 2);
        assert.ok(leftIds.has(body0Paras[0].match(/paraPrIDRef="(\d+)"/)![1]));
        assert.ok(centerIds.has(cells[5].match(/paraPrIDRef="(\d+)"/)![1]));
        assert.ok(rightIds.has(cells[6].match(/paraPrIDRef="(\d+)"/)![1]));
        assert.ok(leftIds.has(cells[7].match(/paraPrIDRef="(\d+)"/)![1]));

        // Validate XML structure with xmllint
        const tempSecPath = path.join(os.tmpdir(), `md2hwpx-step5-sec-${Date.now()}.xml`);
        const tempHdrPath = path.join(os.tmpdir(), `md2hwpx-step5-hdr-${Date.now()}.xml`);
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
});
