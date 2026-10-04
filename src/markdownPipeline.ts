import { marked } from "marked";

type Token = any;

export class MarkdownPipeline {
    public parseMarkdown(mdContent: string): Token[] {
        return marked.lexer(mdContent) as Token[];
    }

    public normalizeTokens(tokens: Token[]): Token[] {
        return tokens.flatMap((token) => this.normalizeToken(token));
    }

    private normalizeToken(token: Token): Token[] {
        if (!token || typeof token !== "object") {
            return [];
        }

        if (token.type === "blockquote") {
            const normalizedChildren = this.normalizeTokens(token.tokens ?? []);
            if (normalizedChildren.some((child) => child.type === "table")) {
                return normalizedChildren;
            }
            return [{ ...token, tokens: normalizedChildren }];
        }

        if (token.type === "list") {
            const items = (token.items ?? []).map((item: Token) => {
                const normalizedItemChildren = this.normalizeTokens(item.tokens ?? []);
                return { ...item, tokens: normalizedItemChildren };
            });
            return [{ ...token, items }];
        }

        if (token.type === "list_item") {
            return [{ ...token, tokens: this.normalizeTokens(token.tokens ?? []) }];
        }

        return [token];
    }
}
