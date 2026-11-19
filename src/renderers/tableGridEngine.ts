import { MarkdownToken, TableCellToken } from "../types";
import { asTokenArray } from "../tokenUtils";
import { stripKoreanSentinels } from "../pipeline/koreanPreprocessor";

export interface MergedTableCell {
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
    width: number;
    absorbed: boolean;
    isHeader: boolean;
    cell: TableCellToken;
}

function collectTokenPlainText(tokens: MarkdownToken[]): string {
    let text = "";
    for (const tok of tokens) {
        if (!tok || typeof tok !== "object") {
            continue;
        }
        const nested = asTokenArray(tok.tokens);
        if (nested.length > 0) {
            text += collectTokenPlainText(nested);
        } else {
            text += typeof tok.raw === "string" ? tok.raw : typeof tok.text === "string" ? tok.text : "";
        }
    }
    return text;
}

/**
 * Extracts trimmed raw-marker cell text without modifying the underlying AST.
 */
export function getPlainCellText(cell: TableCellToken): string {
    const raw =
        typeof cell.text === "string" && cell.text.length > 0
            ? cell.text
            : collectTokenPlainText(asTokenArray(cell.tokens));
    return stripKoreanSentinels(raw).trim();
}

/**
 * Builds a 2D HWPX table grid by interpreting exact `<` (merge left) and
 * `^` (merge up) markers after `marked` has already constructed the table AST.
 */
export function buildMergedTableGrid(
    rows: TableCellToken[][],
    columnWidths: number[],
): MergedTableCell[][] {
    const rowCount = rows.length;
    const colCount = Math.max(columnWidths.length, 1);

    const grid: MergedTableCell[][] = rows.map((row, rowIndex) => {
        const isHeader = rowIndex === 0 && rowCount > 1;
        const normalizedRow: MergedTableCell[] = [];
        for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
            const cell = row[colIndex] ?? { text: "", tokens: [] };
            normalizedRow.push({
                row: rowIndex,
                col: colIndex,
                rowSpan: 1,
                colSpan: 1,
                width: columnWidths[colIndex] ?? columnWidths[columnWidths.length - 1] ?? 4000,
                absorbed: false,
                isHeader,
                cell,
            });
        }
        return normalizedRow;
    });

    // Pass 1: horizontal merge left (`<`)
    for (let r = 0; r < rowCount; r += 1) {
        for (let c = 1; c < colCount; c += 1) {
            if (getPlainCellText(grid[r][c].cell) !== "<") {
                continue;
            }
            let anchorCol = c - 1;
            while (anchorCol >= 0 && grid[r][anchorCol].absorbed) {
                anchorCol -= 1;
            }
            if (anchorCol < 0) {
                continue;
            }
            const anchor = grid[r][anchorCol];
            anchor.colSpan += 1;
            anchor.width += grid[r][c].width;
            grid[r][c].absorbed = true;
        }
    }

    // Pass 2: vertical merge up (`^`), preserving strict rectangular geometry
    for (let r = 1; r < rowCount; r += 1) {
        for (let c = 0; c < colCount; c += 1) {
            const current = grid[r][c];
            if (current.absorbed || getPlainCellText(current.cell) !== "^") {
                continue;
            }

            let anchorRow = r - 1;
            while (anchorRow >= 0 && grid[anchorRow][c].absorbed) {
                anchorRow -= 1;
            }
            if (anchorRow < 0) {
                continue;
            }

            const anchor = grid[anchorRow][c];
            // Anchor must start at column c and span continuously down to row r - 1
            if (anchor.col !== c || anchorRow + anchor.rowSpan !== r) {
                continue;
            }

            if (anchor.colSpan === 1 && current.colSpan === 1) {
                anchor.rowSpan += 1;
                current.absorbed = true;
                continue;
            }

            // Rectangular check for multi-column anchors:
            // Either row r already merged `^` + `<` to match anchor.colSpan,
            // or every spanned column c..c+anchor.colSpan-1 in row r is an unmerged `^`.
            if (current.colSpan === anchor.colSpan) {
                anchor.rowSpan += 1;
                current.absorbed = true;
                continue;
            }

            let allSingleUpMarkers = c + anchor.colSpan <= colCount;
            if (allSingleUpMarkers) {
                for (let k = c; k < c + anchor.colSpan; k += 1) {
                    const candidate = grid[r][k];
                    if (
                        (k > c && candidate.absorbed) ||
                        candidate.colSpan !== 1 ||
                        getPlainCellText(candidate.cell) !== "^"
                    ) {
                        allSingleUpMarkers = false;
                        break;
                    }
                }
            }

            if (allSingleUpMarkers) {
                anchor.rowSpan += 1;
                for (let k = c; k < c + anchor.colSpan; k += 1) {
                    grid[r][k].absorbed = true;
                }
            }
        }
    }

    return grid;
}
