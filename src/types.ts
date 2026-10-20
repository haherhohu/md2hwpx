export interface FootnoteDefinition {
    id: string;
    text: string;
}

export interface EmbeddedImageItem {
    id: string;
    filename: string;
    mimeType: string;
    data: Buffer;
}

export interface MarkdownToken {
    type: string;
    raw?: string;
    text?: string;
    tokens?: MarkdownToken[];
    depth?: number;
    ordered?: boolean;
    start?: number;
    items?: MarkdownToken[];
    header?: unknown[];
    rows?: unknown[][];
    href?: string;
    title?: string;
    lang?: string;
    ruleStyle?: "rule" | "pageBreak";
    svgContent?: string;
    caption?: string;
    captionSide?: "TOP" | "BOTTOM";
    isCaption?: boolean;
    footnoteDefs?: FootnoteDefinition[];
    [key: string]: unknown;
}
