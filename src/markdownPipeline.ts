import { marked } from "marked";
import { MarkdownToken } from "./types";

export class MarkdownPipeline {
    public parseMarkdown(mdContent: string): MarkdownToken[] {
        return marked.lexer(mdContent) as MarkdownToken[];
    }

    public normalizeTokens(tokens: MarkdownToken[]): MarkdownToken[] {
        return tokens.flatMap((token) => this.normalizeToken(token));
    }

    private normalizeToken(token: MarkdownToken): MarkdownToken[] {
        if (!token || typeof token !== "object") {
            return [];
        }

        if (token.type === "blockquote") {
            const normalizedChildren = this.normalizeTokens(token.tokens ?? []);
            if (normalizedChildren.some((child) => child.type === "table")) {
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
            const items = (token.items ?? []).map((item: MarkdownToken) => {
                const normalizedItemChildren = (item.tokens ?? []).flatMap((child: MarkdownToken) => this.normalizeToken(child));
                return { ...item, tokens: normalizedItemChildren };
            });
            return [{ ...token, items }];
        }

        return [token];
    }
}
