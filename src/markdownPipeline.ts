import { FootnoteDefinition, MarkdownToken, TableCellToken } from "./types";
import { asTokenArray, getTokenText } from "./tokenUtils";
import { decodeHtmlEntities } from "./hwpxConstants";
import { lexInlineMarkdown, lexMarkdown } from "./pipeline/markdownExtensions";
import { preprocessKoreanBoundaries, stripKoreanSentinels } from "./pipeline/koreanPreprocessor";

const FENCE_OPEN_REGEX = /^\s*(`{3,}|~{3,})/;
const TABLE_START_ROW_REGEX = /^\s{0,3}\|/;
const TABLE_DELIMITER_ROW_REGEX = /^\s{0,3}\|?[\s:]*-{1,}[\s:]*(?:\|[\s:]*-{1,}[\s:]*)+\|?\s*$/;
const BLOCKQUOTE_LINE_REGEX = /^\s*>/;
const PIPE_TABLE_INTERRUPT_REGEX = /^(?:#{1,6}\s|>|\s*(?:[-*+]|\d+[.)])\s|```|~~~|(?:\*\s*){3,}$|(?:-\s*){3,}$|(?:_\s*){3,}$)/;

export class MarkdownPipeline {
    public parseMarkdown(mdContent: string): MarkdownToken[] {
        const { cleanedMarkdown, footnoteDefs } = this.extractFootnoteDefinitions(mdContent);
        const protectedHtmlMarkdown = this.protectMultiLineHtmlBlocks(cleanedMarkdown);
        const boundedMarkdown = this.ensureBlockBoundaries(protectedHtmlMarkdown);
        const koreanPreparedMarkdown = preprocessKoreanBoundaries(boundedMarkdown);
        const tokens = lexMarkdown(koreanPreparedMarkdown);

        if (footnoteDefs.length > 0) {
            tokens.push({
                type: "footnotes",
                footnoteDefs,
            });
        }

        return tokens;
    }

    public normalizeTokens(tokens: MarkdownToken[]): MarkdownToken[] {
        const flattened = tokens.flatMap((token) => this.normalizeToken(token));
        const hrMerged: MarkdownToken[] = [];

        for (let index = 0; index < flattened.length; index += 1) {
            const token = flattened[index];
            if (token.type === "hr") {
                let lookahead = index + 1;
                while (lookahead < flattened.length && flattened[lookahead].type === "space") {
                    lookahead += 1;
                }
                const isPageBreak = lookahead < flattened.length && flattened[lookahead]?.type === "hr";
                hrMerged.push({ ...token, ruleStyle: isPageBreak ? "pageBreak" : "rule" });
                if (isPageBreak) {
                    index = lookahead;
                }
                continue;
            }

            hrMerged.push(token);
        }

        const captionBound = this.bindCaptionsToTablesAndImages(hrMerged);

        const spacedResult: MarkdownToken[] = [];
        const isContentBlock = (type: string): boolean =>
            type === "heading" ||
            type === "paragraph" ||
            type === "list" ||
            type === "blockquote" ||
            type === "table" ||
            type === "image" ||
            type === "code";

        for (const token of captionBound) {
            if (token.type === "space") {
                if (spacedResult.length > 0 && spacedResult[spacedResult.length - 1].type !== "space") {
                    spacedResult.push(token);
                }
                continue;
            }

            if (spacedResult.length > 0) {
                const prev = spacedResult[spacedResult.length - 1];
                if (isContentBlock(prev.type) && isContentBlock(token.type)) {
                    spacedResult.push({ type: "space", raw: "\n\n" });
                }
            }

            spacedResult.push(token);
        }

        while (spacedResult.length > 0 && spacedResult[spacedResult.length - 1].type === "space") {
            spacedResult.pop();
        }

        return spacedResult;
    }

    public ensureBlockBoundaries(mdContent: string): string {
        const lines = mdContent.split(/\r?\n/);
        const output: string[] = [];
        let activeFenceChar: string | undefined;
        let activeFenceLen = 0;
        let inPipeTable = false;

        const pushBlankIfNeeded = () => {
            if (output.length > 0 && output[output.length - 1].trim() !== "") {
                output.push("");
            }
        };

        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const trimmed = line.trim();

            const fenceMatch = line.match(FENCE_OPEN_REGEX);
            if (!activeFenceChar && fenceMatch) {
                if (inPipeTable) {
                    pushBlankIfNeeded();
                    inPipeTable = false;
                }
                activeFenceChar = fenceMatch[1][0];
                activeFenceLen = fenceMatch[1].length;
                output.push(line);
                continue;
            }
            if (activeFenceChar) {
                const closeFenceRegex = new RegExp(`^\\s*${activeFenceChar}{${activeFenceLen},}\\s*$`);
                if (closeFenceRegex.test(line)) {
                    activeFenceChar = undefined;
                    activeFenceLen = 0;
                }
                output.push(line);
                continue;
            }

            if (inPipeTable) {
                if (trimmed === "") {
                    inPipeTable = false;
                    output.push(line);
                    continue;
                }
                if (!PIPE_TABLE_INTERRUPT_REGEX.test(trimmed) && trimmed.includes("|")) {
                    output.push(line);
                    continue;
                }
                pushBlankIfNeeded();
                inPipeTable = false;
            }

            const nextLine = i + 1 < lines.length ? lines[i + 1] : undefined;
            if (
                TABLE_START_ROW_REGEX.test(line) &&
                !BLOCKQUOTE_LINE_REGEX.test(line) &&
                nextLine !== undefined &&
                TABLE_DELIMITER_ROW_REGEX.test(nextLine)
            ) {
                pushBlankIfNeeded();
                inPipeTable = true;
                output.push(line);
                continue;
            }

            output.push(line);

            // Prevent CommonMark lazy continuation of blockquotes by unquoted trailing paragraphs/tables
            if (BLOCKQUOTE_LINE_REGEX.test(line) && nextLine !== undefined) {
                const nextTrimmed = nextLine.trim();
                if (nextTrimmed !== "" && !BLOCKQUOTE_LINE_REGEX.test(nextLine)) {
                    output.push("");
                }
            }
        }

        return output.join("\n");
    }

    private extractFootnoteDefinitions(mdContent: string): {
        cleanedMarkdown: string;
        footnoteDefs: FootnoteDefinition[];
    } {
        const lines = mdContent.split(/\r?\n/);
        const keptLines: string[] = [];
        const footnoteDefs: FootnoteDefinition[] = [];
        let inCodeFence = false;

        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const trimmed = line.trim();

            if (/^(`{3,}|~{3,})/.test(trimmed)) {
                inCodeFence = !inCodeFence;
                keptLines.push(line);
                continue;
            }

            if (!inCodeFence) {
                const match = line.match(/^\s*\[\^([A-Za-z0-9_-]+)\]:\s*(.+)$/);
                if (match) {
                    const id = match[1].trim();
                    let text = match[2].trim();

                    while (i + 1 < lines.length && /^(?: {2,}|\t+)\S/.test(lines[i + 1])) {
                        i += 1;
                        text += " " + lines[i].trim();
                    }

                    const existing = footnoteDefs.find((def) => def.id === id);
                    if (existing) {
                        existing.text = text;
                    } else {
                        footnoteDefs.push({ id, text });
                    }
                    continue;
                }
            }

            keptLines.push(line);
        }

        return {
            cleanedMarkdown: keptLines.join("\n"),
            footnoteDefs,
        };
    }

    private protectMultiLineHtmlBlocks(mdContent: string): string {
        let result = mdContent.replace(/<svg\b[\s\S]*?<\/svg>/gi, (svgBlock) => svgBlock.replace(/\r?\n\s*\r?\n/g, "\n"));
        result = result.replace(/<table\b[\s\S]*?<\/table>/gi, (tableBlock) => tableBlock.replace(/\r?\n\s*\r?\n/g, "\n"));
        return result;
    }

    private normalizeToken(token: MarkdownToken): MarkdownToken[] {
        if (!token || typeof token !== "object") {
            return [];
        }

        if (token.type === "footnotes") {
            return [token];
        }

        if ((token.type === "html" || token.type === "paragraph") && this.isSvgMarkup(token)) {
            const rawText = getTokenText(token);
            return [
                {
                    type: "image",
                    raw: rawText,
                    text: "SVG diagram",
                    href: "inline.svg",
                    svgContent: rawText,
                },
            ];
        }

        if (token.type === "html") {
            return this.convertHtmlTableToken(token);
        }

        if (token.type === "paragraph") {
            return this.normalizeParagraphToken(token, "paragraph");
        }

        if (token.type === "blockquote") {
            return this.normalizeBlockquoteToken(token);
        }

        if (token.type === "list") {
            const items = asTokenArray(token.items).map((item) => {
                const normalizedItemChildren = asTokenArray(item.tokens).flatMap((child) => {
                    if (child.type === "text" && Array.isArray(child.tokens)) {
                        return this.normalizeParagraphToken(child, "text");
                    }
                    return this.normalizeToken(child);
                });
                return { ...item, tokens: normalizedItemChildren };
            });
            return [{ ...token, items }];
        }

        if (token.type === "code") {
            const language = typeof token.lang === "string" ? token.lang.trim() : "";
            const codeText = typeof token.text === "string" ? token.text : typeof token.raw === "string" ? token.raw : "";
            if ((language && /svg/i.test(language)) || /^\s*<svg\b/i.test(codeText)) {
                return [
                    {
                        type: "image",
                        raw: codeText,
                        text: language || "SVG diagram",
                        href: "inline.svg",
                        svgContent: codeText,
                    },
                ];
            }
            if (/^html$/i.test(language) && /<table[\s\S]*?>/i.test(codeText)) {
                return this.convertHtmlTableToken({ type: "html", text: codeText, raw: codeText });
            }
        }

        return [token];
    }

    private normalizeBlockquoteToken(token: MarkdownToken): MarkdownToken[] {
        const rawChildren = asTokenArray(token.tokens);
        const normalizedChildren = rawChildren
            .flatMap((child) => this.normalizeToken(child))
            .flatMap((child) => this.convertHtmlTableToken(child));

        const quoteText = typeof token.text === "string" ? token.text.trimStart() : "";
        const startsWithMarkdownTable = quoteText.startsWith("|");
        const containsHtmlTable = rawChildren.some((child) => this.isHtmlTableToken(child));
        const hasTable = normalizedChildren.some((child) => child.type === "table");

        const unquotedRawLines = new Set<string>();
        if (typeof token.raw === "string") {
            for (const rawLine of token.raw.split(/\r?\n/)) {
                const trimmed = rawLine.trim();
                if (trimmed !== "" && !BLOCKQUOTE_LINE_REGEX.test(rawLine)) {
                    unquotedRawLines.add(trimmed);
                }
            }
        }

        const isChildUnquoted = (child: MarkdownToken, seenTable: boolean): boolean => {
            const childFirstLine = getTokenText(child)
                .split(/\r?\n/)
                .map((l) => l.trim())
                .find((l) => l.length > 0);
            if (childFirstLine && unquotedRawLines.has(childFirstLine)) {
                return true;
            }
            // If raw is unavailable (e.g. synthetic token), never re-wrap paragraphs appearing after a table
            if (typeof token.raw !== "string" && seenTable) {
                return true;
            }
            return false;
        };

        const shouldSplitTables = (startsWithMarkdownTable || containsHtmlTable) && hasTable;
        if (shouldSplitTables || unquotedRawLines.size > 0) {
            const result: MarkdownToken[] = [];
            let quoteBuffer: MarkdownToken[] = [];
            let seenTable = false;

            const flushQuoteBuffer = () => {
                const nonSpaceQuotes = quoteBuffer.filter((q) => q.type !== "space");
                if (nonSpaceQuotes.length > 0) {
                    result.push({ ...token, tokens: quoteBuffer });
                }
                quoteBuffer = [];
            };

            for (const child of normalizedChildren) {
                if (shouldSplitTables && child.type === "table") {
                    flushQuoteBuffer();
                    seenTable = true;
                    result.push(child);
                } else if (child.type !== "space" && isChildUnquoted(child, shouldSplitTables && seenTable)) {
                    flushQuoteBuffer();
                    result.push(child);
                } else {
                    quoteBuffer.push(child);
                }
            }
            flushQuoteBuffer();
            return result;
        }

        return [{ ...token, tokens: normalizedChildren }];
    }

    private bindCaptionsToTablesAndImages(tokens: MarkdownToken[]): MarkdownToken[] {
        const consumed = new Set<number>();
        const cloned = tokens.map((t) => ({ ...t }));

        const nextNonSpaceIndex = (fromIndex: number): number => {
            let idx = fromIndex + 1;
            while (idx < cloned.length && cloned[idx].type === "space") {
                idx += 1;
            }
            return idx < cloned.length ? idx : -1;
        };

        for (let i = 0; i < cloned.length; i += 1) {
            if (consumed.has(i)) {
                continue;
            }
            const tok = cloned[i];
            const capText = this.extractCaptionFromToken(tok);
            if (capText !== undefined) {
                const nextIdx = nextNonSpaceIndex(i);
                if (nextIdx !== -1 && !consumed.has(nextIdx)) {
                    const nextTok = cloned[nextIdx];
                    if ((nextTok.type === "table" || nextTok.type === "image") && !nextTok.caption) {
                        nextTok.caption = capText;
                        nextTok.captionSide = "TOP";
                        consumed.add(i);
                        continue;
                    }
                }
                if (tok.type === "html") {
                    tok.isCaption = true;
                    tok.text = capText;
                    tok.raw = capText;
                    tok.tokens = lexInlineMarkdown(preprocessKoreanBoundaries(capText));
                    tok.caption = capText;
                }
                continue;
            }

            if ((tok.type === "table" || tok.type === "image") && !tok.caption) {
                const nextIdx = nextNonSpaceIndex(i);
                if (nextIdx !== -1 && !consumed.has(nextIdx)) {
                    const nextCap = this.extractCaptionFromToken(cloned[nextIdx]);
                    if (nextCap !== undefined) {
                        tok.caption = nextCap;
                        tok.captionSide = "BOTTOM";
                        consumed.add(nextIdx);
                    }
                }
            }
        }

        return cloned.filter((_, idx) => !consumed.has(idx));
    }

    public normalizeCaptionText(rawCaption: string): string {
        let cleaned = rawCaption.trim();

        // Strip outer bold markers wrapping the entire caption: `**[표 1-1] 제목**` -> `[표 1-1] 제목`
        const outerBoldMatch = cleaned.match(/^(\*\*|__)\s*([\s\S]+?)\s*\1$/);
        if (outerBoldMatch && !outerBoldMatch[2].includes(outerBoldMatch[1])) {
            cleaned = outerBoldMatch[2].trim();
        }

        // Also handle bold markers wrapping only the bracketed prefix: `**[표 1-1]** 제목` -> `[표 1-1] 제목`
        cleaned = cleaned.replace(/^(\*\*|__)\s*(\[[^\]]+\]|【[^】]+】|<[^>]+>)\s*\1\s*/, "$2 ");

        // Convert bracketed label `[표 1-1] 제목`, `[표 1] 제목`, `[요약표 1] 제목`, `【표 1】 제목`, `<표 1> 제목` -> `표 1-1. 제목`, `표 1. 제목`
        const bracketPrefixMatch = cleaned.match(
            /^(?:\[\s*((?:요약|부록|별첨)?\s*(?:표|그림|도|Table|Figure)\s*[^\]]*?)\s*\]|【\s*((?:요약|부록|별첨)?\s*(?:표|그림|도|Table|Figure)\s*[^】]*?)\s*】|<\s*((?:요약|부록|별첨)?\s*(?:표|그림|도|Table|Figure)\s*[^>]*?)\s*>)\.?[\s:：-]*(.+)$/i,
        );
        if (bracketPrefixMatch) {
            const label = (bracketPrefixMatch[1] ?? bracketPrefixMatch[2] ?? bracketPrefixMatch[3] ?? "").trim().replace(/\.$/, "");
            const rest = bracketPrefixMatch[4].trim();
            return `${label}. ${rest}`;
        }

        return cleaned;
    }

    private extractCaptionFromToken(token: MarkdownToken): string | undefined {
        if (!token || (token.type !== "paragraph" && token.type !== "html" && token.type !== "heading")) {
            return undefined;
        }
        const rawText = stripKoreanSentinels(getTokenText(token)).trim();
        if (!rawText || /\r?\n/.test(rawText)) {
            return undefined;
        }

        // 1. HTML <caption> or <figcaption>
        const htmlCapMatch = rawText.match(/^<(?:caption|figcaption)\b[^>]*>([\s\S]*?)<\/(?:caption|figcaption)>$/i);
        if (htmlCapMatch) {
            return this.normalizeCaptionText(htmlCapMatch[1].trim());
        }

        // 2. Pandoc / Markdown explicit caption syntax: `: 캡션 내용` or `Table: 캡션 내용` or `Figure: 캡션 내용`
        const pandocMatch = rawText.match(/^(?::|(?:Table|Figure)\s*:)\s+(.+)$/i);
        if (pandocMatch) {
            return this.normalizeCaptionText(pandocMatch[1].trim());
        }

        // 3. Korean/English bracketed caption line: `[표 1] 제목`, `[표 1-1] 제목`, `[요약표 1] 제목`, `**[표 1-1] 제목**`, `【표 1】 제목`, `<표 1> 제목`
        // Exclude body sentences like `**[표 1-1]**가 제시하는...` where `**` closes immediately after `]` followed by Korean particle without space
        const bracketMatch = rawText.match(
            /^(?:(\*\*|__)\s*)?(\[\s*(?:요약|부록|별첨)?\s*(?:표|그림|도|Table|Figure)\s*[^\]]*\]|【\s*(?:요약|부록|별첨)?\s*(?:표|그림|도|Table|Figure)\s*[^】]*】|<\s*(?:요약|부록|별첨)?\s*(?:표|그림|도|Table|Figure)\s*[^>]*>)\s+([^\r\n]+)$/i,
        );
        if (bracketMatch) {
            return this.normalizeCaptionText(rawText);
        }

        return undefined;
    }

    private normalizeParagraphToken(token: MarkdownToken, targetType: "paragraph" | "text"): MarkdownToken[] {
        const inlineTokens = asTokenArray(token.tokens);
        if (inlineTokens.length === 0 || !inlineTokens.some((child) => child.type === "image")) {
            return [token];
        }

        const lines = this.splitTopLevelInlineTokensByLine(inlineTokens);
        const isStandaloneImageLine = (lineToks: MarkdownToken[]): MarkdownToken | undefined => {
            const nonSpace = lineToks.filter((t) => !(t.type === "text" && (t.text ?? t.raw ?? "").trim() === ""));
            if (nonSpace.length === 1 && nonSpace[0].type === "image") {
                return nonSpace[0];
            }
            return undefined;
        };

        if (!lines.some((lineToks) => isStandaloneImageLine(lineToks) !== undefined)) {
            return [token];
        }

        const extractAltCaption = (alt: string, title?: string): string | undefined => {
            const candidate = (title || alt).trim();
            if (!candidate) {
                return undefined;
            }
            return this.normalizeCaptionText(candidate);
        };

        const result: MarkdownToken[] = [];
        let bufferedLines: MarkdownToken[][] = [];

        const flushParagraphBuffer = () => {
            if (bufferedLines.length === 0) {
                return;
            }
            const mergedTokens: MarkdownToken[] = [];
            bufferedLines.forEach((lineToks, idx) => {
                if (idx > 0) {
                    mergedTokens.push({ type: "text", raw: "\n", text: "\n" });
                }
                mergedTokens.push(...lineToks);
            });
            const nonEmpty = mergedTokens.some((t) => t.type !== "text" || (t.text ?? t.raw ?? "").trim() !== "");
            if (nonEmpty) {
                const rawJoined = mergedTokens.map((t) => t.raw ?? t.text ?? "").join("");
                const textJoined = mergedTokens.map((t) => t.text ?? t.raw ?? "").join("");
                result.push({
                    type: targetType,
                    raw: rawJoined.trim(),
                    text: textJoined.trim(),
                    tokens: mergedTokens,
                });
            }
            bufferedLines = [];
        };

        for (const lineToks of lines) {
            const standaloneImg = isStandaloneImageLine(lineToks);
            if (standaloneImg) {
                flushParagraphBuffer();
                const altText = typeof standaloneImg.text === "string" ? standaloneImg.text.trim() : "";
                const href = typeof standaloneImg.href === "string" ? standaloneImg.href.trim() : "";
                const title = typeof standaloneImg.title === "string" ? standaloneImg.title.trim() : undefined;
                const autoCaption = extractAltCaption(altText, title);
                result.push({
                    type: "image",
                    raw: typeof standaloneImg.raw === "string" ? standaloneImg.raw : "",
                    text: altText,
                    href,
                    title,
                    caption: autoCaption,
                    captionSide: autoCaption ? "BOTTOM" : undefined,
                });
            } else {
                bufferedLines.push(lineToks);
            }
        }
        flushParagraphBuffer();

        return result.length > 0 ? result : [token];
    }

    private splitTopLevelInlineTokensByLine(inlineTokens: MarkdownToken[]): MarkdownToken[][] {
        const lines: MarkdownToken[][] = [[]];
        for (const tok of inlineTokens) {
            if (tok.type === "br") {
                lines.push([]);
                continue;
            }
            if (tok.type === "text" && (!Array.isArray(tok.tokens) || tok.tokens.length === 0)) {
                const rawStr = typeof tok.raw === "string" ? tok.raw : typeof tok.text === "string" ? tok.text : "";
                const textStr = typeof tok.text === "string" ? tok.text : rawStr;
                if (rawStr.includes("\n") || textStr.includes("\n")) {
                    const rawParts = rawStr.split(/\r?\n/);
                    const textParts = textStr.split(/\r?\n/);
                    const count = Math.max(rawParts.length, textParts.length);
                    for (let idx = 0; idx < count; idx += 1) {
                        if (idx > 0) {
                            lines.push([]);
                        }
                        const rPart = rawParts[idx] ?? "";
                        const tPart = textParts[idx] ?? rPart;
                        if (rPart.length > 0 || tPart.length > 0) {
                            lines[lines.length - 1].push({ type: "text", raw: rPart, text: tPart });
                        }
                    }
                    continue;
                }
            }
            lines[lines.length - 1].push(tok);
        }
        return lines;
    }

    private isHtmlTableToken(token: MarkdownToken): boolean {
        if (token?.type !== "html") {
            return false;
        }

        const htmlContent = getTokenText(token);
        return /<table[\s\S]*?>/i.test(htmlContent);
    }

    private isSvgMarkup(token: MarkdownToken): boolean {
        const htmlContent = getTokenText(token);
        return /<svg\b[\s\S]*<\/svg>|<svg\b[^>]*\/>/i.test(htmlContent) || /<svg\b/i.test(htmlContent);
    }

    private convertHtmlTableToken(token: MarkdownToken): MarkdownToken[] {
        if (token?.type !== "html") {
            return [token];
        }

        const htmlContent = getTokenText(token);
        if (!/<table[\s\S]*?>/i.test(htmlContent)) {
            return [token];
        }

        const captionMatch = htmlContent.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
        const extractedCaption = captionMatch ? this.normalizeCaptionText(this.convertHtmlCellContent(captionMatch[1]).trim()) : undefined;

        const rows = Array.from(htmlContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map((rowMatch) => (rowMatch as RegExpMatchArray)[1]);
        if (rows.length === 0) {
            return [token];
        }

        const parsedRows = rows
            .map((rowHtml) =>
                Array.from(rowHtml.matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi)).map((cellMatch) =>
                    this.convertHtmlCellContent((cellMatch as RegExpMatchArray)[2]).trim(),
                ),
            )
            .filter((row) => row.length > 0);

        if (parsedRows.length === 0) {
            return [token];
        }

        const makeCell = (text: string): TableCellToken => ({
            text,
            tokens: lexInlineMarkdown(preprocessKoreanBoundaries(text)),
        });

        const [header, ...bodyRows] = parsedRows;
        return [
            {
                type: "table",
                header: header.map((text) => makeCell(text)),
                rows: bodyRows.map((row) => row.map((text) => makeCell(text))),
                caption: extractedCaption,
                captionSide: extractedCaption ? "TOP" : undefined,
            },
        ];
    }

    private convertHtmlCellContent(text: string): string {
        let converted = text
            .replace(/<\/?br\s*\/?>/gi, "<br/>")
            .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
            .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
            .replace(/<(del|s|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~")
            .replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, "<u>$1</u>")
            .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

        // Temporarily protect <br/> and <u>...</u> before stripping remaining HTML tags
        converted = converted
            .replace(/<br\/>/g, "\u0000BR\u0000")
            .replace(/<u>/g, "\u0000U_OPEN\u0000")
            .replace(/<\/u>/g, "\u0000U_CLOSE\u0000");

        const withoutTags = this.removeHtmlTags(converted)
            .replace(/\u0000BR\u0000/g, "<br/>")
            .replace(/\u0000U_OPEN\u0000/g, "<u>")
            .replace(/\u0000U_CLOSE\u0000/g, "</u>");

        return decodeHtmlEntities(withoutTags);
    }

    private removeHtmlTags(text: string): string {
        let result = "";
        let isInsideTag = false;

        for (const char of text) {
            if (char === "<") {
                isInsideTag = true;
                continue;
            }
            if (char === ">") {
                isInsideTag = false;
                continue;
            }
            if (!isInsideTag) {
                result += char;
            }
        }

        return result;
    }
}
