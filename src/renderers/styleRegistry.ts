import { InlineStyleContext } from "../types";
import { HwpxNs, HwpxStyles } from "../hwpxConstants";

export interface StyleIds {
    bold: number;
    ul: number;
    h1: number;
    h2: number;
    h3: number;
    h4: number;
    h5: number;
    h6: number;
}

export interface ParaPrIds {
    level1: number;
    level2: number;
    level3: number;
    level4: number;
    level5: number;
    level6: number;
    center: number;
    left: number;
    right: number;
    reference: number;
}

export interface CaptionStyle {
    styleId: number;
    paraPrId: number;
    charPrId: number;
}

export interface BorderFillIds {
    table: number;
    tableHeader: number;
    callout: number;
}

interface DynamicCharPrSpec {
    id: number;
    baseCharPrId: number;
    bold: boolean;
    italic: boolean;
    strike: boolean;
    underline: boolean;
    supscript: boolean;
    subscript: boolean;
}

export class StyleRegistry {
    public styleIds: StyleIds = { bold: 0, ul: 0, h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
    public paraPrIds: ParaPrIds = {
        level1: 0,
        level2: 0,
        level3: 0,
        level4: 0,
        level5: 0,
        level6: 0,
        center: 0,
        left: 0,
        right: 0,
        reference: 0,
    };
    public captionStyle: CaptionStyle = {
        styleId: 21,
        paraPrId: 19,
        charPrId: 0,
    };
    public borderFillIds: BorderFillIds = {
        table: 3,
        tableHeader: 4,
        callout: 5,
    };

    private nextDynamicCharPrId = 20;
    private dynamicCharPrMap = new Map<string, DynamicCharPrSpec>();

    public prepareHeaderXml(headerXml: string): string {
        this.detectCaptionStyleFromHeader(headerXml);
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
        this.nextDynamicCharPrId = currentItemCnt + 8;
        this.dynamicCharPrMap.clear();

        const baseStyleMatch = updatedHeader.match(new RegExp(`<${ns}:charPr\\s+id="0"([^>]*)>([\\s\\S]*?)<\\/${ns}:charPr>`));
        if (!baseStyleMatch) {
            return updatedHeader;
        }

        const attrs = baseStyleMatch[1];
        const inner = baseStyleMatch[2];
        const setHeight = (attrStr: string, height: string) =>
            attrStr.includes("height=") ? attrStr.replace(/height="\d+"/, `height="${height}"`) : attrStr + ` height="${height}"`;

        const headingXml = (
            [
                [this.styleIds.h1, HwpxStyles.HEADING_HEIGHTS.h1],
                [this.styleIds.h2, HwpxStyles.HEADING_HEIGHTS.h2],
                [this.styleIds.h3, HwpxStyles.HEADING_HEIGHTS.h3],
                [this.styleIds.h4, HwpxStyles.HEADING_HEIGHTS.h4],
                [this.styleIds.h5, HwpxStyles.HEADING_HEIGHTS.h5],
                [this.styleIds.h6, HwpxStyles.HEADING_HEIGHTS.h6],
            ] as const
        )
            .map(([id, height]) => `<${ns}:charPr id="${id}" ${setHeight(attrs, height)}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>`)
            .join("\n                    ");

        const customStyles = `
                    <${ns}:charPr id="${this.styleIds.bold}" ${attrs}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.ul}" ${attrs}>${inner}<${ns}:underline type="bottom" shape="solid" color="000000"/></${ns}:charPr>
                    ${headingXml}
                    `;

        return updatedHeader.replace(new RegExp(`</${ns}:charProperties>`), `${customStyles}</${ns}:charProperties>`);
    }

    public finalizeHeaderXml(headerXml: string): string {
        let finalized = headerXml;

        if (this.dynamicCharPrMap.size > 0) {
            const nsMatch = finalized.match(/<([a-zA-Z]+):charProperties/);
            const ns = nsMatch ? nsMatch[1] : "hh";

            const baseStyleMatch = finalized.match(new RegExp(`<${ns}:charPr\\s+id="0"([^>]*)>([\\s\\S]*?)<\\/${ns}:charPr>`));
            if (baseStyleMatch) {
                const defaultAttrs = baseStyleMatch[1];
                const defaultInner = baseStyleMatch[2];

                const getBaseAttrsAndInner = (baseId: number): { attrs: string; inner: string } => {
                    const m = finalized.match(new RegExp(`<${ns}:charPr\\s+id="${baseId}"([^>]*)>([\\s\\S]*?)<\\/${ns}:charPr>`));
                    if (m) {
                        return { attrs: m[1], inner: m[2] };
                    }
                    return { attrs: defaultAttrs, inner: defaultInner };
                };

                const dynamicXmlParts: string[] = [];
                for (const spec of this.dynamicCharPrMap.values()) {
                    const { attrs, inner } = getBaseAttrsAndInner(spec.baseCharPrId);
                    let modifiedInner = inner;

                    if (spec.bold && !new RegExp(`<${ns}:bold\\b`).test(modifiedInner)) {
                        modifiedInner += `<${ns}:bold>1</${ns}:bold>`;
                    }
                    if (spec.italic && !new RegExp(`<${ns}:italic\\b`).test(modifiedInner)) {
                        modifiedInner += `<${ns}:italic>1</${ns}:italic>`;
                    }
                    if (spec.underline) {
                        if (new RegExp(`<${ns}:underline\\b[^>]*\\/>`).test(modifiedInner)) {
                            modifiedInner = modifiedInner.replace(
                                new RegExp(`<${ns}:underline\\b[^>]*\\/>`),
                                `<${ns}:underline type="BOTTOM" shape="SOLID" color="#000000"/>`,
                            );
                        } else {
                            modifiedInner += `<${ns}:underline type="BOTTOM" shape="SOLID" color="#000000"/>`;
                        }
                    }
                    if (spec.strike) {
                        if (new RegExp(`<${ns}:strikeout\\b[^>]*\\/>`).test(modifiedInner)) {
                            modifiedInner = modifiedInner.replace(
                                new RegExp(`<${ns}:strikeout\\b[^>]*\\/>`),
                                `<${ns}:strikeout shape="SOLID" color="#000000"/>`,
                            );
                        } else {
                            modifiedInner += `<${ns}:strikeout shape="SOLID" color="#000000"/>`;
                        }
                    }
                    if (spec.supscript && !new RegExp(`<${ns}:supscript\\b`).test(modifiedInner)) {
                        modifiedInner += `<${ns}:supscript>1</${ns}:supscript>`;
                    }
                    if (spec.subscript && !new RegExp(`<${ns}:subscript\\b`).test(modifiedInner)) {
                        modifiedInner += `<${ns}:subscript>1</${ns}:subscript>`;
                    }

                    dynamicXmlParts.push(`<${ns}:charPr id="${spec.id}"${attrs}>${modifiedInner}</${ns}:charPr>`);
                }

                finalized = finalized.replace(
                    new RegExp(`(<${ns}:charProperties[^>]*?itemCnt=")(\\d+)(")`),
                    (_match, prefix, cnt, suffix) => `${prefix}${parseInt(cnt, 10) + dynamicXmlParts.length}${suffix}`,
                );
                finalized = finalized.replace(new RegExp(`</${ns}:charProperties>`), `${dynamicXmlParts.join("")}</${ns}:charProperties>`);
            }
        }

        return finalized;
    }

    public resolveCharPrId(ctx: InlineStyleContext): number | undefined {
        const baseId = ctx.baseCharPrId || 0;
        const headingIds = new Set([
            this.styleIds.h1,
            this.styleIds.h2,
            this.styleIds.h3,
            this.styleIds.h4,
            this.styleIds.h5,
            this.styleIds.h6,
        ]);
        const isBaseAlreadyBold = baseId === this.styleIds.bold || headingIds.has(baseId);
        const bold = Boolean(ctx.bold || isBaseAlreadyBold);
        const italic = Boolean(ctx.italic);
        const strike = Boolean(ctx.strike);
        const underline = Boolean(ctx.underline);
        const supscript = Boolean(ctx.supscript);
        const subscript = Boolean(ctx.subscript);

        if (!bold && !italic && !strike && !underline && !supscript && !subscript) {
            return baseId > 0 ? baseId : undefined;
        }

        if (baseId === 0 || baseId === this.styleIds.bold) {
            if (bold && !italic && !strike && !underline && !supscript && !subscript) {
                return this.styleIds.bold;
            }
            if (!bold && !italic && !strike && underline && !supscript && !subscript) {
                return this.styleIds.ul;
            }
        }

        if (headingIds.has(baseId) && bold && !italic && !strike && !underline && !supscript && !subscript) {
            return baseId;
        }

        const effectiveBase = baseId === this.styleIds.bold ? 0 : baseId;
        const key = `${effectiveBase}|b:${bold ? 1 : 0}|i:${italic ? 1 : 0}|s:${strike ? 1 : 0}|u:${underline ? 1 : 0}|sup:${supscript ? 1 : 0}|sub:${subscript ? 1 : 0}`;
        const existing = this.dynamicCharPrMap.get(key);
        if (existing) {
            return existing.id;
        }

        const spec: DynamicCharPrSpec = {
            id: this.nextDynamicCharPrId++,
            baseCharPrId: effectiveBase,
            bold,
            italic,
            strike,
            underline,
            supscript,
            subscript,
        };
        this.dynamicCharPrMap.set(key, spec);
        return spec.id;
    }

    private detectCaptionStyleFromHeader(headerXml: string): void {
        const captionStyleMatch =
            headerXml.match(/<hh:style\b[^>]*name="(?:캡션|캡션_표)"[^>]*\/>/) ??
            headerXml.match(/<hh:style\b[^>]*engName="Caption"[^>]*\/>/);
        if (captionStyleMatch) {
            const tag = captionStyleMatch[0];
            const id = parseInt(tag.match(/\bid="(\d+)"/)?.[1] ?? "21", 10);
            const paraPrId = parseInt(tag.match(/\bparaPrIDRef="(\d+)"/)?.[1] ?? "19", 10);
            const charPrId = parseInt(tag.match(/\bcharPrIDRef="(\d+)"/)?.[1] ?? "0", 10);
            this.captionStyle = { styleId: id, paraPrId, charPrId };
        } else {
            this.captionStyle = { styleId: 0, paraPrId: 0, charPrId: 0 };
        }
    }

    private buildBorderFillXml(id: number, fillColor?: string): string {
        const w = HwpxStyles.BORDER_WIDTH;
        const c = HwpxStyles.BORDER_COLOR;
        const fillXml = fillColor
            ? `<hc:fillBrush><hc:winBrush faceColor="${fillColor}" hatchColor="${c}" alpha="0"/></hc:fillBrush>`
            : "";
        return (
            `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
            `<hh:slash type="NONE" Crooked="0" isCounter="0"/>` +
            `<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
            `<hh:leftBorder type="SOLID" width="${w}" color="${c}"/>` +
            `<hh:rightBorder type="SOLID" width="${w}" color="${c}"/>` +
            `<hh:topBorder type="SOLID" width="${w}" color="${c}"/>` +
            `<hh:bottomBorder type="SOLID" width="${w}" color="${c}"/>` +
            `<hh:diagonal type="SOLID" width="0.1 mm" color="${c}"/>` +
            fillXml +
            `</hh:borderFill>`
        );
    }

    private injectBorderFillToHeader(headerXmlString: string): string {
        let maxBorderId = 2;
        for (const m of headerXmlString.matchAll(/<hh:borderFill\s+id="(\d+)"/g)) {
            const idNum = parseInt(m[1], 10);
            if (idNum > maxBorderId) {
                maxBorderId = idNum;
            }
        }

        this.borderFillIds = {
            table: maxBorderId + 1,
            tableHeader: maxBorderId + 2,
            callout: maxBorderId + 3,
        };

        const newBorderFills = [
            this.buildBorderFillXml(this.borderFillIds.table),
            this.buildBorderFillXml(this.borderFillIds.tableHeader, HwpxStyles.TABLE_HEADER_BG),
            this.buildBorderFillXml(this.borderFillIds.callout, HwpxStyles.CALLOUT_BG),
        ].join("");

        let updatedXml = headerXmlString.replace(/(<hh:borderFills[^>]*?itemCnt=")(\d+)(")/, (_match, prefix, currentCnt, suffix) => {
            const newCnt = parseInt(currentCnt, 10) + 3;
            return `${prefix}${newCnt}${suffix}`;
        });

        updatedXml = updatedXml.replace(/(<\/hh:borderFills>)/, `${newBorderFills}$1`);
        return updatedXml;
    }

    private injectParagraphProperty(headerXml: string): string {
        let currentParaCnt = 0;
        const addedCount = 10;

        let updatedHeader = headerXml.replace(new RegExp(`<hh:paraProperties([^>]*)>`), (match, attrs) => {
            const itemCntMatch = attrs.match(/itemCnt="(\d+)"/);
            if (itemCntMatch) {
                currentParaCnt = parseInt(itemCntMatch[1], 10);
                return `<hh:paraProperties ` + attrs.replace(/itemCnt="\d+"/, `itemCnt="${currentParaCnt + addedCount}"`) + `>`;
            }
            return match;
        });

        this.paraPrIds = {
            level1: currentParaCnt,
            level2: currentParaCnt + 1,
            level3: currentParaCnt + 2,
            level4: currentParaCnt + 3,
            level5: currentParaCnt + 4,
            level6: currentParaCnt + 5,
            center: currentParaCnt + 6,
            left: currentParaCnt + 7,
            right: currentParaCnt + 8,
            reference: currentParaCnt + 9,
        };

        const baseParaMatch = updatedHeader.match(new RegExp(`<hh:paraPr\\s+id="0"([^>]*)>([\\s\\S]*?)<\\/hh:paraPr>`));
        if (!baseParaMatch) {
            return updatedHeader;
        }

        const rawAttrs = baseParaMatch[1];
        const normalizedAttrs = rawAttrs === "" || rawAttrs.startsWith(" ") ? rawAttrs : ` ${rawAttrs}`;
        const inner = baseParaMatch[2];

        let autoTabLeftId = "0";
        for (const tabTagMatch of updatedHeader.matchAll(/<hh:tabPr\b([^>]*)>/g)) {
            const tagAttrs = tabTagMatch[1];
            if (/\bautoTabLeft="(?:1|true)"/i.test(tagAttrs)) {
                const idMatch = tagAttrs.match(/\bid="(\d+)"/);
                if (idMatch) {
                    autoTabLeftId = idMatch[1];
                    break;
                }
            }
        }

        const makeMarginXml = (left: number, intent: number) =>
            `<hh:margin><hc:intent value="${intent}" unit="HWPUNIT"/><hc:left value="${left}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>`;

        const setHangingMargin = (xmlStr: string, leftMargin: number, indentVal: number = HwpxStyles.LIST_HANGING_INDENT) => {
            if (xmlStr.includes(HwpxNs.HWP_UNIT_CHAR) && /<hp:default>[\s\S]*?<\/hp:default>/.test(xmlStr)) {
                return xmlStr
                    .replace(
                        /(<hp:case\b[^>]*HwpUnitChar[^>]*>[\s\S]*?)<hh:margin[^>]*>[\s\S]*?<\/hh:margin>([\s\S]*?<\/hp:case>)/,
                        `$1${makeMarginXml(leftMargin, indentVal)}$2`,
                    )
                    .replace(
                        /(<hp:default>[\s\S]*?)<hh:margin[^>]*>[\s\S]*?<\/hh:margin>([\s\S]*?<\/hp:default>)/,
                        `$1${makeMarginXml(leftMargin * 2, indentVal * 2)}$2`,
                    );
            }
            return xmlStr.replace(/<hh:margin[^>]*>[\s\S]*?<\/hh:margin>/g, makeMarginXml(leftMargin, indentVal));
        };

        const centerInner = inner.replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="CENTER" vertical="BASELINE"/>`);
        const leftInner = inner.replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="LEFT" vertical="BASELINE"/>`);
        const rightInner = inner.replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="RIGHT" vertical="BASELINE"/>`);

        const refAttrs = /\btabPrIDRef="/.test(normalizedAttrs)
            ? normalizedAttrs.replace(/\btabPrIDRef="[^"]*"/, `tabPrIDRef="${autoTabLeftId}"`)
            : ` tabPrIDRef="${autoTabLeftId}"${normalizedAttrs}`;

        const refInner = setHangingMargin(
            inner
                .replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="LEFT" vertical="BASELINE"/>`)
                .replace(/breakLatinWord="[^"]*"/g, `breakLatinWord="BREAK_WORD"`)
                .replace(/breakNonLatinWord="[^"]*"/g, `breakNonLatinWord="BREAK_WORD"`),
            0,
            HwpxStyles.ENDNOTE_HANGING_INDENT,
        );

        const levelIds = [
            this.paraPrIds.level1,
            this.paraPrIds.level2,
            this.paraPrIds.level3,
            this.paraPrIds.level4,
            this.paraPrIds.level5,
            this.paraPrIds.level6,
        ];
        const levelParaPrs = levelIds
            .map(
                (id, idx) =>
                    `<hh:paraPr id="${id}"${normalizedAttrs}>${setHangingMargin(inner, HwpxStyles.LIST_LEVEL_STEP * (idx + 1))}</hh:paraPr>`,
            )
            .join("\n                    ");

        const customParaPrs = `
                    ${levelParaPrs}
                    <hh:paraPr id="${this.paraPrIds.center}"${normalizedAttrs}>${centerInner}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.left}"${normalizedAttrs}>${leftInner}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.right}"${normalizedAttrs}>${rightInner}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.reference}"${refAttrs}>${refInner}</hh:paraPr>
                    `;

        return updatedHeader.replace(new RegExp(`</hh:paraProperties>`), `${customParaPrs}</hh:paraProperties>`);
    }
}
