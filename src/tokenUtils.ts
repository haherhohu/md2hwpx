import { MarkdownToken } from "./types";

export function asTokenArray(value: unknown): MarkdownToken[] {
    return Array.isArray(value) ? (value as MarkdownToken[]) : [];
}
