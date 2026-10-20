import { marked } from "marked";
import { FootnoteDefinition, MarkdownToken } from "./types";
import { asTokenArray } from "./tokenUtils";

export class MarkdownPipeline {
    public parseMarkdown(mdContent: string): MarkdownToken[] {
        const { cleanedMarkdown, footnoteDefs } = this.extractFootnoteDefinitions(mdContent);
        const preparedMarkdown = this.protectMultiLineHtmlBlocks(cleanedMarkdown);
        const tokens = marked.lexer(preparedMarkdown) as unknown as MarkdownToken[];

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
            const rawText = this.getTokenText(token);
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
            return this.normalizeParagraphToken(token);
        }

        if (token.type === "blockquote") {
            const rawChildren = asTokenArray(token.tokens);
            const normalizedChildren = rawChildren
                .flatMap((child) => this.normalizeToken(child))
                .flatMap((child) => this.convertHtmlTableToken(child));
            const quoteText = typeof token.text === "string" ? token.text.trimStart() : "";
            const startsWithMarkdownTable = quoteText.startsWith("|");
            const containsHtmlTable = rawChildren.some((child) => this.isHtmlTableToken(child));

            if ((startsWithMarkdownTable || containsHtmlTable) && normalizedChildren.some((child) => child.type === "table")) {
                const result: MarkdownToken[] = [];
                let quoteBuffer: MarkdownToken[] = [];

                const flushQuoteBuffer = () => {
                    const nonSpaceQuotes = quoteBuffer.filter((q) => q.type !== "space");
                    if (nonSpaceQuotes.length > 0) {
                        result.push({ ...token, tokens: quoteBuffer });
                    }
                    quoteBuffer = [];
                };

                for (const child of normalizedChildren) {
                    if (child.type === "table") {
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

        if (token.type === "list") {
            const items = asTokenArray(token.items).map((item) => {
                const normalizedItemChildren = asTokenArray(item.tokens).flatMap((child) => this.normalizeToken(child));
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
                if (tok.type === "paragraph" || tok.type === "html") {
                    tok.isCaption = true;
                    tok.text = capText;
                    tok.raw = capText;
                    tok.tokens = undefined;
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
        const rawText = (typeof token.text === "string" ? token.text : typeof token.raw === "string" ? token.raw : "").trim();
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

    private normalizeParagraphToken(token: MarkdownToken): MarkdownToken[] {
        const text = typeof token.text === "string" ? token.text : typeof token.raw === "string" ? token.raw : "";
        const lines = text.split(/\r?\n/);

        const extractAltCaption = (alt: string, title?: string): string | undefined => {
            const candidate = (title || alt).trim();
            if (!candidate) {
                return undefined;
            }
            return this.normalizeCaptionText(candidate);
        };

        const imageLineRegex = /^\s*!\[(.*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/;
        if (lines.length === 1) {
            const singleMatch = lines[0].match(imageLineRegex);
            if (singleMatch) {
                const altText = singleMatch[1].trim();
                const href = singleMatch[2].trim();
                const title = singleMatch[3]?.trim();
                const autoCaption = extractAltCaption(altText, title);
                return [
                    {
                        type: "image",
                        raw: lines[0].trim(),
                        text: altText,
                        href,
                        title,
                        caption: autoCaption,
                        captionSide: autoCaption ? "BOTTOM" : undefined,
                    },
                ];
            }
            return [token];
        }

        if (!lines.some((line) => imageLineRegex.test(line))) {
            return [token];
        }

        const result: MarkdownToken[] = [];
        let paragraphLines: string[] = [];

        const flushParagraphLines = () => {
            const joined = paragraphLines.join("\n").trim();
            if (joined.length > 0) {
                const subTokens = marked.lexer(joined) as unknown as MarkdownToken[];
                for (const subToken of subTokens) {
                    if (subToken.type !== "space") {
                        result.push(subToken);
                    }
                }
            }
            paragraphLines = [];
        };

        for (const line of lines) {
            const imgMatch = line.match(imageLineRegex);
            if (imgMatch) {
                flushParagraphLines();
                const altText = imgMatch[1].trim();
                const href = imgMatch[2].trim();
                const title = imgMatch[3]?.trim();
                const autoCaption = extractAltCaption(altText, title);
                result.push({
                    type: "image",
                    raw: line.trim(),
                    text: altText,
                    href,
                    title,
                    caption: autoCaption,
                    captionSide: autoCaption ? "BOTTOM" : undefined,
                });
            } else {
                paragraphLines.push(line);
            }
        }
        flushParagraphLines();

        return result.length > 0 ? result : [token];
    }

    private isHtmlTableToken(token: MarkdownToken): boolean {
        if (token?.type !== "html") {
            return false;
        }

        const htmlContent = typeof token.text === "string" ? token.text : typeof token.raw === "string" ? token.raw : "";
        return /<table[\s\S]*?>/i.test(htmlContent);
    }

    private getTokenText(token: MarkdownToken): string {
        if (typeof token.text === "string") {
            return token.text;
        }
        if (typeof token.raw === "string") {
            return token.raw;
        }
        return "";
    }

    private isSvgMarkup(token: MarkdownToken): boolean {
        const htmlContent = this.getTokenText(token);
        return /<svg\b[\s\S]*<\/svg>|<svg\b[^>]*\/>/i.test(htmlContent) || /<svg\b/i.test(htmlContent);
    }

    private convertHtmlTableToken(token: MarkdownToken): MarkdownToken[] {
        if (token?.type !== "html") {
            return [token];
        }

        const htmlContent = typeof token.text === "string" ? token.text : typeof token.raw === "string" ? token.raw : "";
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

        const [header, ...bodyRows] = parsedRows;
        return [
            {
                type: "table",
                header: header.map((text) => ({ text })),
                rows: bodyRows.map((row) => row.map((text) => ({ text }))),
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

        return withoutTags.replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (full, entityName: string) => {
            const map: Record<string, string> = {
                nbsp: " ",
                amp: "&",
                lt: "<",
                gt: ">",
                quot: '"',
                apos: "'",
            };
            return map[entityName.toLowerCase()] ?? full;
        });
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
