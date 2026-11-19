import { InlineStyleContext, MarkdownToken } from "../types";
import { asTokenArray, getTokenText } from "../tokenUtils";
import { decodeHtmlEntities } from "../hwpxConstants";
import { stripKoreanSentinels } from "../pipeline/koreanPreprocessor";

export interface InlineRenderCallbacks {
    resolveCharPrId: (ctx: InlineStyleContext) => number | undefined;
    createRunXml: (text: string, styleId?: number) => string;
    wrapWithWebHyperlinkField: (url: string, innerRunsXml: string) => string;
    wrapWithBookmarkHyperlinkField: (bookmarkName: string, innerRunsXml: string) => string;
    renderFootnoteRef: (id: string, ctx: InlineStyleContext, fallbackText?: string) => string;
    renderInlineImage: (token: MarkdownToken, containerWidth: number) => string;
    renderInlineMath: (latex: string, ctx: InlineStyleContext) => string;
}

interface HtmlTagState {
    bDepth: number;
    iDepth: number;
    uDepth: number;
    sDepth: number;
    supDepth: number;
    subDepth: number;
}

const INLINE_HTML_WRAPPER_MAP: Record<string, string> = {
    b: "b",
    strong: "strong",
    i: "i",
    em: "em",
    u: "u",
    del: "del",
    s: "s",
    strike: "strike",
    sup: "sup",
    sub: "sub",
};

function parseHtmlTagName(rawHtml: string): { closing: boolean; tagName: string } | undefined {
    const match = rawHtml.trim().match(/^<(\/?)\s*([A-Za-z][A-Za-z0-9-]*)(?:\s+[^>]*)?\s*(\/?)>$/);
    if (!match || match[3] === "/") {
        return undefined;
    }
    return {
        closing: match[1] === "/",
        tagName: match[2].toLowerCase(),
    };
}

function isBrHtmlToken(token: MarkdownToken): boolean {
    if (token.type !== "html") {
        return false;
    }
    const raw = (token.raw ?? token.text ?? "").trim();
    return /^<\/?br\s*\/?>$/i.test(raw);
}

/**
 * Splits an inline AST token array into line-level token arrays at `<br>` / `br`
 * (and optionally `\n`), preserving active wrapper formatting (`strong`, `em`,
 * `del`, `link`, and inline HTML tags) across split lines.
 */
export function splitInlineTokensIntoLines(
    tokens: MarkdownToken[],
    options: { splitBr: boolean; splitNewlines: boolean; splitExplicitBackslash?: boolean },
): MarkdownToken[][] {
    const lines: MarkdownToken[][] = [[]];
    const openHtmlStack: string[] = [];

    const startNewLine = () => {
        for (let i = openHtmlStack.length - 1; i >= 0; i -= 1) {
            const tag = openHtmlStack[i];
            lines[lines.length - 1].push({ type: "html", raw: `</${tag}>`, text: `</${tag}>` });
        }
        lines.push([]);
        for (const tag of openHtmlStack) {
            lines[lines.length - 1].push({ type: "html", raw: `<${tag}>`, text: `<${tag}>` });
        }
    };

    for (const token of tokens) {
        if (options.splitBr && token.type === "br") {
            startNewLine();
            continue;
        }

        if (options.splitBr && isBrHtmlToken(token)) {
            startNewLine();
            continue;
        }

        if (options.splitExplicitBackslash && token.type === "escape" && token.raw === "\\\\") {
            startNewLine();
            continue;
        }

        if (token.type === "html") {
            const parsedTag = parseHtmlTagName(token.raw ?? token.text ?? "");
            if (parsedTag && INLINE_HTML_WRAPPER_MAP[parsedTag.tagName]) {
                if (!parsedTag.closing) {
                    openHtmlStack.push(parsedTag.tagName);
                } else {
                    const lastIdx = openHtmlStack.lastIndexOf(parsedTag.tagName);
                    if (lastIdx !== -1) {
                        openHtmlStack.splice(lastIdx, 1);
                    }
                }
            }
            lines[lines.length - 1].push(token);
            continue;
        }

        const nestedTokens = asTokenArray(token.tokens);
        if (
            nestedTokens.length > 0 &&
            (token.type === "strong" || token.type === "em" || token.type === "del" || token.type === "link" || token.type === "text")
        ) {
            const subLines = splitInlineTokensIntoLines(nestedTokens, options);
            if (subLines.length === 1) {
                lines[lines.length - 1].push({ ...token, tokens: subLines[0] });
            } else {
                for (let idx = 0; idx < subLines.length; idx += 1) {
                    if (idx > 0) {
                        startNewLine();
                    }
                    if (subLines[idx].length > 0) {
                        lines[lines.length - 1].push({ ...token, tokens: subLines[idx] });
                    }
                }
            }
            continue;
        }

        if (token.type === "text" && (options.splitNewlines || options.splitExplicitBackslash)) {
            const textStr = getTokenText(token);
            const splitRegex =
                options.splitNewlines && options.splitExplicitBackslash
                    ? /\r?\n|\\\\/
                    : options.splitNewlines
                      ? /\r?\n/
                      : /\\\\/;
            if (splitRegex.test(textStr)) {
                const parts = textStr.split(splitRegex);
                for (let idx = 0; idx < parts.length; idx += 1) {
                    if (idx > 0) {
                        startNewLine();
                    }
                    if (parts[idx].length > 0) {
                        lines[lines.length - 1].push({ type: "text", raw: parts[idx], text: parts[idx] });
                    }
                }
                continue;
            }
        }

        lines[lines.length - 1].push(token);
    }

    return lines;
}

function applyHtmlTagState(baseCtx: InlineStyleContext, state: HtmlTagState): InlineStyleContext {
    return {
        ...baseCtx,
        bold: Boolean(baseCtx.bold || state.bDepth > 0),
        italic: Boolean(baseCtx.italic || state.iDepth > 0),
        underline: Boolean(baseCtx.underline || state.uDepth > 0),
        strike: Boolean(baseCtx.strike || state.sDepth > 0),
        supscript: Boolean(baseCtx.supscript || state.supDepth > 0),
        subscript: Boolean(baseCtx.subscript || state.subDepth > 0),
    };
}

function renderPlainTextWithRawUrls(
    rawText: string,
    ctx: InlineStyleContext,
    callbacks: InlineRenderCallbacks,
): string {
    const text = stripKoreanSentinels(decodeHtmlEntities(rawText));
    if (!text) {
        return "";
    }

    if (ctx.inLink || !/https?:\/\//i.test(text)) {
        return callbacks.createRunXml(text, callbacks.resolveCharPrId(ctx));
    }

    const urlRegex = /https?:\/\/[^\s)\]>]+/g;
    let lastIndex = 0;
    let xml = "";

    for (const match of text.matchAll(urlRegex)) {
        const matchIndex = match.index ?? 0;
        if (matchIndex > lastIndex) {
            xml += callbacks.createRunXml(text.slice(lastIndex, matchIndex), callbacks.resolveCharPrId(ctx));
        }
        let cleanUrl = match[0];
        let trailing = "";
        const trailingMatch = cleanUrl.match(/([.,;]+)$/);
        if (trailingMatch) {
            trailing = trailingMatch[1];
            cleanUrl = cleanUrl.slice(0, -trailing.length);
        }

        const linkCtx: InlineStyleContext = { ...ctx, underline: true };
        const linkRun = callbacks.createRunXml(cleanUrl, callbacks.resolveCharPrId(linkCtx));
        xml += callbacks.wrapWithWebHyperlinkField(cleanUrl, linkRun);
        if (trailing) {
            xml += callbacks.createRunXml(trailing, callbacks.resolveCharPrId(ctx));
        }

        lastIndex = matchIndex + match[0].length;
    }

    if (lastIndex < text.length) {
        xml += callbacks.createRunXml(text.slice(lastIndex), callbacks.resolveCharPrId(ctx));
    }

    return xml;
}

/**
 * Recursively traverses `marked` inline AST tokens and generates HWPX `<hp:run>` XML.
 */
export function renderInlineTokensToRuns(
    tokens: MarkdownToken[],
    styleContext: InlineStyleContext,
    callbacks: InlineRenderCallbacks,
    containerWidth: number,
): string {
    const htmlState: HtmlTagState = {
        bDepth: 0,
        iDepth: 0,
        uDepth: 0,
        sDepth: 0,
        supDepth: 0,
        subDepth: 0,
    };

    let xml = "";

    for (const token of tokens) {
        if (!token || typeof token !== "object") {
            continue;
        }
        const activeCtx = applyHtmlTagState(styleContext, htmlState);

        switch (token.type) {
            case "text": {
                const nested = asTokenArray(token.tokens);
                if (nested.length > 0) {
                    xml += renderInlineTokensToRuns(nested, activeCtx, callbacks, containerWidth);
                } else {
                    const value = getTokenText(token);
                    xml += renderPlainTextWithRawUrls(value, activeCtx, callbacks);
                }
                break;
            }
            case "escape": {
                if (token.raw === "\\*") {
                    xml += callbacks.createRunXml("※", callbacks.resolveCharPrId(activeCtx));
                } else {
                    const value = stripKoreanSentinels(decodeHtmlEntities(token.text ?? ""));
                    if (value) {
                        xml += callbacks.createRunXml(value, callbacks.resolveCharPrId(activeCtx));
                    }
                }
                break;
            }
            case "strong": {
                const children = asTokenArray(token.tokens);
                if (children.length > 0) {
                    xml += renderInlineTokensToRuns(children, { ...activeCtx, bold: true }, callbacks, containerWidth);
                } else if (typeof token.text === "string") {
                    xml += renderPlainTextWithRawUrls(token.text, { ...activeCtx, bold: true }, callbacks);
                }
                break;
            }
            case "em": {
                const children = asTokenArray(token.tokens);
                if (children.length > 0) {
                    xml += renderInlineTokensToRuns(children, { ...activeCtx, italic: true }, callbacks, containerWidth);
                } else if (typeof token.text === "string") {
                    xml += renderPlainTextWithRawUrls(token.text, { ...activeCtx, italic: true }, callbacks);
                }
                break;
            }
            case "del": {
                const children = asTokenArray(token.tokens);
                if (children.length > 0) {
                    xml += renderInlineTokensToRuns(children, { ...activeCtx, strike: true }, callbacks, containerWidth);
                } else if (typeof token.text === "string") {
                    xml += renderPlainTextWithRawUrls(token.text, { ...activeCtx, strike: true }, callbacks);
                }
                break;
            }
            case "codespan": {
                const codeText = stripKoreanSentinels(decodeHtmlEntities(token.text ?? ""));
                xml += callbacks.createRunXml(codeText, callbacks.resolveCharPrId(activeCtx));
                break;
            }
            case "link": {
                const href = typeof token.href === "string" ? token.href.trim() : "";
                const rawLabel = typeof token.text === "string" ? token.text.trim() : "";

                if (rawLabel.startsWith("^") && href) {
                    xml += callbacks.renderFootnoteRef(rawLabel.slice(1), activeCtx, href);
                    break;
                }

                const linkChildren = asTokenArray(token.tokens);
                const effectiveChildren =
                    linkChildren.length > 0
                        ? linkChildren
                        : [{ type: "text", text: href && (!rawLabel || rawLabel === href) ? href : rawLabel || href }];

                const innerRuns = renderInlineTokensToRuns(
                    effectiveChildren,
                    { ...activeCtx, underline: true, inLink: true },
                    callbacks,
                    containerWidth,
                );

                if (/^https?:\/\//i.test(href)) {
                    xml += callbacks.wrapWithWebHyperlinkField(href, innerRuns);
                } else if (href.startsWith("#")) {
                    xml += callbacks.wrapWithBookmarkHyperlinkField(href.slice(1), innerRuns);
                } else {
                    xml += innerRuns;
                }
                break;
            }
            case "image": {
                xml += callbacks.renderInlineImage(token, containerWidth);
                break;
            }
            case "footnoteRef": {
                const fnId = typeof token.id === "string" ? token.id : typeof token.text === "string" ? token.text : "";
                xml += callbacks.renderFootnoteRef(fnId, activeCtx);
                break;
            }
            case "inlineMath": {
                const latex = typeof token.text === "string" ? token.text : "";
                xml += callbacks.renderInlineMath(latex, activeCtx);
                break;
            }
            case "br": {
                xml += callbacks.createRunXml("\n", callbacks.resolveCharPrId(activeCtx));
                break;
            }
            case "html": {
                if (isBrHtmlToken(token)) {
                    xml += callbacks.createRunXml("\n", callbacks.resolveCharPrId(activeCtx));
                    break;
                }
                const parsedTag = parseHtmlTagName(token.raw ?? token.text ?? "");
                if (parsedTag) {
                    const delta = parsedTag.closing ? -1 : 1;
                    switch (parsedTag.tagName) {
                        case "b":
                        case "strong":
                            htmlState.bDepth = Math.max(0, htmlState.bDepth + delta);
                            break;
                        case "i":
                        case "em":
                            htmlState.iDepth = Math.max(0, htmlState.iDepth + delta);
                            break;
                        case "u":
                            htmlState.uDepth = Math.max(0, htmlState.uDepth + delta);
                            break;
                        case "del":
                        case "s":
                        case "strike":
                            htmlState.sDepth = Math.max(0, htmlState.sDepth + delta);
                            break;
                        case "sup":
                            htmlState.supDepth = Math.max(0, htmlState.supDepth + delta);
                            break;
                        case "sub":
                            htmlState.subDepth = Math.max(0, htmlState.subDepth + delta);
                            break;
                        default:
                            // Strip unrecognized/orphan inline HTML tags (e.g. </span>)
                            break;
                    }
                }
                break;
            }
            default: {
                const nested = asTokenArray(token.tokens);
                if (nested.length > 0) {
                    xml += renderInlineTokensToRuns(nested, activeCtx, callbacks, containerWidth);
                } else {
                    const fallback = getTokenText(token);
                    if (fallback) {
                        xml += renderPlainTextWithRawUrls(fallback, activeCtx, callbacks);
                    }
                }
                break;
            }
        }
    }

    return xml;
}
