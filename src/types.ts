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

export interface TableCellToken {
    text: string;
    tokens?: MarkdownToken[];
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
    header?: TableCellToken[] | unknown[];
    rows?: TableCellToken[][] | unknown[][];
    align?: Array<"left" | "center" | "right" | null>;
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
