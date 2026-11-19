import { InlineStyleContext, MarkdownToken, TableCellToken } from "../types";
import { asTokenArray, getTokenText, hasVisibleInlineContent } from "../tokenUtils";
import { HwpxLayout } from "../hwpxConstants";
import { lexInlineMarkdown } from "../pipeline/markdownExtensions";
import { preprocessKoreanBoundaries, stripKoreanSentinels } from "../pipeline/koreanPreprocessor";
import { splitInlineTokensIntoLines } from "./inlineRenderer";
import { buildMergedTableGrid } from "./tableGridEngine";

export interface TableRendererCallbacks {
    generateHwpId: () => number;
    getParaPrIds: () => { center: number; left: number; right: number };
    getStyleIds: () => { bold: number };
    getBorderFillIds: () => { table: number; tableHeader: number; callout: number };
    createParagraphTag: (runXml: string, paraPrId?: number, pageBreak?: number, styleId?: number) => string;
    createRunXml: (text: string, styleId?: number) => string;
    createCaptionXml: (captionText: string, side: "TOP" | "BOTTOM", width: number) => string;
    renderInlineTokens: (tokens: MarkdownToken[], ctx: InlineStyleContext, containerWidth: number) => string;
}

export function normalizeCellToken(cell: unknown): TableCellToken {
    if (cell === null || cell === undefined) {
        return { text: "", tokens: [] };
    }
    if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
        const text = String(cell);
        return {
            text,
            tokens: text ? lexInlineMarkdown(preprocessKoreanBoundaries(text)) : [],
        };
    }

    const value = cell as { text?: unknown; raw?: unknown; tokens?: unknown };
    const text = getTokenText(value as MarkdownToken);
    const tokens = asTokenArray(value.tokens);
    if (tokens.length > 0) {
        return { text, tokens };
    }
    return {
        text,
        tokens: text ? lexInlineMarkdown(preprocessKoreanBoundaries(text)) : [],
    };
}

function estimateInlineLineLength(tokens: MarkdownToken[]): number {
    let length = 0;
    for (const token of tokens) {
        if (!token || typeof token !== "object") {
            continue;
        }
        switch (token.type) {
            case "image":
                length += 12;
                break;
            case "inlineMath": {
                const rawLen = typeof token.text === "string" ? token.text.length : 4;
                length += Math.max(4, Math.min(20, Math.round(rawLen * 0.6)));
                break;
            }
            case "footnoteRef":
                length += (typeof token.id === "string" ? token.id.length : 1) + 2;
                break;
            case "html":
                break;
            case "codespan":
            case "escape":
                length += stripKoreanSentinels(getTokenText(token)).length;
                break;
            default: {
                const nested = asTokenArray(token.tokens);
                if (nested.length > 0) {
                    length += estimateInlineLineLength(nested);
                } else {
                    length += stripKoreanSentinels(getTokenText(token)).length;
                }
                break;
            }
        }
    }
    return length;
}

function estimateCellMaxDisplayLength(cell: TableCellToken): number {
    const tokens =
        cell.tokens && cell.tokens.length > 0
            ? cell.tokens
            : cell.text
              ? lexInlineMarkdown(preprocessKoreanBoundaries(cell.text))
              : [];
    if (tokens.length === 0) {
        return 1;
    }

    const lines = splitInlineTokensIntoLines(tokens, {
        splitBr: true,
        splitNewlines: true,
        splitExplicitBackslash: true,
    });
    let maxLen = 1;
    for (const lineTokens of lines) {
        maxLen = Math.max(maxLen, estimateInlineLineLength(lineTokens));
    }
    return maxLen;
}

function trimEdgeWhitespaceTokens(tokens: MarkdownToken[]): MarkdownToken[] {
    if (tokens.length === 0) {
        return tokens;
    }
    const result = tokens.map((t) => ({ ...t }));
    const first = result[0];
    if (first.type === "text" && !Array.isArray(first.tokens)) {
        const trimmedStart = getTokenText(first).replace(/^[ \t]+/, "");
        first.text = trimmedStart;
        first.raw = trimmedStart;
    }
    const last = result[result.length - 1];
    if (last.type === "text" && !Array.isArray(last.tokens)) {
        const trimmedEnd = getTokenText(last).replace(/[ \t]+$/, "");
        last.text = trimmedEnd;
        last.raw = trimmedEnd;
    }
    return result.filter((t) => t.type !== "text" || Array.isArray(t.tokens) || getTokenText(t).length > 0);
}

interface TableShellOptions {
    numberingType: "NONE" | "TABLE";
    repeatHeader: 0 | 1;
    rowCount: number;
    colCount: number;
    width: number;
    borderFillId: number;
    captionXml?: string;
    bodyXml: string;
}

export class TableRenderer {
    private readonly callbacks: TableRendererCallbacks;

    public constructor(callbacks: TableRendererCallbacks) {
        this.callbacks = callbacks;
    }

    public renderTableToken(token: MarkdownToken, containerWidth: number): string {
        const headerCells = Array.isArray(token.header) ? token.header.map(normalizeCellToken) : [];
        const bodyRows = Array.isArray(token.rows)
            ? token.rows.map((row) => (Array.isArray(row) ? row.map(normalizeCellToken) : []))
            : [];

        const rows: TableCellToken[][] = [];
        if (headerCells.length > 0) {
            rows.push(headerCells);
        }
        rows.push(...bodyRows);

        const align = Array.isArray(token.align) ? token.align : [];
        return this.createTableXml(rows, containerWidth, align, token.caption, token.captionSide ?? "TOP");
    }

    private wrapTableParagraph(options: TableShellOptions): string {
        const tableId = this.callbacks.generateHwpId();
        const m = HwpxLayout.CELL_MARGIN;
        const outY = HwpxLayout.TABLE_OUT_MARGIN_Y;
        const xml =
            `<hp:tbl id="${tableId}" zOrder="0" numberingType="${options.numberingType}" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="${options.repeatHeader}" rowCnt="${options.rowCount}" colCnt="${options.colCount}" cellSpacing="0" borderFillIDRef="${options.borderFillId}" noAdjust="1">` +
            `<hp:sz width="${options.width}" widthRelTo="ABSOLUTE" height="0" heightRelTo="ABSOLUTE" protect="0"/>` +
            `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
            `<hp:outMargin left="0" right="0" top="${outY}" bottom="${outY}"/>` +
            `<hp:inMargin left="${m}" right="${m}" top="${m}" bottom="${m}"/>` +
            (options.captionXml ?? "") +
            options.bodyXml +
            `</hp:tbl>`;
        return this.callbacks.createParagraphTag(`<hp:run>${xml}<hp:t/></hp:run>`, 0);
    }

    public renderCalloutXml(innerXml: string, containerWidth: number): string {
        const totalTableWidth = Math.max(4000, containerWidth);
        const borderFillIds = this.callbacks.getBorderFillIds();
        const paraPrIds = this.callbacks.getParaPrIds();
        const safeInnerXml =
            innerXml.trim().length > 0
                ? innerXml
                : this.callbacks.createParagraphTag(this.callbacks.createRunXml(""), paraPrIds.left);
        const m = HwpxLayout.CELL_MARGIN;
        const bodyXml =
            `<hp:tr>` +
            `<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${borderFillIds.callout}">` +
            `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${safeInnerXml}</hp:subList>` +
            `<hp:cellAddr colAddr="0" rowAddr="0"/>` +
            `<hp:cellSpan colSpan="1" rowSpan="1"/>` +
            `<hp:cellSz width="${totalTableWidth}" height="${HwpxLayout.DEFAULT_ROW_HEIGHT}"/>` +
            `<hp:cellMargin left="${m}" right="${m}" top="${m}" bottom="${m}"/>` +
            `</hp:tc>` +
            `</hp:tr>`;

        return this.wrapTableParagraph({
            numberingType: "NONE",
            repeatHeader: 0,
            rowCount: 1,
            colCount: 1,
            width: totalTableWidth,
            borderFillId: borderFillIds.callout,
            bodyXml,
        });
    }

    private createTableXml(
        rows: TableCellToken[][],
        containerWidth: number,
        align: Array<"left" | "center" | "right" | null>,
        captionText?: string,
        captionSide: "TOP" | "BOTTOM" = "TOP",
    ): string {
        const safeRows: TableCellToken[][] = rows.length > 0 ? rows : [[{ text: "", tokens: [] }]];
        const rowCount = safeRows.length;
        const columnMaxLengths = this.getColumnMaxLengths(safeRows);
        const colCount = columnMaxLengths.length;
        const totalTableWidth = Math.max(4000, containerWidth);

        const borderFillIds = this.callbacks.getBorderFillIds();
        const paraPrIds = this.callbacks.getParaPrIds();
        const styleIds = this.callbacks.getStyleIds();
        const m = HwpxLayout.CELL_MARGIN;
        const captionXml = captionText ? this.callbacks.createCaptionXml(captionText, captionSide, totalTableWidth) : "";

        const widths = this.calculateColumnWidths(columnMaxLengths, totalTableWidth);
        const mergedGrid = buildMergedTableGrid(safeRows, widths);

        let bodyXml = "";
        mergedGrid.forEach((row) => {
            bodyXml += `<hp:tr>`;

            for (const gridCell of row) {
                if (gridCell.absorbed) {
                    continue;
                }

                const isHeaderRow = gridCell.isHeader;
                const cellBorderFillId = isHeaderRow ? borderFillIds.tableHeader : borderFillIds.table;
                const defaultCellStyleId = isHeaderRow ? styleIds.bold : undefined;
                const cellWidth = gridCell.width;
                const cell = gridCell.cell;
                const cellTokens =
                    cell.tokens && cell.tokens.length > 0
                        ? cell.tokens
                        : cell.text
                          ? lexInlineMarkdown(preprocessKoreanBoundaries(cell.text))
                          : [];

                const cellLineGroups = splitInlineTokensIntoLines(cellTokens, {
                    splitBr: true,
                    splitNewlines: true,
                    splitExplicitBackslash: true,
                }).map(trimEdgeWhitespaceTokens);
                const nonEmptyLines = cellLineGroups.filter(hasVisibleInlineContent);

                const effectiveLines = nonEmptyLines.length > 0 ? nonEmptyLines : [[]];
                const cellAvailableWidth = Math.max(2000, cellWidth - HwpxLayout.CALLOUT_PADDING_X);
                const colAlign = align[gridCell.col] ?? null;
                const cellParaPrId = isHeaderRow
                    ? colAlign === "left"
                        ? paraPrIds.left
                        : colAlign === "right"
                          ? paraPrIds.right
                          : paraPrIds.center
                    : colAlign === "center"
                      ? paraPrIds.center
                      : colAlign === "right"
                        ? paraPrIds.right
                        : paraPrIds.left;
                const cellParagraphsXml = effectiveLines
                    .map((lineToks) =>
                        this.callbacks.createParagraphTag(
                            lineToks.length > 0
                                ? this.callbacks.renderInlineTokens(
                                      lineToks,
                                      { baseCharPrId: defaultCellStyleId ?? 0 },
                                      cellAvailableWidth,
                                  )
                                : this.callbacks.createRunXml("", defaultCellStyleId),
                            cellParaPrId,
                        ),
                    )
                    .join("");

                const cellHeight = HwpxLayout.DEFAULT_ROW_HEIGHT * Math.max(1, effectiveLines.length, gridCell.rowSpan);

                bodyXml += `<hp:tc name="" header="${isHeaderRow ? 1 : 0}" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${cellBorderFillId}">`;
                bodyXml += `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${cellParagraphsXml}</hp:subList>`;
                bodyXml += `<hp:cellAddr colAddr="${gridCell.col}" rowAddr="${gridCell.row}"/>`;
                bodyXml += `<hp:cellSpan colSpan="${gridCell.colSpan}" rowSpan="${gridCell.rowSpan}"/>`;
                bodyXml += `<hp:cellSz width="${cellWidth}" height="${cellHeight}"/>`;
                bodyXml += `<hp:cellMargin left="${m}" right="${m}" top="${m}" bottom="${m}"/>`;
                bodyXml += `</hp:tc>`;
            }

            bodyXml += `</hp:tr>`;
        });

        return this.wrapTableParagraph({
            numberingType: "TABLE",
            repeatHeader: 1,
            rowCount,
            colCount,
            width: totalTableWidth,
            borderFillId: borderFillIds.table,
            captionXml,
            bodyXml,
        });
    }

    private calculateColumnWidths(rowLengths: number[], totalAvailableWidth: number): number[] {
        const safeLengths = rowLengths.length > 0 ? rowLengths : [1];
        const weights = safeLengths.map((len) => Math.max(len + 2, 5));
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        const widths = weights.map((w) => Math.floor(totalAvailableWidth * (w / totalWeight)));

        const currentSum = widths.reduce((a, b) => a + b, 0);
        widths[widths.length - 1] += totalAvailableWidth - currentSum;
        return widths;
    }

    private getColumnMaxLengths(rows: TableCellToken[][]): number[] {
        if (rows.length === 0) {
            return [1];
        }

        const maxColumnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
        const maxLengths = new Array<number>(Math.max(maxColumnCount, 1)).fill(1);

        for (const row of rows) {
            for (let index = 0; index < maxLengths.length; index += 1) {
                const cell = row[index];
                if (cell) {
                    maxLengths[index] = Math.max(maxLengths[index], estimateCellMaxDisplayLength(cell));
                }
            }
        }

        return maxLengths;
    }
}
