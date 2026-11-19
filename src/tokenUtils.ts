import { MarkdownToken } from "./types";
import { stripKoreanSentinels } from "./pipeline/koreanPreprocessor";

export function asTokenArray(value: unknown): MarkdownToken[] {
    return Array.isArray(value) ? (value as MarkdownToken[]) : [];
}

export function getTokenText(token: MarkdownToken): string {
    if (typeof token.text === "string") {
        return token.text;
    }
    if (typeof token.raw === "string") {
        return token.raw;
    }
    return "";
}

export function hasVisibleInlineContent(tokens: MarkdownToken[]): boolean {
    return tokens.some(
        (t) => t.type !== "text" || stripKoreanSentinels(getTokenText(t)).trim().length > 0,
    );
}
