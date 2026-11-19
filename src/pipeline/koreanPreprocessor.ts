const FENCE_OPEN_REGEX = /^\s*(`{3,}|~{3,})/;

interface DelimiterOpener {
    kind: "*" | "_" | "~";
    len: number;
}

/**
 * Strips invisible Korean emphasis boundary sentinels before emitting HWPX text.
 */
export function stripKoreanSentinels(text: string): string {
    return text.replace(/[\u200B\uFEFF]/g, "");
}

function protectCodeFences(
    markdown: string,
    protect: (segment: string) => string,
): string {
    const lines = markdown.split(/\r?\n/);
    const out: string[] = [];
    let fenceChar: string | undefined;
    let fenceLen = 0;
    let fenceBuffer: string[] = [];

    for (const line of lines) {
        if (!fenceChar) {
            const match = line.match(FENCE_OPEN_REGEX);
            if (match) {
                fenceChar = match[1][0];
                fenceLen = match[1].length;
                fenceBuffer = [line];
                continue;
            }
            out.push(line);
        } else {
            fenceBuffer.push(line);
            const closeRegex = new RegExp(`^\\s*${fenceChar}{${fenceLen},}\\s*$`);
            if (closeRegex.test(line)) {
                out.push(protect(fenceBuffer.join("\n")));
                fenceChar = undefined;
                fenceLen = 0;
                fenceBuffer = [];
            }
        }
    }

    if (fenceBuffer.length > 0) {
        out.push(protect(fenceBuffer.join("\n")));
    }

    return out.join("\n");
}

function protectInlineCodeSpans(
    text: string,
    protect: (segment: string) => string,
): string {
    let result = "";
    let cursor = 0;

    while (cursor < text.length) {
        const tickStart = text.indexOf("`", cursor);
        if (tickStart === -1) {
            result += text.slice(cursor);
            break;
        }

        result += text.slice(cursor, tickStart);
        let tickEnd = tickStart;
        while (tickEnd < text.length && text[tickEnd] === "`") {
            tickEnd += 1;
        }
        const fence = text.slice(tickStart, tickEnd);
        const closeIdx = findClosingBackticks(text, tickEnd, fence.length);
        if (closeIdx === -1) {
            result += fence;
            cursor = tickEnd;
        } else {
            const fullSpan = text.slice(tickStart, closeIdx + fence.length);
            result += protect(fullSpan);
            cursor = closeIdx + fence.length;
        }
    }

    return result;
}

function findClosingBackticks(text: string, fromIdx: number, expectedLen: number): number {
    let idx = fromIdx;
    while (idx < text.length) {
        const nextTick = text.indexOf("`", idx);
        if (nextTick === -1) {
            return -1;
        }
        let end = nextTick;
        while (end < text.length && text[end] === "`") {
            end += 1;
        }
        if (end - nextTick === expectedLen) {
            return nextTick;
        }
        idx = end;
    }
    return -1;
}

function insertBoundarySentinelsInParagraph(paragraph: string): string {
    const tokens: Array<{
        kind: "*" | "_" | "~";
        len: number;
        pos: number;
        end: number;
        canOpen: boolean;
        canClose: boolean;
        next: string;
    }> = [];

    const delimRegex = /\\.|(\*+|_+|~~)/g;
    for (const match of paragraph.matchAll(delimRegex)) {
        const delim = match[1];
        if (!delim) {
            continue;
        }
        const pos = match.index ?? 0;
        const prev = pos > 0 ? paragraph[pos - 1] : "";
        const next = pos + delim.length < paragraph.length ? paragraph[pos + delim.length] : "";
        const prevSpace = prev === "" || /\s/.test(prev);
        const nextSpace = next === "" || /\s/.test(next);
        const kind = delim[0] as "*" | "_" | "~";

        let canOpen = !nextSpace;
        const canClose = !prevSpace;
        if (kind === "_") {
            const prevAsciiWord = /[A-Za-z0-9]/.test(prev);
            canOpen = !nextSpace && !prevAsciiWord;
        }

        tokens.push({
            kind,
            len: delim.length,
            pos,
            end: pos + delim.length,
            canOpen,
            canClose,
            next,
        });
    }

    const stack: DelimiterOpener[] = [];
    const insertOffsets = new Set<number>();

    for (const tok of tokens) {
        let remaining = tok.len;
        let closedAny = false;

        if (tok.canClose) {
            // Check whether stack contains an exact-length opener of the same kind,
            // or whether this run can legitimately consume multiple stacked openers (e.g. *** closing ** and *)
            const hasExactOpener = stack.some((o) => o.kind === tok.kind && o.len === remaining);
            let totalMatchingLen = 0;
            for (let s = stack.length - 1; s >= 0 && stack[s].kind === tok.kind; s -= 1) {
                totalMatchingLen += stack[s].len;
            }

            if (hasExactOpener || (tok.kind === "*" && remaining >= 2 && totalMatchingLen === remaining)) {
                while (remaining > 0) {
                    const topIdx = stack.length - 1;
                    if (topIdx < 0) {
                        break;
                    }
                    let matchIdx = -1;
                    for (let s = topIdx; s >= 0; s -= 1) {
                        if (stack[s].kind === tok.kind && (stack[s].len <= remaining || !tok.canOpen)) {
                            matchIdx = s;
                            break;
                        }
                    }
                    if (matchIdx === -1) {
                        break;
                    }
                    const opener = stack[matchIdx];
                    const consume = Math.min(remaining, opener.len);
                    remaining -= consume;
                    opener.len -= consume;
                    if (opener.len === 0) {
                        stack.splice(matchIdx, 1);
                    }
                    closedAny = true;
                }
            }

            // Insert ZWNBSP only when closing an outermost emphasis span directly before Hangul
            if (closedAny && stack.length === 0 && /[가-힣]/.test(tok.next)) {
                insertOffsets.add(tok.end);
            }
        }

        if (remaining > 0 && tok.canOpen) {
            stack.push({ kind: tok.kind, len: remaining });
        }
    }

    if (insertOffsets.size === 0) {
        return paragraph;
    }

    let out = "";
    let last = 0;
    for (const offset of Array.from(insertOffsets).sort((a, b) => a - b)) {
        out += paragraph.slice(last, offset) + "\uFEFF";
        last = offset;
    }
    out += paragraph.slice(last);
    return out;
}

/**
 * Inserts ZWNBSP (\uFEFF) after closing emphasis delimiters immediately followed
 * by a Hangul syllable so CommonMark/marked parses `*강조*는` and `**단어(ABC)**가`.
 * Protected regions (code, math, URLs, HTML tags) are never modified.
 */
export function preprocessKoreanBoundaries(mdContent: string): string {
    const cleaned = mdContent.startsWith("\uFEFF") ? mdContent.slice(1) : mdContent;
    const protectedSegments: string[] = [];
    const protect = (segment: string): string => {
        const idx = protectedSegments.length;
        protectedSegments.push(segment);
        return `\u0000KP_${idx}_\u0000`;
    };

    let working = protectCodeFences(cleaned, protect);
    working = protectInlineCodeSpans(working, protect);
    working = working.replace(/\$\$[\s\S]+?\$\$/g, (m) => protect(m));
    working = working.replace(/\$(?!\s)(?:\\.|[^$\\\n])+?(?<!\s)\$(?!\d)/g, (m) => protect(m));
    working = working.replace(/\]\((?:[^()\s]+|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g, (m) => protect(m));
    working = working.replace(/https?:\/\/[^\s)\]>]+/g, (m) => protect(m));
    working = working.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^>]*)?>/g, (m) => protect(m));

    const processed = working
        .split(/(\r?\n\s*\r?\n)/)
        .map((chunk, idx) => (idx % 2 === 0 ? insertBoundarySentinelsInParagraph(chunk) : chunk))
        .join("");

    return processed.replace(/\u0000KP_(\d+)_\u0000/g, (_full, idxStr: string) => {
        return protectedSegments[parseInt(idxStr, 10)] ?? "";
    });
}
