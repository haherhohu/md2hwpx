import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as JSZip from "jszip";
import { preprocessKoreanBoundaries, stripKoreanSentinels } from "../pipeline/koreanPreprocessor";
import { lexInlineMarkdown } from "../pipeline/markdownExtensions";
import { HwpxGenerator } from "../hwpxGenerator";

suite("Korean Particle Boundary Preprocessor Suite", () => {
    test("enables marked to parse emphasis delimiters followed directly by Korean particles", () => {
        const samples = [
            "*강조*는",
            "**핵심**을",
            "**단어(ABC)**가",
            "_문장_은",
            "~~취소~~도",
            "*안**쪽**에*서",
            "한글**단어(ABC)**가",
        ];

        for (const sample of samples) {
            const prepared = preprocessKoreanBoundaries(sample);
            const tokens = lexInlineMarkdown(prepared);
            const hasEmphasisToken = tokens.some(
                (t) => t.type === "strong" || t.type === "em" || t.type === "del",
            );
            assert.ok(hasEmphasisToken, `Expected emphasis token for: ${sample} -> ${JSON.stringify(tokens)}`);
        }
    });

    test("does not alter fenced code, inline code, URLs, image paths, or math", () => {
        const md = [
            "```md",
            "**코드블록(A)**가 *그대로*남음",
            "```",
            "",
            "인라인 `**코드(A)**가` 및 [링크(A)](https://example.com/**path**가) 및 ![그림](img(1).png) 및 $x_1^2*y$ 유지",
        ].join("\n");

        const prepared = preprocessKoreanBoundaries(md);
        assert.ok(prepared.includes("**코드블록(A)**가 *그대로*남음"));
        assert.ok(prepared.includes("`**코드(A)**가`"));
        assert.ok(prepared.includes("https://example.com/**path**가"));
        assert.ok(prepared.includes("$x_1^2*y$"));
        assert.strictEqual(stripKoreanSentinels(prepared), md);
    });

    test("leaves zero sentinel characters (\\u200B or \\uFEFF) in final generated HWPX XML", async () => {
        const md = "**단어(ABC)**가 *강조*는 **핵심**을 _문장_은 ~~취소~~도 *안**쪽**에*서";
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2hwpx-ko-"));
        const outputPath = path.join(tempDir, "ko.hwpx");
        const templatePath = path.resolve(__dirname, "../../template.hwpx");

        await new HwpxGenerator().generate(md, templatePath, outputPath, tempDir);
        const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
        const sectionXml = await zip.file("Contents/section0.xml")!.async("string");

        assert.ok(!sectionXml.includes("\u200B"));
        assert.ok(!sectionXml.includes("\uFEFF"));
        assert.ok(!sectionXml.includes("**"));
        assert.ok(!sectionXml.includes("~~"));
        assert.ok(sectionXml.includes("단어(ABC)"));
        assert.ok(sectionXml.includes("강조"));
        assert.ok(sectionXml.includes("핵심"));
        assert.ok(sectionXml.includes("문장"));
        assert.ok(sectionXml.includes("취소"));
    });
});
