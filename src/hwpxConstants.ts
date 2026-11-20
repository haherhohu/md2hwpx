import { stripKoreanSentinels } from "./pipeline/koreanPreprocessor";

export const HwpxLayout = {
    DEFAULT_CONTENT_WIDTH: 42520,
    MIN_CONTENT_WIDTH: 10000,
    MAX_IMAGE_PAGE_HEIGHT: 56000,
    DEFAULT_DPI: 96,
    SVG_RENDER_DPI: 300,
    HWPUNIT_PER_INCH: 7200,
    CALLOUT_PADDING_X: 560,
    CELL_MARGIN: 280,
    TABLE_OUT_MARGIN_Y: 141,
    DEFAULT_ROW_HEIGHT: 1800,
    CAPTION_GAP: 850,
    HR_LINE_WIDTH: 141,
    MIN_TABLE_COL_WIDTH: 3000,
} as const;

export const HwpxStyles = {
    HEADING_HEIGHTS: {
        h1: "1600",
        h2: "1400",
        h3: "1200",
        h4: "1200",
        h5: "1200",
        h6: "1200",
    },
    LIST_BULLETS: ["□", "◦", "•", "▪", "▫", "‣"],
    LIST_HANGING_INDENT: -1200,
    LIST_LEVEL_STEP: 1200,
    ENDNOTE_HANGING_INDENT: -2200,
    ENDNOTE_TAB_WIDTH: 2200,
    TABLE_HEADER_BG: "#E5E5E5",
    CALLOUT_BG: "#F9F9F9",
    BORDER_COLOR: "#000000",
    BORDER_WIDTH: "0.12 mm",
    HYPERLINK_FIELD_ID: "627600491",
    EQUATION_VERSION: "Equation Version 60",
    EQUATION_FONT: "HYhwpEQ",
} as const;

export const HwpxNs = {
    HWP_UNIT_CHAR: "http://www.hancom.co.kr/hwpml/2016/HwpUnitChar",
} as const;

export const SvgHtmlEntityMap: Record<string, string> = {
    nbsp: "&#160;",
    copy: "&#169;",
    reg: "&#174;",
    trade: "&#8482;",
    ndash: "&#8211;",
    mdash: "&#8212;",
    lsquo: "&#8216;",
    rsquo: "&#8217;",
    ldquo: "&#8220;",
    rdquo: "&#8221;",
    bull: "&#8226;",
    hellip: "&#8230;",
    rarr: "&#8594;",
    larr: "&#8592;",
    uarr: "&#8593;",
    darr: "&#8595;",
    harr: "&#8596;",
    rArr: "&#8658;",
    lArr: "&#8656;",
    hArr: "&#8660;",
    times: "&#215;",
    divide: "&#247;",
    plusmn: "&#177;",
    minus: "&#8722;",
    le: "&#8804;",
    ge: "&#8805;",
    ne: "&#8800;",
    asymp: "&#8776;",
    equiv: "&#8801;",
    sim: "&#8764;",
    deg: "&#176;",
    middot: "&#183;",
    alpha: "&#945;",
    beta: "&#946;",
    gamma: "&#947;",
    delta: "&#948;",
    epsilon: "&#949;",
    theta: "&#952;",
    lambda: "&#955;",
    mu: "&#956;",
    pi: "&#960;",
    sigma: "&#963;",
    tau: "&#964;",
    phi: "&#966;",
    omega: "&#969;",
    Delta: "&#916;",
    Sigma: "&#931;",
    Omega: "&#937;",
};

export function escapeXmlText(text: string): string {
    return stripKoreanSentinels(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
};

export function decodeHtmlEntities(text: string): string {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|nbsp|amp|lt|gt|quot|apos);/gi, (full, entity) => {
        const normalizedEntity = String(entity).toLowerCase();
        if (normalizedEntity in NAMED_HTML_ENTITIES) {
            return NAMED_HTML_ENTITIES[normalizedEntity];
        }
        if (normalizedEntity.startsWith("#x")) {
            const codePoint = parseInt(normalizedEntity.slice(2), 16);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : full;
        }
        if (normalizedEntity.startsWith("#")) {
            const codePoint = parseInt(normalizedEntity.slice(1), 10);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : full;
        }
        return full;
    });
}
