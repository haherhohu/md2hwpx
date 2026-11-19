import * as fs from "fs";
import * as path from "path";
import * as JSZip from "jszip";
import { HwpxGenerator } from "../hwpxGenerator";

interface SampleVerificationMetrics {
    file: string;
    dummyImageTextCount: number;
    brokenImageMarkdownCount: number;
    oneByOneTableCount: number;
    calloutCenteredParas: number;
    totalPics: number;
    fixed16By9ImageCount: number;
    rawLatexLeakCount: number;
    equationCount: number;
    zeroWidthSpaceLeakCount: number;
}

const RAW_LATEX_COMMAND_REGEX =
    /\\(?:frac|dfrac|tfrac|sqrt|sum|int|prod|lim|begin|end|underbrace|overbrace|left|right|text|mathrm|mathbf|mathit|mathsf|quad|qquad|mid|hat|bar|vec|cdot|times|pm|leq|geq|neq|approx|partial|nabla|infty|alpha|beta|gamma|delta|theta|lambda|sigma|tau|omega|Delta|Sigma|Omega)\b/;

function collectMarkdownFiles(rootDir: string): string[] {
    if (!fs.existsSync(rootDir)) {
        return [];
    }
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectMarkdownFiles(fullPath));
        } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
            results.push(fullPath);
        }
    }
    return results.sort((a, b) => a.localeCompare(b));
}

function collectCenterParaPrIds(headerXml: string): Set<string> {
    const centerIds = new Set<string>();
    const paraPrRegex = /<hh:paraPr\s+id="(\d+)"[^>]*>([\s\S]*?)<\/hh:paraPr>/g;
    for (const match of headerXml.matchAll(paraPrRegex)) {
        if (/<hh:align\b[^>]*horizontal="CENTER"/.test(match[2])) {
            centerIds.add(match[1]);
        }
    }
    return centerIds;
}

function extractBalancedTables(sectionXml: string): Array<{ openTag: string; body: string }> {
    const tables: Array<{ openTag: string; body: string }> = [];
    const tagRegex = /<(\/?)hp:tbl\b([^>]*)>/g;
    const stack: Array<{ start: number; openTag: string }> = [];

    for (const match of sectionXml.matchAll(tagRegex)) {
        const isClosing = match[1] === "/";
        const matchIndex = match.index ?? 0;
        if (!isClosing) {
            stack.push({ start: matchIndex + match[0].length, openTag: match[0] });
        } else if (stack.length > 0) {
            const popped = stack.pop()!;
            tables.push({
                openTag: popped.openTag,
                body: sectionXml.slice(popped.start, matchIndex),
            });
        }
    }

    return tables;
}

function countImmediateTableParagraphsCentered(tableBody: string, centerParaPrIds: Set<string>): number {
    // Strip nested <hp:tbl>...</hp:tbl> blocks so each 1x1 table counts only its own direct paragraphs
    let stripped = "";
    let depth = 0;
    let cursor = 0;
    const nestedTblTagRegex = /<(\/?)hp:tbl\b[^>]*>/g;
    for (const match of tableBody.matchAll(nestedTblTagRegex)) {
        const idx = match.index ?? 0;
        if (depth === 0) {
            stripped += tableBody.slice(cursor, idx);
        }
        depth += match[1] === "/" ? -1 : 1;
        if (depth < 0) {
            depth = 0;
        }
        cursor = idx + match[0].length;
    }
    if (depth === 0) {
        stripped += tableBody.slice(cursor);
    }

    let centeredCount = 0;
    for (const paraMatch of stripped.matchAll(/<hp:p\b[^>]*paraPrIDRef="(\d+)"/g)) {
        if (centerParaPrIds.has(paraMatch[1])) {
            centeredCount += 1;
        }
    }
    return centeredCount;
}

function analyzeHwpxXml(relPath: string, sectionXml: string, headerXml: string): SampleVerificationMetrics {
    const centerParaPrIds = collectCenterParaPrIds(headerXml);
    const textContents = Array.from(sectionXml.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)).map((m) => m[1]);

    const dummyImageTextCount = textContents.filter((t) => t.includes("[Image]")).length;
    const bangBracketCount = textContents.filter((t) => t.includes("![")).length;
    const bangBeforeLinkCount = (
        sectionXml.match(/<hp:t(?:\s[^>]*)?>[^<]*!<\/hp:t><\/hp:run><hp:run[^>]*><hp:ctrl><hp:fieldBegin[^>]*type="HYPERLINK"/g) ??
        []
    ).length;

    const allTables = extractBalancedTables(sectionXml);
    const oneByOneTables = allTables.filter(
        (tbl) => /\browCnt="1"/.test(tbl.openTag) && /\bcolCnt="1"/.test(tbl.openTag),
    );
    let calloutCenteredParas = 0;
    for (const tbl of oneByOneTables) {
        calloutCenteredParas += countImmediateTableParagraphsCentered(tbl.body, centerParaPrIds);
    }

    const totalPics = (sectionXml.match(/<hp:pic\b/g) ?? []).length;
    const fixed16By9ImageCount = (sectionXml.match(/<hp:curSz\s+width="42520"\s+height="23918"\/>/g) ?? []).length;
    const rawLatexLeakCount = textContents.filter((t) => RAW_LATEX_COMMAND_REGEX.test(t)).length;
    const equationCount = (sectionXml.match(/<hp:equation\b/g) ?? []).length;
    const zeroWidthSpaceLeakCount = textContents.filter((t) => /[\u200B\uFEFF]/.test(t)).length;

    return {
        file: relPath,
        dummyImageTextCount,
        brokenImageMarkdownCount: bangBracketCount + bangBeforeLinkCount,
        oneByOneTableCount: oneByOneTables.length,
        calloutCenteredParas,
        totalPics,
        fixed16By9ImageCount,
        rawLatexLeakCount,
        equationCount,
        zeroWidthSpaceLeakCount,
    };
}

async function main(): Promise<void> {
    const projectRoot = path.resolve(__dirname, "../..");
    const localFixturesDir = path.join(projectRoot, "test-fixtures", "local");
    const outputRootDir = path.join(projectRoot, "test-output");
    const templatePath = path.join(projectRoot, "template.hwpx");

    const markdownFiles = collectMarkdownFiles(localFixturesDir);
    if (markdownFiles.length === 0) {
        console.log(`No local markdown fixtures found under ${localFixturesDir}. Skipping verification.`);
        return;
    }

    fs.mkdirSync(outputRootDir, { recursive: true });
    const generator = new HwpxGenerator();
    const results: SampleVerificationMetrics[] = [];

    for (const mdFilePath of markdownFiles) {
        const relPath = path.relative(localFixturesDir, mdFilePath);
        const outputPath = path.join(outputRootDir, relPath.replace(/\.md$/i, ".hwpx"));
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        const mdContent = fs.readFileSync(mdFilePath, "utf-8");
        await generator.generate(mdContent, templatePath, outputPath, path.dirname(mdFilePath));

        const zipBuffer = fs.readFileSync(outputPath);
        const zip = await JSZip.loadAsync(zipBuffer);
        const sectionXmlFile = zip.file("Contents/section0.xml");
        const headerXmlFile = zip.file("Contents/header.xml");

        if (!sectionXmlFile || !headerXmlFile) {
            throw new Error(`Missing section0.xml or header.xml in generated HWPX: ${outputPath}`);
        }

        const sectionXml = await sectionXmlFile.async("string");
        const headerXml = await headerXmlFile.async("string");
        results.push(analyzeHwpxXml(relPath, sectionXml, headerXml));
    }

    console.log("\n=== Local Sample HWPX Verification Summary ===");
    console.table(results);
}

main().catch((err) => {
    console.error("Local sample verification failed:", err);
    process.exit(1);
});
