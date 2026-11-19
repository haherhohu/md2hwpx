import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { EmbeddedImageItem, FootnoteDefinition, InlineStyleContext, MarkdownToken } from "./types";
import { asTokenArray } from "./tokenUtils";
import { lexInlineMarkdown } from "./pipeline/markdownExtensions";
import { preprocessKoreanBoundaries, stripKoreanSentinels } from "./pipeline/koreanPreprocessor";
import { InlineRenderCallbacks, renderInlineTokensToRuns, splitInlineTokensIntoLines } from "./renderers/inlineRenderer";
import { TableRenderer } from "./renderers/tableRenderer";

interface BlockRenderContext {
    containerWidth: number;
    inCallout: boolean;
    listLevel: number;
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

// 1x1 solid white PNG fallback buffer
const FALLBACK_PNG_BUFFER = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
);

export class HwpxXmlRenderer {
    private styleIds = { bold: 0, ul: 0, h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
    private paraPrIds = {
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
    private captionStyle = {
        styleId: 21,
        paraPrId: 19,
        charPrId: 0,
    };
    private borderFillIds = {
        table: 3,
        tableHeader: 4,
        callout: 5,
    };

    private contentWidth = 42520;
    private currentElementId = 1000000000;
    private nextDynamicCharPrId = 20;
    private dynamicCharPrMap = new Map<string, DynamicCharPrSpec>();

    private footnotes: Array<{ index: number; id: string; text: string; referenced: boolean }> = [];
    private linkObjects: Array<{ id: number; href: string; type: "WEB" | "REF" }> = [];
    private embeddedImages: EmbeddedImageItem[] = [];
    private imageDedupeMap = new Map<string, string>(); // dedupeKey -> binaryId
    private imageAspectRatioMap = new Map<string, { width: number; height: number }>();
    private hasExplicitReferenceHeading = false;
    private readonly baseDir: string;
    private readonly tableRenderer: TableRenderer;

    public constructor(baseDir: string = process.cwd()) {
        this.baseDir = baseDir;
        this.tableRenderer = new TableRenderer({
            generateHwpId: () => this.generateHwpId(),
            getParaPrIds: () => ({
                center: this.paraPrIds.center,
                left: this.paraPrIds.left,
                right: this.paraPrIds.right,
            }),
            getStyleIds: () => ({ bold: this.styleIds.bold }),
            getBorderFillIds: () => this.borderFillIds,
            createParagraphTag: (runXml, paraPrId, pageBreak, styleId) =>
                this.createParagraphTag(runXml, paraPrId, pageBreak, styleId),
            createRunXml: (text, styleId) => this.createRunXml(text, styleId),
            createCaptionXml: (captionText, side, width) => this.createCaptionXml(captionText, side, width),
            renderInlineTokens: (tokens, ctx, containerWidth) => this.renderInlineTokens(tokens, ctx, containerWidth),
        });
    }

    public setContentWidth(width: number): void {
        if (Number.isFinite(width) && width > 10000) {
            this.contentWidth = Math.floor(width);
        }
    }

    public getEmbeddedImages(): EmbeddedImageItem[] {
        return this.embeddedImages;
    }

    private generateHwpId(): number {
        return this.currentElementId++;
    }

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

    public renderTokens(tokens: MarkdownToken[]): string {
        this.footnotes = [];
        this.linkObjects = [];
        this.embeddedImages = [];
        this.imageDedupeMap.clear();
        this.imageAspectRatioMap.clear();
        this.hasExplicitReferenceHeading = false;

        // Pre-register footnote definitions so numbering matches definition order
        for (const token of tokens) {
            if (token.type === "footnotes" && Array.isArray(token.footnoteDefs)) {
                for (const def of token.footnoteDefs as FootnoteDefinition[]) {
                    this.registerFootnoteDefinition(def.id, def.text);
                }
            }
        }

        const contentTokens = tokens.filter((t) => t.type !== "footnotes");
        const content = this.renderTokensInternal(contentTokens);
        return content + this.renderEndnotesSection();
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
                    (match, prefix, cnt, suffix) => `${prefix}${parseInt(cnt, 10) + dynamicXmlParts.length}${suffix}`,
                );
                finalized = finalized.replace(new RegExp(`</${ns}:charProperties>`), `${dynamicXmlParts.join("")}</${ns}:charProperties>`);
            }
        }

        return finalized;
    }

    private resolveCharPrId(ctx: InlineStyleContext): number | undefined {
        const baseId = ctx.baseCharPrId || 0;
        const headingIds = new Set([this.styleIds.h1, this.styleIds.h2, this.styleIds.h3, this.styleIds.h4, this.styleIds.h5, this.styleIds.h6]);
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

    private renderTokensInternal(tokens: MarkdownToken[]): string {
        return this.renderBlockTokens(tokens, {
            containerWidth: this.contentWidth,
            inCallout: false,
            listLevel: 0,
        });
    }

    private renderBlockTokens(tokens: MarkdownToken[], context: BlockRenderContext): string {
        return tokens.map((token) => this.convertTokenToXml(token, context)).join("");
    }

    private createParagraphTag(runXml: string, paraPrId = 0, pageBreak = 0, styleId = 0): string {
        const id = this.generateHwpId();
        return `<hp:p id="${id}" paraPrIDRef="${paraPrId}" styleIDRef="${styleId}" pageBreak="${pageBreak}" columnBreak="0" merged="0">${runXml}</hp:p>`;
    }

    private createHorizontalRuleParagraph(width = this.contentWidth, paraPrId = 0): string {
        const pId = this.generateHwpId();
        const lineId = this.generateHwpId();
        const instId = this.generateHwpId();
        const safeWidth = Math.max(2000, width);
        const scaleX = (safeWidth / 100).toFixed(6);
        return (
            `<hp:p id="${pId}" paraPrIDRef="${paraPrId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
            `<hp:run charPrIDRef="0">` +
            `<hp:line id="${lineId}" zOrder="0" numberingType="NONE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${instId}" isReverseHV="0">` +
            `<hp:offset x="0" y="0"/>` +
            `<hp:orgSz width="100" height="100"/>` +
            `<hp:curSz width="${safeWidth}" height="0"/>` +
            `<hp:flip horizontal="0" vertical="0"/>` +
            `<hp:rotationInfo angle="0"/>` +
            `<hp:renderingInfo>` +
            `<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
            `<hc:scaMatrix e1="${scaleX}" e2="0" e3="0" e4="0" e5="0" e6="0"/>` +
            `<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
            `</hp:renderingInfo>` +
            `<hp:lineShape color="#000000" width="141" style="SOLID" endCap="FLAT" headStyle="NORMAL" tailStyle="NORMAL" headfill="0" tailfill="0" headSz="SMALL_SMALL" tailSz="SMALL_SMALL" outlineStyle="NORMAL" alpha="0"/>` +
            `<hp:shadow type="NONE" color="#B2B2B2" offsetX="0" offsetY="0" alpha="0"/>` +
            `<hc:startPt x="0" y="0"/>` +
            `<hc:endPt x="100" y="100"/>` +
            `<hp:sz width="10000" widthRelTo="PARA" height="0" heightRelTo="ABSOLUTE" protect="0"/>` +
            `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
            `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
            `<hp:shapeComment>선입니다.</hp:shapeComment>` +
            `</hp:line>` +
            `<hp:t/>` +
            `</hp:run>` +
            `<hp:linesegarray>` +
            `<hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="${safeWidth}" flags="393216"/>` +
            `</hp:linesegarray>` +
            `</hp:p>`
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

        let updatedXml = headerXmlString.replace(/(<hh:borderFills[^>]*?itemCnt=")(\d+)(")/, (match, prefix, currentCnt, suffix) => {
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

        const updatedHeader = headerXml.replace(new RegExp(`<hh:paraProperties([^>]*)>`), (match, attrs) => {
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

        // Hanging indent (Shift-Tab 내어쓰기): left = leftMargin, intent = indentVal
        const setHangingMargin = (xmlStr: string, leftMargin: number, indentVal = -1200) => {
            return xmlStr.replace(
                /<hh:margin[^>]*>[\s\S]*?<\/hh:margin>/g,
                `<hh:margin><hc:intent value="${indentVal}" unit="HWPUNIT"/><hc:left value="${leftMargin}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>`,
            );
        };

        const centerInner = inner.replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="CENTER" vertical="BASELINE"/>`);
        const leftInner = inner.replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="LEFT" vertical="BASELINE"/>`);
        const rightInner = inner.replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="RIGHT" vertical="BASELINE"/>`);

        const refInner = setHangingMargin(
            inner
                .replace(/<hh:align\b[^>]*\/>/, `<hh:align horizontal="LEFT" vertical="BASELINE"/>`)
                .replace(/breakLatinWord="[^"]*"/, `breakLatinWord="BREAK_WORD"`)
                .replace(/breakNonLatinWord="[^"]*"/, `breakNonLatinWord="BREAK_WORD"`),
            1800,
            -1800,
        );

        const refParaPrXml = has1050 ? "" : `<hh:paraPr id="1050" ${attrs}>${refInner}</hh:paraPr>`;

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
                    ${refParaPrXml}
                    `;

        return updatedHeader.replace(new RegExp(`</hh:paraProperties>`), `${customParaPrs}</hh:paraProperties>`);
    }

    private convertTokenToXml(token: MarkdownToken, context: BlockRenderContext, orderedPrefix?: string): string {
        const defaultParaPrId = context.inCallout ? this.paraPrIds.left : 0;

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
                const depth = typeof token.depth === "number" ? token.depth : 6;
                const hId = headingMap[depth] ?? this.styleIds.h6;
                const rawHeadingText = stripKoreanSentinels(this.reconstructTokenMarkdown(token));
                if (/참고문헌|References|미주/i.test(rawHeadingText)) {
                    this.hasExplicitReferenceHeading = true;
                }
                const headingTokens = asTokenArray(token.tokens);
                const headingRuns =
                    headingTokens.length > 0
                        ? this.renderInlineTokens(headingTokens, { baseCharPrId: hId }, context.containerWidth)
                        : this.parseInlineToRuns(rawHeadingText, hId, context.containerWidth);
                return this.createParagraphTag(headingRuns || this.createRunXml("", hId), defaultParaPrId);
            }
            case "paragraph":
                return this.renderParagraphToken(token, context);
            case "blockMath": {
                const mathText = typeof token.text === "string" ? token.text : "";
                const mathRuns = this.renderLatexMathToRuns(mathText, { baseCharPrId: 0 });
                return this.createParagraphTag(mathRuns, context.inCallout ? this.paraPrIds.left : this.paraPrIds.center);
            }
            case "hr": {
                const isPageBreak = token.ruleStyle === "pageBreak";
                if (isPageBreak) {
                    return this.createParagraphTag("<hp:run><hp:t></hp:t></hp:run>", defaultParaPrId, 1);
                }
                return this.createHorizontalRuleParagraph(context.containerWidth, defaultParaPrId);
            }
            case "list": {
                const isOrdered = Boolean(token.ordered);
                const startNum = typeof token.start === "number" ? token.start : 1;
                return asTokenArray(token.items)
                    .map((item: MarkdownToken, idx: number) =>
                        this.convertTokenToXml(item, context, isOrdered ? `${startNum + idx}.` : undefined),
                    )
                    .join("");
            }
            case "list_item": {
                const bulletByLevel = ["□", "◦", "•", "▪", "▫", "‣"];
                const paraPrByLevel = [
                    this.paraPrIds.level1,
                    this.paraPrIds.level2,
                    this.paraPrIds.level3,
                    this.paraPrIds.level4,
                    this.paraPrIds.level5,
                    this.paraPrIds.level6,
                ];
                const normalizedLevel = Math.max(0, Math.min(context.listLevel, bulletByLevel.length - 1));
                const marker = orderedPrefix ?? bulletByLevel[normalizedLevel];
                const paraPrId = paraPrByLevel[normalizedLevel] ?? this.paraPrIds.level6;

                const childTokens = asTokenArray(token.tokens);
                if (childTokens.length === 0) {
                    const itemText = this.reconstructTokenMarkdown(token);
                    return this.createParagraphTag(
                        this.parseInlineToRuns(`${marker} ${itemText}`, undefined, context.containerWidth),
                        paraPrId,
                    );
                }

                let xml = "";
                let isFirstText = true;
                for (const child of childTokens) {
                    if (child.type === "text" || child.type === "paragraph") {
                        const inlineTokens = asTokenArray(child.tokens);
                        const lineGroups =
                            inlineTokens.length > 0
                                ? splitInlineTokensIntoLines(inlineTokens, { splitBr: true, splitNewlines: true })
                                : splitInlineTokensIntoLines(
                                      lexInlineMarkdown(preprocessKoreanBoundaries(this.reconstructTokenMarkdown(child))),
                                      { splitBr: true, splitNewlines: true },
                                  );

                        const nonEmptyLines = lineGroups.filter((lineToks) =>
                            lineToks.some(
                                (t) => t.type !== "text" || stripKoreanSentinels(t.text ?? t.raw ?? "").trim().length > 0,
                            ),
                        );
                        if (nonEmptyLines.length === 0) {
                            continue;
                        }

                        for (let lineIdx = 0; lineIdx < nonEmptyLines.length; lineIdx += 1) {
                            const linePrefixXml = isFirstText && lineIdx === 0 ? this.createRunXml(`${marker} `) : "";
                            const lineRunsXml = this.renderInlineTokens(
                                nonEmptyLines[lineIdx],
                                { baseCharPrId: 0 },
                                context.containerWidth,
                            );
                            xml += this.createParagraphTag(`${linePrefixXml}${lineRunsXml}`, paraPrId);
                        }
                        isFirstText = false;
                    } else if (child.type === "list") {
                        xml += this.convertTokenToXml(child, { ...context, listLevel: context.listLevel + 1 });
                    } else if (child.type === "space") {
                        continue;
                    } else {
                        xml += this.convertTokenToXml(child, { ...context, listLevel: context.listLevel + 1 });
                    }
                }
                return xml;
            }
            case "blockquote": {
                const innerWidth = Math.max(4000, context.containerWidth - 560);
                const innerXml = this.renderBlockTokens(asTokenArray(token.tokens), {
                    containerWidth: innerWidth,
                    inCallout: true,
                    listLevel: 0,
                });
                return this.tableRenderer.renderCalloutXml(innerXml, context.containerWidth);
            }
            case "table": {
                return this.tableRenderer.renderTableToken(token, context.containerWidth);
            }
            case "image":
                return this.createImageParagraph(token, context.containerWidth);
            case "code": {
                const codeText = typeof token.text === "string" ? token.text : "";
                const lines = codeText.split(/\r?\n/);
                const codeParagraphsXml = (lines.length > 0 ? lines : [""])
                    .map((line) => this.createParagraphTag(this.createRunXml(line), this.paraPrIds.left))
                    .join("");
                return this.tableRenderer.renderCalloutXml(codeParagraphsXml, context.containerWidth);
            }
            case "space":
                return this.createParagraphTag("<hp:run><hp:t></hp:t></hp:run>", defaultParaPrId);
            default:
                if (token.raw) {
                    return this.createParagraphTag(
                        this.parseInlineToRuns(token.raw, undefined, context.containerWidth),
                        defaultParaPrId,
                    );
                }
                return "";
        }
    }

    private renderParagraphToken(token: MarkdownToken, context: BlockRenderContext): string {
        const inlineTokens = asTokenArray(token.tokens);
        const paraPrId = context.inCallout ? this.paraPrIds.left : 0;
        const makeLeadingSpace = () => (context.inCallout ? "" : this.createRunXml(" "));

        if (token.isCaption) {
            const captionXml =
                inlineTokens.length > 0
                    ? this.renderInlineTokens(inlineTokens, { baseCharPrId: this.captionStyle.charPrId }, context.containerWidth)
                    : this.parseInlineToRuns(
                          this.reconstructTokenMarkdown(token).trim(),
                          this.captionStyle.charPrId,
                          context.containerWidth,
                      );
            return this.createParagraphTag(captionXml, this.captionStyle.paraPrId, 0, this.captionStyle.styleId);
        }

        if (inlineTokens.length > 0) {
            const lineGroups = splitInlineTokensIntoLines(inlineTokens, { splitBr: true, splitNewlines: false });
            if (lineGroups.length > 1) {
                return lineGroups
                    .map((lineToks) => {
                        const hasContent = lineToks.some(
                            (t) => t.type !== "text" || stripKoreanSentinels(t.text ?? t.raw ?? "").trim().length > 0,
                        );
                        if (!hasContent) {
                            return this.createParagraphTag(this.createRunXml(""), paraPrId);
                        }
                        const lineXml = this.renderInlineTokens(lineToks, { baseCharPrId: 0 }, context.containerWidth);
                        return this.createParagraphTag(`${makeLeadingSpace()}${lineXml}`, paraPrId);
                    })
                    .join("");
            }

            const contentXml = this.renderInlineTokens(inlineTokens, { baseCharPrId: 0 }, context.containerWidth);
            if (!contentXml) {
                return this.createParagraphTag(this.createRunXml(""), paraPrId);
            }
            return this.createParagraphTag(`${makeLeadingSpace()}${contentXml}`, paraPrId);
        }

        const rawParagraph = this.reconstructTokenMarkdown(token);
        if (!rawParagraph || rawParagraph.trim() === "") {
            return this.createParagraphTag(this.createRunXml(""), paraPrId);
        }

        const contentXml = this.parseInlineToRuns(rawParagraph, undefined, context.containerWidth);
        return this.createParagraphTag(`${makeLeadingSpace()}${contentXml}`, paraPrId);
    }

    private reconstructTokenMarkdown(token: MarkdownToken): string {
        if (typeof token.text === "string" && token.text.length > 0) {
            return token.text;
        }
        if (typeof token.raw === "string" && token.raw.length > 0) {
            return token.raw;
        }
        if (Array.isArray(token.tokens) && token.tokens.length > 0) {
            return (token.tokens as MarkdownToken[])
                .map((child) => {
                    if (typeof child.raw === "string") {
                        return child.raw;
                    }
                    return this.reconstructTokenMarkdown(child);
                })
                .join("");
        }
        return "";
    }

    private createImageParagraph(token: MarkdownToken, maxWidth = this.contentWidth): string {
        const picRunXml = this.createImagePictureRun(token, maxWidth);
        return this.createParagraphTag(picRunXml, this.paraPrIds.center);
    }

    private createImagePictureRun(token: MarkdownToken, maxWidth = this.contentWidth): string {
        const altText = typeof token.text === "string" && token.text.length > 0 ? token.text : "image";
        const source = typeof token.href === "string" && token.href.length > 0 ? token.href : "inline.svg";
        const svgContent = typeof token.svgContent === "string" ? token.svgContent : undefined;
        const captionComment = source ? `[Image] ${altText} (${source})` : `[Image] ${altText}`;

        const binaryId = this.registerImageAsset(source, svgContent);
        const picId = this.generateHwpId();
        const instId = this.generateHwpId();
        const width = Math.min(this.contentWidth, Math.max(2000, maxWidth));
        const dims = this.imageAspectRatioMap.get(binaryId);
        const height = dims && dims.width > 0 ? Math.max(4000, Math.round((width * dims.height) / dims.width)) : Math.round((width * 9) / 16);
        const styleAttr = ` charPrIDRef="0"`;
        const captionXml = token.caption ? this.createCaptionXml(token.caption, token.captionSide ?? "BOTTOM", width) : "";

        return (
            `<hp:run${styleAttr}>` +
            `<hp:pic id="${picId}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${instId}" reverse="0">` +
            `<hp:offset x="0" y="0"/>` +
            `<hp:orgSz width="${width}" height="${height}"/>` +
            `<hp:curSz width="${width}" height="${height}"/>` +
            `<hp:flip horizontal="0" vertical="0"/>` +
            `<hp:rotationInfo angle="0"/>` +
            `<hp:renderingInfo>` +
            `<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
            `<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
            `<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
            `</hp:renderingInfo>` +
            `<hp:imgRect>` +
            `<hc:pt0 x="0" y="0"/>` +
            `<hc:pt1 x="${width}" y="0"/>` +
            `<hc:pt2 x="${width}" y="${height}"/>` +
            `<hc:pt3 x="0" y="${height}"/>` +
            `</hp:imgRect>` +
            `<hp:imgClip left="0" right="${width}" top="0" bottom="${height}"/>` +
            `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
            `<hp:imgDim dimwidth="${width}" dimheight="${height}"/>` +
            `<hc:img binaryItemIDRef="${binaryId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
            `<hp:effects/>` +
            `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
            `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
            `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
            captionXml +
            `<hp:shapeComment>${this.escapeXmlText(captionComment)}</hp:shapeComment>` +
            `</hp:pic>` +
            `<hp:t/>` +
            `</hp:run>`
        );
    }

    private static wasmInitialized = false;
    private static wasmInitPromise: Promise<void> | undefined = undefined;
    private static cachedFontBuffers: Uint8Array[] | undefined = undefined;
    private static crc32Table: Uint32Array | undefined = undefined;

    public static async ensureWasmInitialized(): Promise<void> {
        if (HwpxXmlRenderer.wasmInitialized) {
            return;
        }
        if (!HwpxXmlRenderer.wasmInitPromise) {
            HwpxXmlRenderer.wasmInitPromise = (async () => {
                const wasmCandidates = [
                    path.join(__dirname, "index_bg.wasm"),
                    path.resolve(__dirname, "../dist/index_bg.wasm"),
                    path.resolve(__dirname, "../node_modules/@resvg/resvg-wasm/index_bg.wasm"),
                    path.resolve(__dirname, "../../node_modules/@resvg/resvg-wasm/index_bg.wasm"),
                    path.resolve(process.cwd(), "dist/index_bg.wasm"),
                    path.resolve(process.cwd(), "node_modules/@resvg/resvg-wasm/index_bg.wasm"),
                ];
                let wasmPath: string | undefined;
                for (const candidate of wasmCandidates) {
                    if (fs.existsSync(candidate)) {
                        wasmPath = candidate;
                        break;
                    }
                }
                if (!wasmPath) {
                    throw new Error("Could not locate @resvg/resvg-wasm index_bg.wasm");
                }
                const wasmBuffer = fs.readFileSync(wasmPath);
                await initWasm(wasmBuffer);
                HwpxXmlRenderer.wasmInitialized = true;
            })();
        }
        await HwpxXmlRenderer.wasmInitPromise;
    }

    private registerImageAsset(source: string, inlineSvgContent?: string): string {
        if (inlineSvgContent) {
            const hash = crypto.createHash("sha256").update(inlineSvgContent).digest("hex").slice(0, 16);
            const dedupeKey = `svg:${hash}`;
            const existing = this.imageDedupeMap.get(dedupeKey);
            if (existing) {
                return existing;
            }

            const normalizedSvg = this.normalizeSvgString(inlineSvgContent);
            const pngBuffer = this.convertSvgToPngBuffer(normalizedSvg, 300);
            const idx = this.embeddedImages.length + 1;
            const id = `mdimg_${idx}`;
            const filename = `${id}.png`;
            this.embeddedImages.push({
                id,
                filename,
                mimeType: "image/png",
                data: pngBuffer,
            });
            this.imageAspectRatioMap.set(id, this.extractSvgDimensions(normalizedSvg));
            this.imageDedupeMap.set(dedupeKey, id);
            return id;
        }

        const resolvedFile = this.resolveImageFile(source);
        const dedupeKey = resolvedFile ? `file:${resolvedFile}` : `ref:${source}`;
        const existing = this.imageDedupeMap.get(dedupeKey);
        if (existing) {
            return existing;
        }

        const idx = this.embeddedImages.length + 1;
        const id = `mdimg_${idx}`;
        const sourceExt = path.extname(resolvedFile ?? source).toLowerCase();
        let ext = ".png";
        let mimeType = "image/png";
        let data: Buffer = FALLBACK_PNG_BUFFER;

        if (resolvedFile && fs.existsSync(resolvedFile)) {
            if (sourceExt === ".svg") {
                ext = ".png";
                mimeType = "image/png";
                const rawSvg = fs.readFileSync(resolvedFile, "utf-8");
                const normalizedSvg = this.normalizeSvgString(rawSvg);
                data = this.convertSvgToPngBuffer(normalizedSvg, 300);
                this.imageAspectRatioMap.set(id, this.extractSvgDimensions(normalizedSvg));
            } else if (sourceExt === ".jpg" || sourceExt === ".jpeg") {
                ext = ".jpg";
                mimeType = "image/jpeg";
                data = fs.readFileSync(resolvedFile);
            } else if (sourceExt === ".png") {
                data = fs.readFileSync(resolvedFile);
            } else {
                data = fs.readFileSync(resolvedFile);
            }
        } else if (sourceExt === ".svg") {
            ext = ".png";
            mimeType = "image/png";
            const placeholderSvg = this.createPlaceholderSvg(source);
            data = this.convertSvgToPngBuffer(placeholderSvg, 300);
            this.imageAspectRatioMap.set(id, { width: 800, height: 450 });
        }

        const filename = `${id}${ext}`;
        this.embeddedImages.push({
            id,
            filename,
            mimeType,
            data,
        });
        this.imageDedupeMap.set(dedupeKey, id);
        return id;
    }

    private getSystemCjkFontBuffers(): Uint8Array[] {
        if (HwpxXmlRenderer.cachedFontBuffers !== undefined) {
            return HwpxXmlRenderer.cachedFontBuffers;
        }

        const candidates = [
            // Windows (Malgun Gothic + Latin/Symbol fallback)
            "C:\\Windows\\Fonts\\malgun.ttf",
            "C:\\Windows\\Fonts\\malgunbd.ttf",
            "C:\\Windows\\Fonts\\arial.ttf",
            "C:\\Windows\\Fonts\\arialbd.ttf",
            "C:\\Windows\\Fonts\\seguisym.ttf",
            // macOS (Apple SD Gothic Neo / AppleGothic + Latin/Symbol fallback)
            "/System/Library/Fonts/AppleSDGothicNeo.ttc",
            "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Apple Symbols.ttf",
            // Linux (NanumGothic / Noto Sans CJK + DejaVu fallback)
            "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
            "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ];

        const found: Uint8Array[] = [];
        for (const fontPath of candidates) {
            if (fs.existsSync(fontPath)) {
                try {
                    found.push(new Uint8Array(fs.readFileSync(fontPath)));
                } catch {
                    // Ignore unreadable font file
                }
            }
        }

        HwpxXmlRenderer.cachedFontBuffers = found;
        return found;
    }

    private computeCrc32(buf: Buffer): number {
        if (!HwpxXmlRenderer.crc32Table) {
            const table = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let k = 0; k < 8; k++) {
                    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
                }
                table[i] = c >>> 0;
            }
            HwpxXmlRenderer.crc32Table = table;
        }
        const table = HwpxXmlRenderer.crc32Table;
        let crc = 0xffffffff;
        for (let i = 0; i < buf.length; i++) {
            crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    private injectPngDpi(pngBuf: Buffer, dpi = 300): Buffer {
        // PNG signature (8 bytes) + IHDR chunk (4 length + 4 type + 13 data + 4 crc = 25 bytes) = 33 bytes
        if (pngBuf.length < 33 || pngBuf.toString("ascii", 12, 16) !== "IHDR") {
            return pngBuf;
        }
        const ppm = Math.round(dpi / 0.0254); // 300 DPI = 11811 pixels per meter
        const physData = Buffer.alloc(9);
        physData.writeUInt32BE(ppm, 0);
        physData.writeUInt32BE(ppm, 4);
        physData.writeUInt8(1, 8); // unit: meter (1)
        const typeAndData = Buffer.concat([Buffer.from("pHYs", "ascii"), physData]);
        const crc = this.computeCrc32(typeAndData);
        const physChunk = Buffer.alloc(4 + 4 + 9 + 4);
        physChunk.writeUInt32BE(9, 0);
        typeAndData.copy(physChunk, 4);
        physChunk.writeUInt32BE(crc, 17);
        return Buffer.concat([pngBuf.subarray(0, 33), physChunk, pngBuf.subarray(33)]);
    }

    private convertSvgToPngBuffer(svgContent: string, dpi = 300): Buffer {
        try {
            const hasText = /<text\b|<tspan\b/i.test(svgContent);
            const fontBuffers = hasText ? this.getSystemCjkFontBuffers() : [];
            const defaultFont =
                process.platform === "win32"
                    ? "Malgun Gothic"
                    : process.platform === "darwin"
                      ? "Apple SD Gothic Neo"
                      : "NanumGothic";

            const resvg = new Resvg(svgContent, {
                dpi,
                fitTo: {
                    mode: "zoom",
                    value: dpi / 96.0,
                },
                background: "#ffffff",
                font: {
                    fontBuffers,
                    defaultFontFamily: defaultFont,
                    sansSerifFamily: defaultFont,
                    serifFamily: defaultFont,
                    monospaceFamily: defaultFont,
                },
            });

            const rendered = resvg.render();
            const rawPng = Buffer.from(rendered.asPng());
            rendered.free();
            resvg.free();
            return this.injectPngDpi(rawPng, dpi);
        } catch (err) {
            console.error("SVG to PNG conversion failed:", err);
            return FALLBACK_PNG_BUFFER;
        }
    }

    private resolveImageFile(source: string): string | undefined {
        if (!source || source === "inline.svg" || /^https?:\/\//i.test(source)) {
            return undefined;
        }

        const candidates = path.isAbsolute(source)
            ? [source]
            : [
                  path.resolve(this.baseDir, source),
                  path.resolve(this.baseDir, "images", path.basename(source)),
                  path.resolve(process.cwd(), source),
                  path.resolve(process.cwd(), "images", path.basename(source)),
              ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return candidate;
            }
        }
        return undefined;
    }

    private normalizeSvgString(svgContent: string): string {
        // Match the complete <svg>...</svg> root element (never stopping at child /> tags!)
        const svgMatch = svgContent.match(/<svg\b[\s\S]*<\/svg>|<svg\b[^>]*\/>/i);
        let normalizedSvg = svgMatch ? svgMatch[0] : svgContent.trim();

        // Replace HTML named entities that are not predefined in XML
        const htmlEntities: Record<string, string> = {
            nbsp: "&#160;",
            copy: "&#169;",
            reg: "&#174;",
            trade: "&#8482;",
            ndash: "&#8211;",
            mdash: "&#8212;",
            lsquo: "&#8216;",
            rsquo: "&#8217;",
            ldquo: "&#8220;",
            rdquo: "&#8221;",
            bull: "&#8226;",
            hellip: "&#8230;",
            rarr: "&#8594;",
            larr: "&#8592;",
            uarr: "&#8593;",
            darr: "&#8595;",
            harr: "&#8596;",
            rArr: "&#8658;",
            lArr: "&#8656;",
            hArr: "&#8660;",
            times: "&#215;",
            divide: "&#247;",
            plusmn: "&#177;",
            minus: "&#8722;",
            le: "&#8804;",
            ge: "&#8805;",
            ne: "&#8800;",
            asymp: "&#8776;",
            equiv: "&#8801;",
            sim: "&#8764;",
            deg: "&#176;",
            middot: "&#183;",
            alpha: "&#945;",
            beta: "&#946;",
            gamma: "&#947;",
            delta: "&#948;",
            epsilon: "&#949;",
            theta: "&#952;",
            lambda: "&#955;",
            mu: "&#956;",
            pi: "&#960;",
            sigma: "&#963;",
            tau: "&#964;",
            phi: "&#966;",
            omega: "&#969;",
            Delta: "&#916;",
            Sigma: "&#931;",
            Omega: "&#937;",
        };
        normalizedSvg = normalizedSvg.replace(/&([a-zA-Z]+);/g, (full, name: string) => {
            if (name === "amp" || name === "lt" || name === "gt" || name === "quot" || name === "apos") {
                return full;
            }
            return htmlEntities[name] ?? full;
        });

        // Escape bare ampersands (e.g. R&R, ATT&CK, Rule & Reg.) that would break XML parsing
        normalizedSvg = normalizedSvg.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");

        // Normalize SVG 2 marker orientation (orient="auto-start-reverse" -> orient="auto" + reversed marker-start clone)
        normalizedSvg = this.normalizeSvgMarkers(normalizedSvg);

        const openTagMatch = normalizedSvg.match(/^<svg\b[^>]*>/i);
        const openTag = openTagMatch ? openTagMatch[0] : "";

        if (!/\bxmlns\s*=/.test(openTag)) {
            normalizedSvg = normalizedSvg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        }

        const dims = this.extractSvgDimensions(normalizedSvg);
        if (!/\bwidth\s*=/.test(openTag)) {
            normalizedSvg = normalizedSvg.replace(/^<svg\b/i, `<svg width="${dims.width}" height="${dims.height}"`);
        }

        return normalizedSvg;
    }

    private normalizeSvgMarkers(svgContent: string): string {
        const autoStartReverseIds = new Set<string>();
        const hasMarkerStart = /\bmarker-start\s*[=:]/i.test(svgContent);

        let updated = svgContent.replace(/<marker\b([^>]*)>([\s\S]*?)<\/marker>/gi, (full, rawAttrs: string, inner: string) => {
            let attrs = rawAttrs;
            const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
            const markerId = idMatch ? idMatch[1] : undefined;
            const isAutoStartReverse = /\borient\s*=\s*["']\s*auto-start-reverse\s*["']/i.test(attrs);

            if (isAutoStartReverse) {
                attrs = attrs.replace(/\borient\s*=\s*["']\s*auto-start-reverse\s*["']/gi, 'orient="auto"');
                if (markerId && hasMarkerStart) {
                    autoStartReverseIds.add(markerId);
                    const vbMatch = attrs.match(/\bviewBox\s*=\s*["']\s*([-0-9.]+)\s+([-0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*["']/i);
                    let cx = 5;
                    let cy = 5;
                    if (vbMatch) {
                        cx = parseFloat(vbMatch[1]) + parseFloat(vbMatch[3]) / 2;
                        cy = parseFloat(vbMatch[2]) + parseFloat(vbMatch[4]) / 2;
                    } else {
                        const mwMatch = attrs.match(/\bmarkerWidth\s*=\s*["']\s*([0-9.]+)/i);
                        const mhMatch = attrs.match(/\bmarkerHeight\s*=\s*["']\s*([0-9.]+)/i);
                        const mw = mwMatch ? parseFloat(mwMatch[1]) : 10;
                        const mh = mhMatch ? parseFloat(mhMatch[1]) : 10;
                        cx = mw / 2;
                        cy = mh / 2;
                    }

                    const refXMatch = attrs.match(/\brefX\s*=\s*["']\s*([-0-9.]+)/i);
                    const refYMatch = attrs.match(/\brefY\s*=\s*["']\s*([-0-9.]+)/i);
                    const refX = refXMatch ? parseFloat(refXMatch[1]) : cx;
                    const refY = refYMatch ? parseFloat(refYMatch[1]) : cy;
                    const revRefX = 2 * cx - refX;
                    const revRefY = 2 * cy - refY;

                    let revAttrs = attrs.replace(/\bid\s*=\s*["'][^"']+["']/i, `id="${markerId}__start_rev"`);
                    if (refXMatch) {
                        revAttrs = revAttrs.replace(/\brefX\s*=\s*["'][^"']+["']/i, `refX="${revRefX}"`);
                    }
                    if (refYMatch) {
                        revAttrs = revAttrs.replace(/\brefY\s*=\s*["'][^"']+["']/i, `refY="${revRefY}"`);
                    }

                    const revMarker = `<marker${revAttrs}><g transform="rotate(180 ${cx} ${cy})">${inner}</g></marker>`;
                    return `<marker${attrs}>${inner}</marker>${revMarker}`;
                }
            } else if (!/\borient\s*=/i.test(attrs) && markerId && /arrow/i.test(markerId)) {
                attrs = `${attrs} orient="auto"`;
            }

            return `<marker${attrs}>${inner}</marker>`;
        });

        if (autoStartReverseIds.size > 0) {
            for (const markerId of autoStartReverseIds) {
                const escapedId = markerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                updated = updated.replace(
                    new RegExp(`(\\bmarker-start\\s*=\\s*["']\\s*url\\(\\s*#${escapedId})(\\s*\\)\\s*["'])`, "gi"),
                    `$1__start_rev$2`,
                );
                updated = updated.replace(
                    new RegExp(`(\\bmarker-start\\s*:\\s*url\\(\\s*['"]?#${escapedId})(['"]?\\s*\\))`, "gi"),
                    `$1__start_rev$2`,
                );
            }
        }

        return updated;
    }

    private extractSvgDimensions(svgContent: string): { width: number; height: number } {
        const viewBoxMatch = svgContent.match(/\bviewBox\s*=\s*["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)\s*["']/i);
        if (viewBoxMatch) {
            const vbW = parseFloat(viewBoxMatch[1]);
            const vbH = parseFloat(viewBoxMatch[2]);
            if (vbW > 0 && vbH > 0) {
                return { width: vbW, height: vbH };
            }
        }

        const widthMatch = svgContent.match(/\bwidth\s*=\s*["']\s*([0-9.]+)(?:px)?\s*["']/i);
        const heightMatch = svgContent.match(/\bheight\s*=\s*["']\s*([0-9.]+)(?:px)?\s*["']/i);
        if (widthMatch && heightMatch) {
            const w = parseFloat(widthMatch[1]);
            const h = parseFloat(heightMatch[1]);
            if (w > 0 && h > 0) {
                return { width: w, height: h };
            }
        }

        return { width: 800, height: 450 };
    }

    private createPlaceholderSvg(source: string): string {
        const safeLabel = this.escapeXmlText(path.basename(source));
        return (
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">` +
            `<rect width="800" height="450" fill="#f8fafc" stroke="#94a3b8" stroke-width="2" rx="8"/>` +
            `<text x="400" y="225" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="20" fill="#475569">${safeLabel}</text>` +
            `</svg>`
        );
    }

    private registerFootnoteDefinition(id: string, text: string): number {
        const normalizedId = id.trim();
        const existing = this.footnotes.find((fn) => fn.id === normalizedId);
        if (existing) {
            if (text && !existing.text) {
                existing.text = text;
            }
            return existing.index;
        }
        const index = this.footnotes.length + 1;
        this.footnotes.push({ index, id: normalizedId, text, referenced: false });
        return index;
    }

    private registerFootnoteReference(idOrHref: string, fallbackText?: string): { index: number; target: string } {
        const cleanId = idOrHref.replace(/^\^/, "").trim();
        let entry = this.footnotes.find((fn) => fn.id === cleanId || fn.text === idOrHref);
        if (!entry) {
            const index = this.footnotes.length + 1;
            entry = {
                index,
                id: cleanId,
                text: fallbackText ?? idOrHref,
                referenced: true,
            };
            this.footnotes.push(entry);
        } else {
            entry.referenced = true;
        }
        return { index: entry.index, target: entry.text || `#fn-${entry.id}` };
    }

    private registerLinkObject(href: string, type: "WEB" | "REF"): number | undefined {
        if (!href) {
            return undefined;
        }

        const existing = this.linkObjects.find((link) => link.href === href && link.type === type);
        if (existing) {
            return existing.id;
        }

        const id = this.linkObjects.length + 1;
        this.linkObjects.push({ id, href, type });
        return id;
    }

    private renderEndnotesSection(): string {
        if (this.footnotes.length === 0) {
            return "";
        }

        let xml = "";
        if (!this.hasExplicitReferenceHeading) {
            xml += this.createParagraphTag(this.parseInlineToRuns("미주", this.styleIds.h3));
        }

        for (const fn of this.footnotes) {
            const bookmarkRun = `<hp:run><hp:ctrl><hp:bookmark name="ref_${fn.index}"/></hp:ctrl></hp:run>`;
            const itemRuns = this.parseInlineToRuns(`[${fn.index}] ${fn.text}`);
            xml += this.createParagraphTag(`${bookmarkRun}${itemRuns}`, this.paraPrIds.reference);
        }
        return xml;
    }

    private wrapWithWebHyperlinkField(url: string, innerRunsXml: string): string {
        if (!url) {
            return innerRunsXml;
        }
        const fieldId = this.generateHwpId();
        const escapedCommandUrl = this.escapeXmlText(url.replace(/([:?])/g, "\\$1"));
        const escapedPathUrl = this.escapeXmlText(url);
        return (
            `<hp:run><hp:ctrl><hp:fieldBegin id="${fieldId}" type="HYPERLINK" name="" editable="0" dirty="1" zorder="-1" fieldid="627600491" metaTag="">` +
            `<hp:parameters cnt="6" name="">` +
            `<hp:integerParam name="Prop">0</hp:integerParam>` +
            `<hp:stringParam name="Command">${escapedCommandUrl};1;0;0;</hp:stringParam>` +
            `<hp:stringParam name="Path">${escapedPathUrl}</hp:stringParam>` +
            `<hp:stringParam name="Category">HWPHYPERLINK_TYPE_URL</hp:stringParam>` +
            `<hp:stringParam name="TargetType">HWPHYPERLINK_TARGET_BOOKMARK</hp:stringParam>` +
            `<hp:stringParam name="DocOpenType">HWPHYPERLINK_JUMP_NEWWTAB</hp:stringParam>` +
            `</hp:parameters>` +
            `</hp:fieldBegin></hp:ctrl></hp:run>` +
            innerRunsXml +
            `<hp:run><hp:ctrl><hp:fieldEnd beginIDRef="${fieldId}" fieldid="627600491"/></hp:ctrl></hp:run>`
        );
    }

    private wrapWithBookmarkHyperlinkField(bookmarkName: string, innerRunsXml: string): string {
        if (!bookmarkName) {
            return innerRunsXml;
        }
        const fieldId = this.generateHwpId();
        const safeBookmark = this.escapeXmlText(bookmarkName);
        return (
            `<hp:run><hp:ctrl><hp:fieldBegin id="${fieldId}" type="HYPERLINK" name="" editable="0" dirty="1" zorder="-1" fieldid="627600491" metaTag="">` +
            `<hp:parameters cnt="6" name="">` +
            `<hp:integerParam name="Prop">0</hp:integerParam>` +
            `<hp:stringParam name="Command">?${safeBookmark};0;0;0;</hp:stringParam>` +
            `<hp:stringParam name="Path">?${safeBookmark}</hp:stringParam>` +
            `<hp:stringParam name="Category">HWPHYPERLINK_TYPE_BOOKMARK</hp:stringParam>` +
            `<hp:stringParam name="TargetType">HWPHYPERLINK_TARGET_BOOKMARK</hp:stringParam>` +
            `<hp:stringParam name="DocOpenType">HWPHYPERLINK_JUMP_CURRENTTAB</hp:stringParam>` +
            `</hp:parameters>` +
            `</hp:fieldBegin></hp:ctrl></hp:run>` +
            innerRunsXml +
            `<hp:run><hp:ctrl><hp:fieldEnd beginIDRef="${fieldId}" fieldid="627600491"/></hp:ctrl></hp:run>`
        );
    }

    private getInlineRenderCallbacks(): InlineRenderCallbacks {
        return {
            resolveCharPrId: (ctx) => this.resolveCharPrId(ctx),
            createRunXml: (text, styleId) => this.createRunXml(text, styleId),
            decodeHtmlEntities: (text) => this.decodeHtmlEntities(text),
            registerLinkObject: (href, type) => this.registerLinkObject(href, type),
            wrapWithWebHyperlinkField: (url, innerRunsXml) => this.wrapWithWebHyperlinkField(url, innerRunsXml),
            wrapWithBookmarkHyperlinkField: (bookmarkName, innerRunsXml) =>
                this.wrapWithBookmarkHyperlinkField(bookmarkName, innerRunsXml),
            renderFootnoteRef: (id, ctx, fallbackText) => this.renderFootnoteRefToken(id, ctx, fallbackText),
            renderInlineImage: (token, containerWidth) => this.createImagePictureRun(token, containerWidth),
            renderInlineMath: (latex, ctx) => this.renderLatexMathToRuns(latex, ctx),
        };
    }

    private renderFootnoteRefToken(fnId: string, ctx: InlineStyleContext, fallbackText?: string): string {
        const { index, target } = this.registerFootnoteReference(fnId, fallbackText);
        this.registerLinkObject(target, "REF");
        const fnCtx: InlineStyleContext = { ...ctx, underline: true, supscript: true };
        const fnRunXml = this.createRunXml(`[${index}]`, this.resolveCharPrId(fnCtx));
        return this.wrapWithBookmarkHyperlinkField(`ref_${index}`, fnRunXml);
    }

    private renderInlineTokens(
        tokens: MarkdownToken[],
        styleContext: InlineStyleContext,
        containerWidth = this.contentWidth,
    ): string {
        return renderInlineTokensToRuns(tokens, styleContext, this.getInlineRenderCallbacks(), containerWidth);
    }

    private parseInlineToRuns(text: string, defaultStyleId?: number, containerWidth = this.contentWidth): string {
        const baseCtx: InlineStyleContext = {
            baseCharPrId: defaultStyleId ?? 0,
        };

        if (!text) {
            return this.createRunXml("", this.resolveCharPrId(baseCtx));
        }

        const inlineTokens = lexInlineMarkdown(preprocessKoreanBoundaries(text));
        const runsXml = this.renderInlineTokens(inlineTokens, baseCtx, containerWidth);
        return runsXml || this.createRunXml("", this.resolveCharPrId(baseCtx));
    }

    private renderLatexMathToRuns(mathText: string, ctx: InlineStyleContext): string {
        const normalized = this.normalizeLatexSymbols(mathText);

        // Parse ^{...}, ^x, _{...}, _x into superscript / subscript runs
        const scriptRegex = /(\^\{([^{}]+)\}|\^([+-]?[A-Za-z0-9]+)|_\{([^{}]+)\}|_([+-]?[A-Za-z0-9]+))/g;
        let lastIndex = 0;
        let xml = "";

        while (true) {
            const match = scriptRegex.exec(normalized);
            if (!match) {
                break;
            }

            if (match.index > lastIndex) {
                const plainPart = normalized.slice(lastIndex, match.index);
                xml += this.createRunXml(plainPart, this.resolveCharPrId(ctx));
            }

            const supBraced = match[2];
            const supSingle = match[3];
            const subBraced = match[4];
            const subSingle = match[5];

            if (supBraced !== undefined || supSingle !== undefined) {
                const supContent = supBraced ?? supSingle;
                const supCtx: InlineStyleContext = { ...ctx, supscript: true };
                xml += this.createRunXml(supContent, this.resolveCharPrId(supCtx));
            } else if (subBraced !== undefined || subSingle !== undefined) {
                const subContent = subBraced ?? subSingle;
                const subCtx: InlineStyleContext = { ...ctx, subscript: true };
                xml += this.createRunXml(subContent, this.resolveCharPrId(subCtx));
            }

            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < normalized.length) {
            xml += this.createRunXml(normalized.slice(lastIndex), this.resolveCharPrId(ctx));
        }

        return xml || this.createRunXml(normalized, this.resolveCharPrId(ctx));
    }

    private normalizeLatexSymbols(text: string): string {
        let normalized = text.trim();
        const replacements: Array<[RegExp, string]> = [
            [/\^\s*\{\s*\\circ\s*\}/g, "°"],
            [/\^\s*\\circ(?![A-Za-z])/g, "°"],
            [/\\circ(?![A-Za-z])/g, "°"],
            [/\\sim(?![A-Za-z])/g, "~"],
            [/\\approx(?![A-Za-z])/g, "≈"],
            [/\\equiv(?![A-Za-z])/g, "≡"],
            [/\\pm(?![A-Za-z])/g, "±"],
            [/\\mp(?![A-Za-z])/g, "∓"],
            [/\\times(?![A-Za-z])/g, "×"],
            [/\\div(?![A-Za-z])/g, "÷"],
            [/\\cdot(?![A-Za-z])/g, "·"],
            [/\\(?:le|leq)(?![A-Za-z])/g, "≤"],
            [/\\(?:ge|geq)(?![A-Za-z])/g, "≥"],
            [/\\(?:ne|neq)(?![A-Za-z])/g, "≠"],
            [/\\infty(?![A-Za-z])/g, "∞"],
            [/\\(?:rightarrow|to)(?![A-Za-z])/g, "→"],
            [/\\leftarrow(?![A-Za-z])/g, "←"],
            [/\\leftrightarrow(?![A-Za-z])/g, "↔"],
            [/\\Rightarrow(?![A-Za-z])/g, "⇒"],
            [/\\Leftrightarrow(?![A-Za-z])/g, "⇔"],
            [/\\alpha(?![A-Za-z])/g, "α"],
            [/\\beta(?![A-Za-z])/g, "β"],
            [/\\gamma(?![A-Za-z])/g, "γ"],
            [/\\delta(?![A-Za-z])/g, "δ"],
            [/\\(?:epsilon|varepsilon)(?![A-Za-z])/g, "ε"],
            [/\\zeta(?![A-Za-z])/g, "ζ"],
            [/\\eta(?![A-Za-z])/g, "η"],
            [/\\theta(?![A-Za-z])/g, "θ"],
            [/\\iota(?![A-Za-z])/g, "ι"],
            [/\\kappa(?![A-Za-z])/g, "κ"],
            [/\\lambda(?![A-Za-z])/g, "λ"],
            [/\\mu(?![A-Za-z])/g, "μ"],
            [/\\nu(?![A-Za-z])/g, "ν"],
            [/\\xi(?![A-Za-z])/g, "ξ"],
            [/\\pi(?![A-Za-z])/g, "π"],
            [/\\rho(?![A-Za-z])/g, "ρ"],
            [/\\sigma(?![A-Za-z])/g, "σ"],
            [/\\tau(?![A-Za-z])/g, "τ"],
            [/\\upsilon(?![A-Za-z])/g, "υ"],
            [/\\(?:phi|varphi)(?![A-Za-z])/g, "φ"],
            [/\\chi(?![A-Za-z])/g, "χ"],
            [/\\psi(?![A-Za-z])/g, "ψ"],
            [/\\omega(?![A-Za-z])/g, "ω"],
            [/\\Gamma(?![A-Za-z])/g, "Γ"],
            [/\\Delta(?![A-Za-z])/g, "Δ"],
            [/\\Theta(?![A-Za-z])/g, "Θ"],
            [/\\Lambda(?![A-Za-z])/g, "Λ"],
            [/\\Xi(?![A-Za-z])/g, "Ξ"],
            [/\\Pi(?![A-Za-z])/g, "Π"],
            [/\\Sigma(?![A-Za-z])/g, "Σ"],
            [/\\Phi(?![A-Za-z])/g, "Φ"],
            [/\\Psi(?![A-Za-z])/g, "Ψ"],
            [/\\Omega(?![A-Za-z])/g, "Ω"],
            [/\\(?:text|mathrm|mathbf|mathit|mathsf)\s*\{([^{}]*)\}/g, "$1"],
            [/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1/$2)"],
            [/\\left\s*/g, ""],
            [/\\right\s*/g, ""],
            [/\\%/g, "%"],
            [/\\_/g, "_"],
            [/\\&/g, "&"],
            [/\\#/g, "#"],
            [/\{\}/g, ""],
        ];

        for (const [pattern, replacement] of replacements) {
            normalized = normalized.replace(pattern, replacement);
        }

        return normalized;
    }

    private createRunXml(text: string, styleId?: number): string {
        const attr = styleId ? ` charPrIDRef="${styleId}"` : "";
        return `<hp:run${attr}><hp:t>${this.escapeXmlText(text)}</hp:t></hp:run>`;
    }

    private escapeXmlText(text: string): string {
        return stripKoreanSentinels(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    private createCaptionXml(captionText: string, side: "TOP" | "BOTTOM", width: number): string {
        const subListId = this.generateHwpId();
        const runsXml = this.parseInlineToRuns(captionText.trim(), this.captionStyle.charPrId);
        const paragraphXml = this.createParagraphTag(runsXml, this.captionStyle.paraPrId, 0, this.captionStyle.styleId);
        return (
            `<hp:caption side="${side}" fullSz="0" width="${width}" gap="850" lastWidth="${width}">` +
            `<hp:subList id="${subListId}" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
            paragraphXml +
            `</hp:subList>` +
            `</hp:caption>`
        );
    }

    private decodeHtmlEntities(text: string): string {
        return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|nbsp|amp|lt|gt|quot|apos);/g, (full, entity) => {
            const normalizedEntity = String(entity).toLowerCase();
            if (normalizedEntity === "nbsp") {
                return " ";
            }
            if (normalizedEntity === "amp") {
                return "&";
            }
            if (normalizedEntity === "lt") {
                return "<";
            }
            if (normalizedEntity === "gt") {
                return ">";
            }
            if (normalizedEntity === "quot") {
                return '"';
            }
            if (normalizedEntity === "apos") {
                return "'";
            }
            if (normalizedEntity.startsWith("#x")) {
                const codePoint = parseInt(normalizedEntity.slice(2), 16);
                return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : full;
            }
            if (normalizedEntity.startsWith("#")) {
                const codePoint = parseInt(normalizedEntity.slice(1), 10);
                return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : full;
            }
            return full;
        });
    }
}
