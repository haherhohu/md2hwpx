export interface MarkdownToken {
    type: string;
    raw?: string;
    text?: string;
    tokens?: MarkdownToken[];
    [key: string]: unknown;
}
