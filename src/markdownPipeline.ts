import { marked } from "marked";
import { MarkdownToken } from "./types";
import { asTokenArray } from "./tokenUtils";

export class MarkdownPipeline {
    public parseMarkdown(mdContent: string): MarkdownToken[] {
        return marked.lexer(mdContent) as unknown as MarkdownToken[];
    }

    public normalizeTokens(tokens: MarkdownToken[]): MarkdownToken[] {
        return tokens.flatMap((token) => this.normalizeToken(token));
    }

    private normalizeToken(token: MarkdownToken): MarkdownToken[] {
        if (!token || typeof token !== "object") {
            return [];
        }

        if (token.type === "blockquote") {
            const normalizedChildren = this.normalizeTokens(token.tokens ?? []).flatMap((child) => this.convertHtmlTableToken(child));
            const quoteText = typeof token.text === "string" ? token.text.trimStart() : "";
            const startsWithMarkdownTable = quoteText.startsWith("|");
            const containsHtmlTable = asTokenArray(token.tokens).some((child) => this.isHtmlTableToken(child));

            if ((startsWithMarkdownTable || containsHtmlTable) && normalizedChildren.some((child) => child.type === "table")) {
                const result: MarkdownToken[] = [];
                let quoteBuffer: MarkdownToken[] = [];

                const flushQuoteBuffer = () => {
                    if (quoteBuffer.length > 0) {
                        result.push({ ...token, tokens: quoteBuffer });
                        quoteBuffer = [];
                    }
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

        return [token];
    }

    private isHtmlTableToken(token: MarkdownToken): boolean {
        if (token?.type !== "html") {
            return false;
        }

        const htmlContent = typeof token.text === "string" ? token.text : typeof token.raw === "string" ? token.raw : "";
        return /<table[\s\S]*?>/i.test(htmlContent);
    }

    private convertHtmlTableToken(token: MarkdownToken): MarkdownToken[] {
        if (token?.type !== "html") {
            return [token];
        }

        const htmlContent = typeof token.text === "string" ? token.text : typeof token.raw === "string" ? token.raw : "";
        if (!/<table[\s\S]*?>/i.test(htmlContent)) {
            return [token];
        }

        const rows = Array.from(htmlContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map(
            (rowMatch) => (rowMatch as RegExpMatchArray)[1],
        );
        if (rows.length === 0) {
            return [token];
        }

        const parsedRows = rows
            .map((rowHtml) =>
                Array.from(rowHtml.matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi)).map((cellMatch) =>
                    this.stripHtmlTags((cellMatch as RegExpMatchArray)[2]).trim(),
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
            },
        ];
    }

    private stripHtmlTags(text: string): string {
        const normalized = text.replace(/<br\s*\/?>/gi, "\n");
        const withoutTags = this.removeHtmlTags(normalized);
        return withoutTags
            .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (full, entityName: string) => {
                const map: Record<string, string> = {
                    nbsp: " ",
                    amp: "&",
                    lt: "<",
                    gt: ">",
                    quot: "\"",
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
