import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as JSZip from "jszip";
import { applyColumnWidthsToGrid, buildMergedTableGrid } from "../renderers/tableGridEngine";
import { HwpxGenerator } from "../hwpxGenerator";
import { TableCellToken } from "../types";

function cell(text: string): TableCellToken {
    return { text };
}

suite("Table Grid Merge Engine Suite", () => {
    test("merges horizontal `<` cells into left anchor and sums column widths", () => {
        const rows: TableCellToken[][] = [
            [cell("Group"), cell("<"), cell("Single")],
            [cell("A"), cell("B"), cell("C")],
        ];
        const grid = buildMergedTableGrid(rows, [10000, 12000, 20520]);

        assert.strictEqual(grid[0][0].colSpan, 2);
        assert.strictEqual(grid[0][0].width, 22000);
        assert.strictEqual(grid[0][1].absorbed, true);
        assert.strictEqual(grid[0][2].colSpan, 1);
        assert.strictEqual(grid[0][2].width, 20520);
    });

    test("merges vertical `^` cells into upper anchor across multiple rows", () => {
        const rows: TableCellToken[][] = [
            [cell("H1"), cell("H2")],
            [cell("Cat"), cell("V1")],
            [cell("^"), cell("V2")],
            [cell("^"), cell("V3")],
        ];
        const grid = buildMergedTableGrid(rows, [15000, 27520]);

        assert.strictEqual(grid[1][0].rowSpan, 3);
        assert.strictEqual(grid[1][0].absorbed, false);
        assert.strictEqual(grid[2][0].absorbed, true);
        assert.strictEqual(grid[3][0].absorbed, true);
        assert.strictEqual(grid[2][1].absorbed, false);
    });

    test("supports 2D rectangular merge (`^` + `<`) and prevents invalid L-shaped spans", () => {
        const rows: TableCellToken[][] = [
            [cell("Merged 2x2"), cell("<"), cell("Col3")],
            [cell("^"), cell("<"), cell("Row1")],
            [cell("Mismatch"), cell("<"), cell("Row2")],
            [cell("^"), cell("Normal"), cell("Row3")],
        ];
        const grid = buildMergedTableGrid(rows, [10000, 10000, 22520]);

        // Top-left 2x2 block merged cleanly
        assert.strictEqual(grid[0][0].colSpan, 2);
        assert.strictEqual(grid[0][0].rowSpan, 2);
        assert.strictEqual(grid[0][0].width, 20000);
        assert.strictEqual(grid[0][1].absorbed, true);
        assert.strictEqual(grid[1][0].absorbed, true);
        assert.strictEqual(grid[1][1].absorbed, true);

        // Row 2..3 column 0..1 has mismatch ("Normal" instead of "^"), so no invalid L-shape merge
        assert.strictEqual(grid[2][0].colSpan, 2);
        assert.strictEqual(grid[2][0].rowSpan, 1);
        assert.strictEqual(grid[3][0].absorbed, false);
        assert.strictEqual(grid[3][1].absorbed, false);
    });

    test("renders merged HWPX table XML with accurate cellAddr, cellSpan, summed cellSz, \\\\ paragraph splits, and xmllint validity", async () => {
        const md = [
            "| 구분 | < | 설명 |",
            "| - | - | - |",
            "| 항목 A | 세부 1 | **첫 줄 \\\\ 둘째 줄** |",
            "| ^ | 세부 2 | 단일 줄 |",
        ].join("\n");

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2hwpx-merge-"));
        const outputPath = path.join(tempDir, "merged.hwpx");
        const templatePath = path.resolve(__dirname, "../../template.hwpx");
        await new HwpxGenerator().generate(md, templatePath, outputPath, tempDir);

        const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
        const sectionXml = await zip.file("Contents/section0.xml")!.async("string");
        const headerXml = await zip.file("Contents/header.xml")!.async("string");

        // Header row: col 0 spans 2, col 1 is absorbed -> total 2 <hp:tc> in row 0
        // Row 1: 3 <hp:tc>, Row 2: col 0 absorbed -> 2 <hp:tc>. Total 7 <hp:tc> (not 9).
        const cells = sectionXml.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) ?? [];
        assert.strictEqual(cells.length, 7);

        // Header cell 0 has colSpan="2"
        assert.ok(cells[0].includes('<hp:cellAddr colAddr="0" rowAddr="0"/>'));
        assert.ok(cells[0].includes('<hp:cellSpan colSpan="2" rowSpan="1"/>'));
        assert.ok(cells[1].includes('<hp:cellAddr colAddr="2" rowAddr="0"/>'));

        // Summed width of header cell 0 + cell 1 equals total table width (42520)
        const w0 = parseInt(cells[0].match(/<hp:cellSz\s+width="(\d+)"/)![1], 10);
        const w1 = parseInt(cells[1].match(/<hp:cellSz\s+width="(\d+)"/)![1], 10);
        assert.strictEqual(w0 + w1, 42520);

        // Row 1 col 0 has rowSpan="2"
        assert.ok(cells[2].includes('<hp:cellAddr colAddr="0" rowAddr="1"/>'));
        assert.ok(cells[2].includes('<hp:cellSpan colSpan="1" rowSpan="2"/>'));

        // Row 1 col 2 (`**첫 줄 \\ 둘째 줄**`) splits into 2 independent <hp:p> paragraphs without raw `\\`
        const splitCellParas = cells[4].match(/<hp:p\b[\s\S]*?<\/hp:p>/g) ?? [];
        assert.strictEqual(splitCellParas.length, 2);
        assert.ok(splitCellParas[0].includes("첫 줄"));
        assert.ok(splitCellParas[1].includes("둘째 줄"));
        assert.ok(!cells[4].includes("\\\\"));

        // Preserves treatAsChar="0" and pageBreak="TABLE"
        assert.ok(sectionXml.includes('treatAsChar="0"'));
        assert.ok(sectionXml.includes('pageBreak="TABLE"'));

        const tempSecPath = path.join(tempDir, "sec.xml");
        const tempHdrPath = path.join(tempDir, "hdr.xml");
        fs.writeFileSync(tempSecPath, sectionXml);
        fs.writeFileSync(tempHdrPath, headerXml);
        require("child_process").execFileSync("xmllint", ["--noout", tempSecPath], { stdio: "pipe" });
        require("child_process").execFileSync("xmllint", ["--noout", tempHdrPath], { stdio: "pipe" });
    });

    test("applyColumnWidthsToGrid updates merged and single-column cell widths without changing topology", () => {
        const rows: TableCellToken[][] = [
            [cell("Banner"), cell("<"), cell("Single")],
            [cell("A"), cell("B"), cell("C")],
        ];
        const grid = buildMergedTableGrid(rows, [1, 1, 1]);
        applyColumnWidthsToGrid(grid, [8000, 12000, 22520]);

        assert.strictEqual(grid[0][0].colSpan, 2);
        assert.strictEqual(grid[0][0].width, 20000);
        assert.strictEqual(grid[0][1].absorbed, true);
        assert.strictEqual(grid[0][1].width, 0);
        assert.strictEqual(grid[0][2].width, 22520);
        assert.strictEqual(grid[1][1].width, 12000);
    });

    test("prevents 7-column merged banner from inflating col 0 and enforces >= 3000 min column width", async () => {
        const md = [
            "| 아주 긴 7열 병합 배너 제목으로 이전 구현에서는 0번 열만 비정상적으로 넓어지고 나머지 열이 뭉개지던 문제를 재현하는 테스트 문구입니다 | < | < | < | < | < | < |",
            "| - | - | - | - | - | - | - |",
            "| 짧음 | 훨씬 긴 두 번째 데이터 열 본문 내용으로 1번 열이 0번 열보다 넓어야 합니다 | a | b | c | d | e |",
        ].join("\n");

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2hwpx-width-7col-"));
        const outputPath = path.join(tempDir, "merged7.hwpx");
        const templatePath = path.resolve(__dirname, "../../template.hwpx");
        await new HwpxGenerator().generate(md, templatePath, outputPath, tempDir);

        const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
        const sectionXml = await zip.file("Contents/section0.xml")!.async("string");
        const rows = sectionXml.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) ?? [];
        assert.strictEqual(rows.length, 2);

        const row0Widths = [...rows[0].matchAll(/<hp:cellSz\s+width="(\d+)"/g)].map((m) => parseInt(m[1], 10));
        assert.deepStrictEqual(row0Widths, [42520]);

        const row1Widths = [...rows[1].matchAll(/<hp:cellSz\s+width="(\d+)"/g)].map((m) => parseInt(m[1], 10));
        assert.strictEqual(row1Widths.length, 7);
        assert.strictEqual(
            row1Widths.reduce((sum, w) => sum + w, 0),
            42520,
        );
        assert.ok(row1Widths[1] > row1Widths[0], `Expected col 1 (${row1Widths[1]}) > col 0 (${row1Widths[0]})`);
        for (const w of row1Widths) {
            assert.ok(w >= 3000, `Expected every column >= 3000 hwpunit, got ${w}`);
        }
    });

    test("enforces 3000 hwpunit minimum width floor on 2-column extreme length asymmetry", async () => {
        const longDesc = "매우 긴 설명 문자열입니다. ".repeat(30);
        const md = `| ID | 설명 |\n| - | - |\n| 1 | ${longDesc} |`;

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2hwpx-width-2col-"));
        const outputPath = path.join(tempDir, "asym2.hwpx");
        const templatePath = path.resolve(__dirname, "../../template.hwpx");
        await new HwpxGenerator().generate(md, templatePath, outputPath, tempDir);

        const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
        const sectionXml = await zip.file("Contents/section0.xml")!.async("string");
        const rows = sectionXml.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) ?? [];
        assert.ok(rows.length >= 1);
        const headerRow = rows[0] ?? "";
        const headerWidths = [...headerRow.matchAll(/<hp:cellSz\s+width="(\d+)"/g)].map((m) => parseInt(m[1], 10));

        assert.strictEqual(headerWidths.length, 2);
        assert.strictEqual(headerWidths[0] + headerWidths[1], 42520);
        assert.ok(headerWidths[0] >= 3000, `Expected narrow col >= 3000, got ${headerWidths[0]}`);
    });

    test("gracefully scales minimum column width when 16 columns exceed 16 * 3000 budget", async () => {
        const headers = Array.from({ length: 16 }, (_, i) => (i === 0 ? "매우 긴 첫 번째 열 텍스트 설명".repeat(3) : `C${i}`));
        const sep = Array.from({ length: 16 }, () => "-");
        const vals = Array.from({ length: 16 }, (_, i) => (i === 0 ? "긴 데이터".repeat(10) : String(i)));
        const md = `| ${headers.join(" | ")} |\n| ${sep.join(" | ")} |\n| ${vals.join(" | ")} |`;

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2hwpx-width-16col-"));
        const outputPath = path.join(tempDir, "wide16.hwpx");
        const templatePath = path.resolve(__dirname, "../../template.hwpx");
        await new HwpxGenerator().generate(md, templatePath, outputPath, tempDir);

        const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
        const sectionXml = await zip.file("Contents/section0.xml")!.async("string");
        const rows = sectionXml.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) ?? [];
        assert.ok(rows.length >= 1);
        const headerRow = rows[0] ?? "";
        const widths = [...headerRow.matchAll(/<hp:cellSz\s+width="(\d+)"/g)].map((m) => parseInt(m[1], 10));

        assert.strictEqual(widths.length, 16);
        assert.strictEqual(
            widths.reduce((sum, w) => sum + w, 0),
            42520,
        );
        const expectedFloor = Math.floor(42520 / 16);
        for (const w of widths) {
            assert.ok(w >= expectedFloor, `Expected column width >= ${expectedFloor}, got ${w}`);
        }
    });
});
