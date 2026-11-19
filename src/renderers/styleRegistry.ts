import { InlineStyleContext } from "../types";

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
        reference: 1050,
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

        const newBorderFills = `
            <hh:borderFill id="${this.borderFillIds.table}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
                <hh:slash type="NONE" Crooked="0" isCounter="0"/>
                <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
                <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
            </hh:borderFill>
            <hh:borderFill id="${this.borderFillIds.tableHeader}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
                <hh:slash type="NONE" Crooked="0" isCounter="0"/>
                <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
                <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
                <hc:fillBrush><hc:winBrush faceColor="#E5E5E5" hatchColor="#000000" alpha="0"/></hc:fillBrush>
            </hh:borderFill>
            <hh:borderFill id="${this.borderFillIds.callout}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
                <hh:slash type="NONE" Crooked="0" isCounter="0"/>
                <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
                <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
                <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
                <hc:fillBrush><hc:winBrush faceColor="#F9F9F9" hatchColor="#000000" alpha="0"/></hc:fillBrush>
            </hh:borderFill>
        `;

        let updatedXml = headerXmlString.replace(/(<hh:borderFills[^>]*?itemCnt=")(\d+)(")/, (_match, prefix, currentCnt, suffix) => {
            const newCnt = parseInt(currentCnt, 10) + 3;
            return `${prefix}${newCnt}${suffix}`;
        });

        updatedXml = updatedXml.replace(/(<\/hh:borderFills>)/, `${newBorderFills}$1`);
        return updatedXml;
    }

    private injectParagraphProperty(headerXml: string): string {
        let currentParaCnt = 0;
        const has1050 = /<hh:paraPr\s+id="1050"\b/.test(headerXml);
        const addedCount = has1050 ? 9 : 10;

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
            reference: 1050,
        };

        const baseParaMatch = updatedHeader.match(new RegExp(`<hh:paraPr\\s+id="0"([^>]*)>([\\s\\S]*?)<\\/hh:paraPr>`));
        if (!baseParaMatch) {
            return updatedHeader;
        }

        const attrs = baseParaMatch[1];
        const inner = baseParaMatch[2];

        const autoTabMatch = updatedHeader.match(/<hh:tabPr\b[^>]*\bid="(\d+)"[^>]*\bautoTabLeft="1"/);
        const autoTabLeftId = autoTabMatch ? autoTabMatch[1] : "0";

        const setHangingMargin = (xmlStr: string, leftMargin: number, indentVal = -1200) => {
            return xmlStr.replace(
                /<hh:margin[^>]*>[\s\S]*?<\/hh:margin>/g,
                `<hh:margin><hc:intent value="${indentVal}" unit="HWPUNIT"/><hc:left value="${leftMargin}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>`,
            );
        };

        const centerInner = inner.replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="CENTER" vertical="BASELINE"/>`);
        const leftInner = inner.replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="LEFT" vertical="BASELINE"/>`);
        const rightInner = inner.replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="RIGHT" vertical="BASELINE"/>`);

        const refAttrs = /\btabPrIDRef="/.test(attrs)
            ? attrs.replace(/\btabPrIDRef="[^"]*"/, `tabPrIDRef="${autoTabLeftId}"`)
            : ` tabPrIDRef="${autoTabLeftId}"${attrs}`;

        const refInner = setHangingMargin(
            inner
                .replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="LEFT" vertical="BASELINE"/>`)
                .replace(/breakLatinWord="[^"]*"/g, `breakLatinWord="BREAK_WORD"`)
                .replace(/breakNonLatinWord="[^"]*"/g, `breakNonLatinWord="BREAK_WORD"`),
            1800,
            -1800,
        );

        const refParaPrDefinition = `<hh:paraPr id="1050"${refAttrs}>${refInner}</hh:paraPr>`;
        if (has1050) {
            updatedHeader = updatedHeader.replace(/<hh:paraPr\s+id="1050"\b[^>]*>[\s\S]*?<\/hh:paraPr>/, refParaPrDefinition);
        }

        const customParaPrs = `
                    <hh:paraPr id="${this.paraPrIds.level1}" ${attrs}>${setHangingMargin(inner, 1200)}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.level2}" ${attrs}>${setHangingMargin(inner, 2400)}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.level3}" ${attrs}>${setHangingMargin(inner, 3600)}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.level4}" ${attrs}>${setHangingMargin(inner, 4800)}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.level5}" ${attrs}>${setHangingMargin(inner, 6000)}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.level6}" ${attrs}>${setHangingMargin(inner, 7200)}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.center}" ${attrs}>${centerInner}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.left}" ${attrs}>${leftInner}</hh:paraPr>
                    <hh:paraPr id="${this.paraPrIds.right}" ${attrs}>${rightInner}</hh:paraPr>
                    ${has1050 ? "" : refParaPrDefinition}
                    `;

        return updatedHeader.replace(new RegExp(`</hh:paraProperties>`), `${customParaPrs}</hh:paraProperties>`);
    }
}
