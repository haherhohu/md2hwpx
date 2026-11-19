import { EmbeddedImageItem, FootnoteDefinition, InlineStyleContext, MarkdownToken } from "./types";
import { asTokenArray, hasVisibleInlineContent } from "./tokenUtils";
import { escapeXmlText, HwpxLayout, HwpxStyles } from "./hwpxConstants";
import { lexInlineMarkdown } from "./pipeline/markdownExtensions";
import { preprocessKoreanBoundaries, stripKoreanSentinels } from "./pipeline/koreanPreprocessor";
import { InlineRenderCallbacks, renderInlineTokensToRuns, splitInlineTokensIntoLines } from "./renderers/inlineRenderer";
import { TableRenderer } from "./renderers/tableRenderer";
import { ImageRenderer } from "./renderers/imageRenderer";
import { StyleRegistry } from "./renderers/styleRegistry";
import { convertLatexToHwpScript } from "./math/latexToHwpEqn";

interface BlockRenderContext {
    containerWidth: number;
    inCallout: boolean;
    listLevel: number;
}

export class HwpxXmlRenderer {
    private readonly styleRegistry = new StyleRegistry();

    private contentWidth: number = HwpxLayout.DEFAULT_CONTENT_WIDTH;
    private currentElementId = 1000000000;

    private footnotes: Array<{ index: number; id: string; text: string; referenced: boolean }> = [];
    private hasExplicitReferenceHeading = false;
    private readonly baseDir: string;
    private readonly tableRenderer: TableRenderer;
    private readonly imageRenderer: ImageRenderer;

    public constructor(baseDir: string = process.cwd()) {
        this.baseDir = baseDir;
        this.imageRenderer = new ImageRenderer(this.baseDir, {
            generateHwpId: () => this.generateHwpId(),
            getContentWidth: () => this.contentWidth,
            getCenterParaPrId: () => this.styleRegistry.paraPrIds.center,
            createParagraphTag: (runXml, paraPrId, pageBreak, styleId) =>
                this.createParagraphTag(runXml, paraPrId, pageBreak, styleId),
            createCaptionXml: (captionText, side, width) => this.createCaptionXml(captionText, side, width),
        });
        this.tableRenderer = new TableRenderer({
            generateHwpId: () => this.generateHwpId(),
            getParaPrIds: () => ({
                center: this.styleRegistry.paraPrIds.center,
                left: this.styleRegistry.paraPrIds.left,
                right: this.styleRegistry.paraPrIds.right,
            }),
            getStyleIds: () => ({ bold: this.styleRegistry.styleIds.bold }),
            getBorderFillIds: () => this.styleRegistry.borderFillIds,
            createParagraphTag: (runXml, paraPrId, pageBreak, styleId) =>
                this.createParagraphTag(runXml, paraPrId, pageBreak, styleId),
            createRunXml: (text, styleId) => this.createRunXml(text, styleId),
            createCaptionXml: (captionText, side, width) => this.createCaptionXml(captionText, side, width),
            renderInlineTokens: (tokens, ctx, containerWidth) => this.renderInlineTokens(tokens, ctx, containerWidth),
        });
    }

    public setContentWidth(width: number): void {
        if (Number.isFinite(width) && width > HwpxLayout.MIN_CONTENT_WIDTH) {
            this.contentWidth = Math.floor(width);
        }
    }

    public getEmbeddedImages(): EmbeddedImageItem[] {
        return this.imageRenderer.getEmbeddedImages();
    }

    private generateHwpId(): number {
        return this.currentElementId++;
    }

    public prepareHeaderXml(headerXml: string): string {
        return this.styleRegistry.prepareHeaderXml(headerXml);
    }

    public renderTokens(tokens: MarkdownToken[]): string {
        this.footnotes = [];
        this.imageRenderer.reset();
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
        const content = this.renderBlockTokens(contentTokens, {
            containerWidth: this.contentWidth,
            inCallout: false,
            listLevel: 0,
        });
        return content + this.renderEndnotesSection();
    }

    public finalizeHeaderXml(headerXml: string): string {
        return this.styleRegistry.finalizeHeaderXml(headerXml);
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
            `<hp:lineShape color="${HwpxStyles.BORDER_COLOR}" width="${HwpxLayout.HR_LINE_WIDTH}" style="SOLID" endCap="FLAT" headStyle="NORMAL" tailStyle="NORMAL" headfill="0" tailfill="0" headSz="SMALL_SMALL" tailSz="SMALL_SMALL" outlineStyle="NORMAL" alpha="0"/>` +
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

    private convertTokenToXml(token: MarkdownToken, context: BlockRenderContext, orderedPrefix?: string): string {
        const defaultParaPrId = context.inCallout ? this.styleRegistry.paraPrIds.left : 0;

        switch (token.type) {
            case "heading": {
                const styleIds = this.styleRegistry.styleIds;
                const headingMap: Record<number, number> = {
                    1: styleIds.h1,
                    2: styleIds.h2,
                    3: styleIds.h3,
                    4: styleIds.h4,
                    5: styleIds.h5,
                    6: styleIds.h6,
                };
                const depth = typeof token.depth === "number" ? token.depth : 6;
                const hId = headingMap[depth] ?? styleIds.h6;
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
                const eqRun = this.createEquationRun(mathText, true);
                return this.createParagraphTag(
                    eqRun,
                    context.inCallout ? this.styleRegistry.paraPrIds.left : this.styleRegistry.paraPrIds.center,
                );
            }
            case "hr": {
                const isPageBreak = token.ruleStyle === "pageBreak";
                if (isPageBreak) {
                    return this.createParagraphTag(this.createRunXml(""), defaultParaPrId, 1);
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
                const bullets = HwpxStyles.LIST_BULLETS;
                const paraPrIds = this.styleRegistry.paraPrIds;
                const paraPrByLevel = [
                    paraPrIds.level1,
                    paraPrIds.level2,
                    paraPrIds.level3,
                    paraPrIds.level4,
                    paraPrIds.level5,
                    paraPrIds.level6,
                ];
                const normalizedLevel = Math.max(0, Math.min(context.listLevel, bullets.length - 1));
                const marker = orderedPrefix ?? bullets[normalizedLevel];
                const paraPrId = paraPrByLevel[normalizedLevel] ?? paraPrIds.level6;

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

                        const nonEmptyLines = lineGroups.filter(hasVisibleInlineContent);
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
                const innerWidth = Math.max(4000, context.containerWidth - HwpxLayout.CALLOUT_PADDING_X);
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
                return this.imageRenderer.createImageParagraph(token, context.containerWidth);
            case "code": {
                const codeText = typeof token.text === "string" ? token.text : "";
                const lines = codeText.split(/\r?\n/);
                const codeParagraphsXml = (lines.length > 0 ? lines : [""])
                    .map((line) => this.createParagraphTag(this.createRunXml(line), this.styleRegistry.paraPrIds.left))
                    .join("");
                return this.tableRenderer.renderCalloutXml(codeParagraphsXml, context.containerWidth);
            }
            case "space":
                return this.createParagraphTag(this.createRunXml(""), defaultParaPrId);
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
        const paraPrId = context.inCallout ? this.styleRegistry.paraPrIds.left : 0;
        const makeLeadingSpace = () => (context.inCallout ? "" : this.createRunXml(" "));

        if (token.isCaption) {
            const captionStyle = this.styleRegistry.captionStyle;
            const captionXml =
                inlineTokens.length > 0
                    ? this.renderInlineTokens(inlineTokens, { baseCharPrId: captionStyle.charPrId }, context.containerWidth)
                    : this.parseInlineToRuns(
                          this.reconstructTokenMarkdown(token).trim(),
                          captionStyle.charPrId,
                          context.containerWidth,
                      );
            return this.createParagraphTag(captionXml, captionStyle.paraPrId, 0, captionStyle.styleId);
        }

        if (inlineTokens.length > 0) {
            const lineGroups = splitInlineTokensIntoLines(inlineTokens, { splitBr: true, splitNewlines: false });
            if (lineGroups.length > 1) {
                return lineGroups
                    .map((lineToks) => {
                        if (!hasVisibleInlineContent(lineToks)) {
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

    public static async ensureWasmInitialized(): Promise<void> {
        await ImageRenderer.ensureWasmInitialized();
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

    private registerFootnoteReference(idOrHref: string, fallbackText?: string): number {
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
        return entry.index;
    }

    private renderEndnotesSection(): string {
        if (this.footnotes.length === 0) {
            return "";
        }

        let xml = "";
        if (!this.hasExplicitReferenceHeading) {
            xml += this.createParagraphTag(this.parseInlineToRuns("미주", this.styleRegistry.styleIds.h3));
        }

        for (const fn of this.footnotes) {
            const bookmarkRun = `<hp:run charPrIDRef="0"><hp:ctrl><hp:bookmark name="ref_${fn.index}"/></hp:ctrl></hp:run>`;
            const indexTabRun = `<hp:run charPrIDRef="0"><hp:t>[${fn.index}]<hp:tab width="${HwpxStyles.ENDNOTE_TAB_WIDTH}" leader="0" type="0"/></hp:t></hp:run>`;
            const fnTokens = lexInlineMarkdown(preprocessKoreanBoundaries(fn.text));
            const bodyRuns = this.renderInlineTokens(fnTokens, { baseCharPrId: 0 });
            xml += this.createParagraphTag(`${bookmarkRun}${indexTabRun}${bodyRuns}`, this.styleRegistry.paraPrIds.reference);
        }
        return xml;
    }

    private wrapWithHyperlinkField(
        command: string,
        pathValue: string,
        category: "HWPHYPERLINK_TYPE_URL" | "HWPHYPERLINK_TYPE_BOOKMARK",
        docOpenType: "HWPHYPERLINK_JUMP_NEWWTAB" | "HWPHYPERLINK_JUMP_CURRENTTAB",
        innerRunsXml: string,
    ): string {
        const fieldId = this.generateHwpId();
        return (
            `<hp:run><hp:ctrl><hp:fieldBegin id="${fieldId}" type="HYPERLINK" name="" editable="0" dirty="1" zorder="-1" fieldid="${HwpxStyles.HYPERLINK_FIELD_ID}" metaTag="">` +
            `<hp:parameters cnt="6" name="">` +
            `<hp:integerParam name="Prop">0</hp:integerParam>` +
            `<hp:stringParam name="Command">${command}</hp:stringParam>` +
            `<hp:stringParam name="Path">${pathValue}</hp:stringParam>` +
            `<hp:stringParam name="Category">${category}</hp:stringParam>` +
            `<hp:stringParam name="TargetType">HWPHYPERLINK_TARGET_BOOKMARK</hp:stringParam>` +
            `<hp:stringParam name="DocOpenType">${docOpenType}</hp:stringParam>` +
            `</hp:parameters>` +
            `</hp:fieldBegin></hp:ctrl></hp:run>` +
            innerRunsXml +
            `<hp:run><hp:ctrl><hp:fieldEnd beginIDRef="${fieldId}" fieldid="${HwpxStyles.HYPERLINK_FIELD_ID}"/></hp:ctrl></hp:run>`
        );
    }

    private wrapWithWebHyperlinkField(url: string, innerRunsXml: string): string {
        if (!url) {
            return innerRunsXml;
        }
        const escapedCommandUrl = escapeXmlText(url.replace(/([:?])/g, "\\$1"));
        const escapedPathUrl = escapeXmlText(url);
        return this.wrapWithHyperlinkField(
            `${escapedCommandUrl};1;0;0;`,
            escapedPathUrl,
            "HWPHYPERLINK_TYPE_URL",
            "HWPHYPERLINK_JUMP_NEWWTAB",
            innerRunsXml,
        );
    }

    private wrapWithBookmarkHyperlinkField(bookmarkName: string, innerRunsXml: string): string {
        if (!bookmarkName) {
            return innerRunsXml;
        }
        const safeBookmark = escapeXmlText(bookmarkName);
        return this.wrapWithHyperlinkField(
            `?${safeBookmark};0;0;0;`,
            `?${safeBookmark}`,
            "HWPHYPERLINK_TYPE_BOOKMARK",
            "HWPHYPERLINK_JUMP_CURRENTTAB",
            innerRunsXml,
        );
    }

    private getInlineRenderCallbacks(): InlineRenderCallbacks {
        return {
            resolveCharPrId: (ctx) => this.styleRegistry.resolveCharPrId(ctx),
            createRunXml: (text, styleId) => this.createRunXml(text, styleId),
            wrapWithWebHyperlinkField: (url, innerRunsXml) => this.wrapWithWebHyperlinkField(url, innerRunsXml),
            wrapWithBookmarkHyperlinkField: (bookmarkName, innerRunsXml) =>
                this.wrapWithBookmarkHyperlinkField(bookmarkName, innerRunsXml),
            renderFootnoteRef: (id, ctx, fallbackText) => this.renderFootnoteRefToken(id, ctx, fallbackText),
            renderInlineImage: (token, containerWidth) => this.imageRenderer.createImagePictureRun(token, containerWidth),
            renderInlineMath: (latex, ctx) => this.createEquationRun(latex, false, ctx),
        };
    }

    private renderFootnoteRefToken(fnId: string, ctx: InlineStyleContext, fallbackText?: string): string {
        const index = this.registerFootnoteReference(fnId, fallbackText);
        const fnCtx: InlineStyleContext = { ...ctx, underline: true, supscript: true };
        const fnRunXml = this.createRunXml(`[${index}]`, this.styleRegistry.resolveCharPrId(fnCtx));
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
            return this.createRunXml("", this.styleRegistry.resolveCharPrId(baseCtx));
        }

        const inlineTokens = lexInlineMarkdown(preprocessKoreanBoundaries(text));
        const runsXml = this.renderInlineTokens(inlineTokens, baseCtx, containerWidth);
        return runsXml || this.createRunXml("", this.styleRegistry.resolveCharPrId(baseCtx));
    }

    private createEquationRun(latex: string, isBlock: boolean, ctx?: InlineStyleContext): string {
        const script = convertLatexToHwpScript(latex);
        const eqId = this.generateHwpId();
        const baseUnit = isBlock ? 1100 : 1000;
        const hasFractionOrBigOp = /\b(?:over|root|sum|int|dint|tint|oint|prod|cases)\b/.test(script);
        const hasMatrix = /\bmatrix\b/.test(script);
        const rowCount = (script.match(/#/g) ?? []).length + 1;

        const baseHeight = hasMatrix ? 1400 * rowCount : hasFractionOrBigOp ? 2200 : 1100;
        const height = isBlock ? Math.max(1400, baseHeight) : baseHeight;
        const estimatedWidth = Math.min(
            this.contentWidth,
            Math.max(1200, Math.round(script.length * (isBlock ? 480 : 420))),
        );
        const baseLine = hasFractionOrBigOp || hasMatrix ? 72 : 85;

        const charPrId = ctx ? this.styleRegistry.resolveCharPrId(ctx) : undefined;
        const charPrAttr = charPrId ? ` charPrIDRef="${charPrId}"` : ` charPrIDRef="0"`;
        const escapedScript = escapeXmlText(script);
        const escapedComment = escapeXmlText(latex.trim());

        return (
            `<hp:run${charPrAttr}>` +
            `<hp:equation id="${eqId}" zOrder="0" numberingType="EQUATION" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" version="${HwpxStyles.EQUATION_VERSION}" baseLine="${baseLine}" textColor="${HwpxStyles.BORDER_COLOR}" baseUnit="${baseUnit}" lineMode="CHAR" font="${HwpxStyles.EQUATION_FONT}">` +
            `<hp:sz width="${estimatedWidth}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
            `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
            `<hp:outMargin left="56" right="56" top="0" bottom="0"/>` +
            `<hp:shapeComment>${escapedComment}</hp:shapeComment>` +
            `<hp:script>${escapedScript}</hp:script>` +
            `</hp:equation>` +
            `<hp:t/>` +
            `</hp:run>`
        );
    }

    private createRunXml(text: string, styleId?: number): string {
        const attr = styleId ? ` charPrIDRef="${styleId}"` : "";
        return `<hp:run${attr}><hp:t>${escapeXmlText(text)}</hp:t></hp:run>`;
    }

    private createCaptionXml(captionText: string, side: "TOP" | "BOTTOM", width: number): string {
        const subListId = this.generateHwpId();
        const captionStyle = this.styleRegistry.captionStyle;
        const runsXml = this.parseInlineToRuns(captionText.trim(), captionStyle.charPrId);
        const paragraphXml = this.createParagraphTag(runsXml, captionStyle.paraPrId, 0, captionStyle.styleId);
        return (
            `<hp:caption side="${side}" fullSz="0" width="${width}" gap="${HwpxLayout.CAPTION_GAP}" lastWidth="${width}">` +
            `<hp:subList id="${subListId}" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
            paragraphXml +
            `</hp:subList>` +
            `</hp:caption>`
        );
    }
}
