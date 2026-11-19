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

    test("restricts strikethrough to ~~...~~ and preserves single ~ range markers", () => {
        const rangeSample = "3단계(Phase 1~3) 검증 매트릭스를 수립하였다. 약 5,000만~1.8억 원";
        const rangeTokens = lexInlineMarkdown(preprocessKoreanBoundaries(rangeSample));
        assert.ok(!rangeTokens.some((t) => t.type === "del"));
        assert.strictEqual(rangeTokens.map((t) => t.raw ?? "").join(""), rangeSample);

        const saemangeumLine =
            "Layer 1~2)의 정적·실내 검증을 담당한다면, **새만금 실증단지는 '차세대 비가시권(Layer 3~4)'을 전담**하여 완성한다.";
        const saemangeumTokens = lexInlineMarkdown(preprocessKoreanBoundaries(saemangeumLine));
        assert.ok(!saemangeumTokens.some((t) => t.type === "del"));
        const boldToken = saemangeumTokens.find((t) => t.type === "strong");
        assert.ok(boldToken, "Expected bold token not broken by single tilde");
        assert.ok((boldToken?.text ?? "").includes("Layer 3~4"));

        const validStrike = lexInlineMarkdown(preprocessKoreanBoundaries("실제 ~~취소선~~ 테스트"));
        assert.ok(validStrike.some((t) => t.type === "del" && t.text === "취소선"));

        const tripleTilde = lexInlineMarkdown(preprocessKoreanBoundaries("물결 세개 ~~~코드~~~ 아님"));
        assert.ok(!tripleTilde.some((t) => t.type === "del"));
    });

    test("handles Unicode punctuation after closing delimiters and opening delimiters next to non-ASCII text", () => {
        const cases = [
            "• **한국건설생활환경시험연구원(KCL)**·TP 등 공인 시험기관 성적서 발행",
            "「**한국(KCL)**」",
            "「**(KCL)한국**」",
            "한글**(KCL)**가",
            "**A(1)**·**B(2)**·**C(3)**",
            "~~텍스트 **한국(KCL)**·기타~~",
        ];

        const collectText = (toks: ReturnType<typeof lexInlineMarkdown>): string =>
            toks
                .map((t) => (Array.isArray(t.tokens) && t.tokens.length > 0 ? collectText(t.tokens) : t.type === "text" ? (t.text ?? "") : ""))
                .join("");

        for (const c of cases) {
            const tokens = lexInlineMarkdown(preprocessKoreanBoundaries(c));
            const plainTexts = collectText(tokens);
            assert.ok(!plainTexts.includes("**"), `Unexpected leaked ** in ${c}: ${plainTexts}`);
            assert.ok(
                tokens.some((t) => t.type === "strong" || (Array.isArray(t.tokens) && t.tokens.some((cTok) => cTok.type === "strong"))),
                `Expected strong token in ${c}: ${JSON.stringify(tokens)}`,
            );
        }

        const nestedTokens = lexInlineMarkdown(preprocessKoreanBoundaries("*안**쪽**에*서"));
        assert.strictEqual(nestedTokens[0]?.type, "em");
        assert.ok(
            Array.isArray(nestedTokens[0]?.tokens) && nestedTokens[0]!.tokens!.some((t) => t.type === "strong" && t.text === "쪽"),
        );
    });

    test("splits crossed overlapping emphasis cleanly in AST and renders styled HWPX runs without leaked markers", async () => {
        const crossed1 = lexInlineMarkdown(preprocessKoreanBoundaries("~~취소 **중첩~~ 볼드**"));
        const delTok = crossed1.find((t) => t.type === "del");
        assert.ok(delTok);
        assert.ok(delTok?.tokens?.some((t) => t.type === "strong" && stripKoreanSentinels(t.text ?? "") === "중첩"));
        assert.ok(crossed1.some((t) => t.type === "strong" && stripKoreanSentinels(t.text ?? "") === "볼드"));

        const crossed2 = lexInlineMarkdown(preprocessKoreanBoundaries("~~가**나~~다**"));
        assert.ok(crossed2.some((t) => t.type === "del"));
        assert.ok(crossed2.some((t) => t.type === "strong" && stripKoreanSentinels(t.text ?? "") === "다"));

        const crossed3 = lexInlineMarkdown(preprocessKoreanBoundaries("**볼드 ~~중첩** 취소~~"));
        const strongTok = crossed3.find((t) => t.type === "strong");
        assert.ok(strongTok?.tokens?.some((t) => t.type === "del" && stripKoreanSentinels(t.text ?? "") === "중첩"));
        assert.ok(crossed3.some((t) => t.type === "del" && stripKoreanSentinels(t.text ?? "") === "취소"));

        const unclosedStray = lexInlineMarkdown(preprocessKoreanBoundaries("~~열고 **안닫힘~~ 끝"));
        const strayDel = unclosedStray.find((t) => t.type === "del");
        assert.ok(strayDel);
        assert.ok(!strayDel?.tokens?.some((t) => t.type === "strong"));

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2hwpx-cross-"));
        const outputPath = path.join(tempDir, "cross.hwpx");
        const templatePath = path.resolve(__dirname, "../../template.hwpx");
        await new HwpxGenerator().generate("~~취소 **중첩~~ 볼드**", templatePath, outputPath, tempDir);
        const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
        const sectionXml = await zip.file("Contents/section0.xml")!.async("string");
        const headerXml = await zip.file("Contents/header.xml")!.async("string");

        assert.ok(!sectionXml.includes("**"));
        assert.ok(!sectionXml.includes("~~"));
        assert.ok(!sectionXml.includes("\uFEFF"));
        assert.ok(sectionXml.includes("취소 "));
        assert.ok(sectionXml.includes("중첩"));
        assert.ok(sectionXml.includes("볼드"));
        assert.ok(headerXml.includes("<hh:strikeout"));
        assert.ok(headerXml.includes("<hh:bold>1</hh:bold>"));
    });
});
