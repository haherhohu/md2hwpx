import { MarkdownToken } from "./types";

export class HwpxXmlRenderer {
    private styleIds = { bold: 0, ul: 0, h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
    private paraPrIds = { level1: 0, level2: 0, level3: 0 };
    private currentElementId = 1000000000;

    private generateHwpId(): number {
        return this.currentElementId++;
    }

    public prepareHeaderXml(headerXml: string): string {
        let updatedHeader = this.injectBorderFillToHeader(headerXml);
        updatedHeader = this.injectParagraphProperty(updatedHeader);

        const nsMatch = updatedHeader.match(/<([a-zA-Z]+):charProperties/);
        const ns = nsMatch ? nsMatch[1] : "hh";

        let currentItemCnt = 0;
        updatedHeader = updatedHeader.replace(new RegExp(`<${ns}:charProperties([^>]*)>`), (match, attrs) => {
            const itemCntMatch = attrs.match(/itemCnt="(\d+)"/);
            if (itemCntMatch) {
                currentItemCnt = parseInt(itemCntMatch[1], 10);
                return `<${ns}:charProperties ` + attrs.replace(/itemCnt="\d+"/, `itemCnt="${currentItemCnt + 8}"`) + `>`;
            }
            return match;
        });

        this.styleIds = {
            bold: currentItemCnt,
            ul: currentItemCnt + 1,
            h1: currentItemCnt + 2,
            h2: currentItemCnt + 3,
            h3: currentItemCnt + 4,
            h4: currentItemCnt + 5,
            h5: currentItemCnt + 6,
            h6: currentItemCnt + 7,
        };

        const baseStyleMatch = updatedHeader.match(new RegExp(`<${ns}:charPr\\s+id="0"([^>]*)>([\\s\\S]*?)<\\/${ns}:charPr>`));
        if (!baseStyleMatch) {
            return updatedHeader;
        }

        const attrs = baseStyleMatch[1];
        const inner = baseStyleMatch[2];
        const setHeight = (attrStr: string, height: string) =>
            attrStr.includes("height=") ? attrStr.replace(/height="\d+"/, `height="${height}"`) : attrStr + ` height="${height}"`;

        const customStyles = `
                    <${ns}:charPr id="${this.styleIds.bold}" ${attrs}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.ul}" ${attrs}>${inner}<${ns}:underline type="bottom" shape="solid" color="000000"/></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.h1}" ${setHeight(attrs, "1600")}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.h2}" ${setHeight(attrs, "1400")}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.h3}" ${setHeight(attrs, "1200")}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.h4}" ${setHeight(attrs, "1200")}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.h5}" ${setHeight(attrs, "1200")}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.h6}" ${setHeight(attrs, "1200")}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    `;

        return updatedHeader.replace(new RegExp(`</${ns}:charProperties>`), `${customStyles}</${ns}:charProperties>`);
    }

    public renderTokens(tokens: MarkdownToken[]): string {
        return tokens.map((token) => this.convertTokenToXml(token)).join("");
    }

    private createParagraphTag(runXml: string, paraPrId = 0): string {
        const id = this.generateHwpId();
        return `<hp:p id="${id}" paraPrIDRef="${paraPrId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runXml}</hp:p>`;
    }

    private injectBorderFillToHeader(headerXmlString: string): string {
        const newBorderFill = `
            <hh:borderFill id="3" threeD="0" shadow="0" backColor="none" zeroShape="0">
                <hh:leftBorder type="SOLID" width="0.1 mm" color="#000000"/>
                <hh:rightBorder type="SOLID" width="0.1 mm" color="#000000"/>
                <hh:topBorder type="SOLID" width="0.1 mm" color="#000000"/>
                <hh:bottomBorder type="SOLID" width="0.1 mm" color="#000000"/>
            </hh:borderFill>
        `;

        let updatedXml = headerXmlString.replace(/(<hh:borderFills[^>]*?itemCnt=")(\d+)(")/, (match, prefix, currentCnt, suffix) => {
            const newCnt = parseInt(currentCnt, 10) + 1;
            return `${prefix}${newCnt}${suffix}`;
        });

        updatedXml = updatedXml.replace(/(<\/hh:borderFills>)/, `${newBorderFill}$1`);
        return updatedXml;
    }

    private injectParagraphProperty(headerXml: string): string {
        let currentParaCnt = 0;
        let updatedHeader = headerXml.replace(new RegExp(`<hh:paraProperties([^>]*)>`), (match, attrs) => {
            const itemCntMatch = attrs.match(/itemCnt="(\d+)"/);
            if (itemCntMatch) {
                currentParaCnt = parseInt(itemCntMatch[1], 10);
                return `<hh:paraProperties ` + attrs.replace(/itemCnt="\d+"/, `itemCnt="${currentParaCnt + 3}"`) + `>`;
            }
            return match;
        });

        this.paraPrIds = { level1: currentParaCnt, level2: currentParaCnt + 1, level3: currentParaCnt + 2 };

        const baseParaMatch = updatedHeader.match(new RegExp(`<hh:paraPr\\s+id="0"([^>]*)>([\\s\\S]*?)<\\/hh:paraPr>`));
        if (!baseParaMatch) {
            return updatedHeader;
        }

        const attrs = baseParaMatch[1];
        const inner = baseParaMatch[2];

        const setMargin = (xmlStr: string, leftMargin: number) => {
            return xmlStr.replace(
                new RegExp(`<hh:margin([^>]*)>([\\s\\S]*?)<\\/hh:margin>`),
                `<hh:margin><hc:indent value="${-leftMargin}" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>`,
            );
        };

        const customParaPrs = `
                    <hh:paraPr id="${this.paraPrIds.level1}" ${attrs}>${setMargin(inner, 1500)}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.level2}" ${attrs}>${setMargin(inner, 2600)}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.level3}" ${attrs}>${setMargin(inner, 3200)}</hh:paraPr>
                    `;

        return updatedHeader.replace(new RegExp(`</hh:paraProperties>`), `${customParaPrs}</hh:paraProperties>`);
    }

    private convertTokenToXml(token: MarkdownToken, listLevel = 0): string {
        switch (token.type) {
            case "heading": {
                const headingMap: Record<number, number> = {
                    1: this.styleIds.h1,
                    2: this.styleIds.h2,
                    3: this.styleIds.h3,
                    4: this.styleIds.h4,
                    5: this.styleIds.h5,
                    6: this.styleIds.h6,
                };
                const hId = headingMap[token.depth] ?? this.styleIds.h6;
                return this.createParagraphTag(this.parseInlineToRuns((hId === this.styleIds.h1 ? "" : "\n") + token.text + "\n", hId));
            }
            case "paragraph":
                return this.createParagraphTag(this.parseInlineToRuns(token.text));
            case "list":
                return (token.items ?? []).map((item: MarkdownToken) => this.convertTokenToXml(item, listLevel)).join("");
            case "list_item": {
                const bullet = listLevel === 0 ? "□ " : listLevel === 1 ? "  ◦ " : "    • ";
                const paraPrId = listLevel === 0 ? this.paraPrIds.level1 : listLevel === 1 ? this.paraPrIds.level2 : this.paraPrIds.level3;

                if (!(token.tokens && token.tokens.length > 0)) {
                    return this.createParagraphTag(this.parseInlineToRuns(`${bullet}${token.text ?? ""}`), paraPrId);
                }

                let xml = "";
                let isFirstText = true;
                for (const child of token.tokens) {
                    if (child.type === "text" || child.type === "paragraph") {
                        const prefix = isFirstText ? bullet : "    ";
                        xml += this.createParagraphTag(this.parseInlineToRuns(`${prefix}${child.text ?? ""}`), paraPrId);
                        isFirstText = false;
                    } else if (child.type === "list") {
                        xml += this.convertTokenToXml(child, listLevel + 1);
                    }
                }
                return xml;
            }
            case "blockquote":
                return this.createTableXml([[this.extractBlockquoteText(token)]]);
            case "table": {
                const rows: string[][] = [];
                rows.push((token.header ?? []).map((cell: unknown) => this.extractCellText(cell)));
                (token.rows ?? []).forEach((row: unknown[]) => {
                    rows.push((row ?? []).map((cell: unknown) => this.extractCellText(cell)));
                });
                return this.createTableXml(rows);
            }
            case "space":
                return this.createParagraphTag("<hp:run><hp:t></hp:t></hp:run>");
            default:
                if (token.raw) {
                    return this.createParagraphTag(this.parseInlineToRuns(token.raw));
                }
                return "";
        }
    }

    private extractCellText(cell: unknown): string {
        if (cell === null || cell === undefined) {
            return "";
        }
        if (typeof cell === "string") {
            return cell;
        }
        if (typeof cell === "number" || typeof cell === "boolean") {
            return String(cell);
        }

        const value = cell as { text?: unknown; raw?: unknown; tokens?: Array<{ text?: unknown; raw?: unknown }> };
        if (typeof value.text === "string") {
            return value.text;
        }
        if (typeof value.raw === "string") {
            return value.raw;
        }
        if (Array.isArray(value.tokens)) {
            return value.tokens
                .map((token) => {
                    if (typeof token.text === "string") {
                        return token.text;
                    }
                    if (typeof token.raw === "string") {
                        return token.raw;
                    }
                    return "";
                })
                .join("");
        }
        return "";
    }

    private extractBlockquoteText(token: MarkdownToken): string {
        if (typeof token.text === "string" && token.text.length > 0) {
            return token.text;
        }
        if (Array.isArray(token.tokens)) {
            return token.tokens
                .map((child: MarkdownToken) => {
                    if (typeof child.text === "string") {
                        return child.text;
                    }
                    if (typeof child.raw === "string") {
                        return child.raw;
                    }
                    return "";
                })
                .join("\n")
                .trim();
        }
        return "";
    }

    private parseInlineToRuns(text: string, defaultStyleId?: number): string {
        if (!text) {
            return `<hp:run ${defaultStyleId ? `charPrIDRef="${defaultStyleId}"` : ""}><hp:t></hp:t></hp:run>`;
        }

        let processed = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const defAttr = defaultStyleId ? `charPrIDRef="${defaultStyleId}"` : "";

        processed = processed.replace(
            /\*\*(.*?)\*\*/g,
            `</hp:t></hp:run><hp:run charPrIDRef="${this.styleIds.bold}"><hp:t>$1</hp:t></hp:run><hp:run ${defAttr}><hp:t>`,
        );

        processed = processed.replace(
            /&lt;u&gt;(.*?)&lt;\/u&gt;/g,
            `</hp:t></hp:run><hp:run charPrIDRef="${this.styleIds.ul}"><hp:t>$1</hp:t></hp:run><hp:run ${defAttr}><hp:t>`,
        );

        let result = `<hp:run ${defAttr}><hp:t>${processed}</hp:t></hp:run>`;
        result = result.replace(/<hp:run[^>]*><hp:t><\/hp:t><\/hp:run>/g, "");
        return result;
    }

    private createTableXml(rows: string[][]): string {
        const safeRows = rows.length > 0 ? rows : [[""]];
        const tableId = this.generateHwpId();
        const rowCount = safeRows.length;
        const columnMaxLengths = this.getColumnMaxLengths(safeRows);
        const colCount = columnMaxLengths.length;

        let xml = `<hp:tbl id="${tableId}" zOrder="0" numberingType="table" textWrap="topAndBottom" halfFont="0" borderFillIDRef="3" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0" rowCnt="${rowCount}" colCnt="${colCount}" cellSpacing="0">`;
        xml += `<hp:sz width="42000" widthRelTo="ABSOLUTE" height="0" heightRelTo="ABSOLUTE" protect="0"/>`;
        xml += `<hp:pos treatAsChar="0"/>`;
        xml += `<hp:outMargin left="0" right="0" top="0" bottom="0"/>`;
        xml += `<hp:inMargin left="280" right="280" top="280" bottom="280"/>`;

        const widths = this.calculateColumnWidths(columnMaxLengths, 42000);

        safeRows.forEach((row, rowIndex) => {
            xml += `<hp:tr>`;

            row.forEach((cellText, colIndex) => {
                const cellWidth = widths[colIndex] ?? widths[widths.length - 1];
                xml += `<hp:tc name="" header="0" hasMargin="1" protect="0" borderFillIDRef="3">`;
                xml += `<hp:subList>${this.createParagraphTag(this.parseInlineToRuns(cellText))}</hp:subList>`;
                xml += `<hp:cellAddr colAddr="${colIndex}" rowAddr="${rowIndex}" />`;
                xml += `<hp:cellSpan colSpan="1" rowSpan="1" />`;
                xml += `<hp:cellSz width="${cellWidth}" height="1500"/>`;
                xml += `<hp:cellMargin left="280" right="280" top="280" bottom="280"/>`;
                xml += `<hp:tcPr leftBorder="1" rightBorder="1" topBorder="1" bottomBorder="1"/>`;
                xml += `</hp:tc>`;
            });

            xml += `</hp:tr>`;
        });

        xml += `</hp:tbl>`;
        return this.createParagraphTag(`<hp:run>${xml}</hp:run>`);
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

    private getColumnMaxLengths(rows: string[][]): number[] {
        if (rows.length === 0) {
            return [1];
        }

        const maxColumnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
        const maxLengths = new Array<number>(Math.max(maxColumnCount, 1)).fill(1);

        for (const row of rows) {
            for (let index = 0; index < maxLengths.length; index++) {
                const currentLength = (row[index] ?? "").length;
                maxLengths[index] = Math.max(maxLengths[index], currentLength);
            }
        }

        return maxLengths;
    }
}
