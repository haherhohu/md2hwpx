import { marked } from "marked";
import { MarkdownToken } from "../types";

let extensionsRegistered = false;

/**
 * Registers custom block/inline extensions (math, footnotes) on marked once.
 */
export function ensureMarkedExtensionsRegistered(): void {
    if (extensionsRegistered) {
        return;
    }

    const blockMathExtension: marked.TokenizerExtension = {
        name: "blockMath",
        level: "block",
        start(src: string) {
            const idx = src.indexOf("$$");
            return idx >= 0 ? idx : undefined;
        },
        tokenizer(src: string) {
            const match = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\r?\n|$)/.exec(src);
            if (match) {
                return {
                    type: "blockMath",
                    raw: match[0],
                    text: match[1].trim(),
                };
            }
            return undefined;
        },
    };

    const inlineMathExtension: marked.TokenizerExtension = {
        name: "inlineMath",
        level: "inline",
        start(src: string) {
            const idx = src.indexOf("$");
            return idx >= 0 ? idx : undefined;
        },
        tokenizer(src: string) {
            const displayMatch = /^\$\$([^$\n]+?)\$\$/.exec(src);
            if (displayMatch) {
                return {
                    type: "inlineMath",
                    raw: displayMatch[0],
                    text: displayMatch[1].trim(),
                    display: true,
                };
            }

            const inlineMatch = /^\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/.exec(src);
            if (inlineMatch) {
                return {
                    type: "inlineMath",
                    raw: inlineMatch[0],
                    text: inlineMatch[1].trim(),
                    display: false,
                };
            }
            return undefined;
        },
    };

    const footnoteRefExtension: marked.TokenizerExtension = {
        name: "footnoteRef",
        level: "inline",
        start(src: string) {
            const idx = src.indexOf("[^");
            return idx >= 0 ? idx : undefined;
        },
        tokenizer(src: string) {
            const match = /^\[\^([A-Za-z0-9_-]+)\]/.exec(src);
            if (match) {
                return {
                    type: "footnoteRef",
                    raw: match[0],
                    id: match[1],
                };
            }
            return undefined;
        },
    };

    marked.use({
        extensions: [blockMathExtension, inlineMathExtension, footnoteRefExtension],
    });
    extensionsRegistered = true;
}

export function lexMarkdown(markdown: string): MarkdownToken[] {
    ensureMarkedExtensionsRegistered();
    return marked.lexer(markdown) as unknown as MarkdownToken[];
}

export function lexInlineMarkdown(text: string): MarkdownToken[] {
    ensureMarkedExtensionsRegistered();
    return marked.Lexer.lexInline(text) as unknown as MarkdownToken[];
}
