const COMMAND_MAP: Record<string, string> = {
    // Lowercase Greek
    alpha: "alpha",
    beta: "beta",
    gamma: "gamma",
    delta: "delta",
    epsilon: "epsilon",
    varepsilon: "varepsilon",
    zeta: "zeta",
    eta: "eta",
    theta: "theta",
    vartheta: "vartheta",
    iota: "iota",
    kappa: "kappa",
    lambda: "lambda",
    mu: "mu",
    nu: "nu",
    xi: "xi",
    pi: "pi",
    varpi: "varpi",
    rho: "rho",
    varrho: "varrho",
    sigma: "sigma",
    varsigma: "varsigma",
    tau: "tau",
    upsilon: "upsilon",
    phi: "phi",
    varphi: "varphi",
    chi: "chi",
    psi: "psi",
    omega: "omega",

    // Uppercase Greek (Hancom HWP equation keywords)
    Gamma: "GAMMA",
    Delta: "DELTA",
    Theta: "THETA",
    Lambda: "LAMBDA",
    Xi: "XI",
    Pi: "PI",
    Sigma: "SIGMA",
    Upsilon: "UPSILON",
    Phi: "PHI",
    Psi: "PSI",
    Omega: "OMEGA",

    // Big operators & functions
    sum: "sum",
    prod: "prod",
    coprod: "coprod",
    int: "int",
    iint: "dint",
    iiint: "tint",
    oint: "oint",
    lim: "lim",
    limsup: "limsup",
    liminf: "liminf",
    sup: "sup",
    inf: "inf",
    max: "max",
    min: "min",
    arg: "arg",
    det: "det",
    dim: "dim",
    gcd: "gcd",
    exp: "exp",
    log: "log",
    ln: "ln",
    lg: "lg",
    sin: "sin",
    cos: "cos",
    tan: "tan",
    cot: "cot",
    sec: "sec",
    csc: "csc",
    arcsin: "arcsin",
    arccos: "arccos",
    arctan: "arctan",
    sinh: "sinh",
    cosh: "cosh",
    tanh: "tanh",
    Pr: "Pr",

    // Binary / relational / misc symbols
    infty: "inf",
    pm: "+-",
    mp: "-+",
    times: "times",
    div: "div",
    cdot: "cdot",
    ast: "*",
    star: "star",
    circ: "deg",
    degree: "deg",
    bullet: "bullet",
    oplus: "oplus",
    otimes: "otimes",
    leq: "<=",
    le: "<=",
    geq: ">=",
    ge: ">=",
    neq: "!=",
    ne: "!=",
    approx: "approx",
    equiv: "equiv",
    sim: "sim",
    simeq: "simeq",
    cong: "cong",
    propto: "propto",
    ll: "<<",
    gg: ">>",
    subset: "subset",
    supset: "supset",
    subseteq: "subseteq",
    supseteq: "supseteq",
    in: "in",
    notin: "notin",
    ni: "ni",
    cup: "cup",
    cap: "cap",
    setminus: "setminus",
    emptyset: "emptyset",
    varnothing: "emptyset",
    forall: "forall",
    exists: "exists",
    neg: "not",
    lnot: "not",
    land: "and",
    lor: "or",
    implies: "=>",
    iff: "<=>",
    to: "->",
    rightarrow: "->",
    leftarrow: "<-",
    leftrightarrow: "<->",
    Rightarrow: "=>",
    Leftarrow: "<=",
    Leftrightarrow: "<=>",
    mapsto: "mapsto",
    partial: "partial",
    nabla: "nabla",
    mid: "|",
    parallel: "||",
    perp: "bot",
    angle: "angle",
    triangle: "triangle",
    dots: "ldots",
    ldots: "ldots",
    cdots: "cdots",
    vdots: "vdots",
    ddots: "ddots",
    prime: "'",
    hbar: "hbar",
    ell: "ell",
    Re: "Re",
    Im: "Im",
    aleph: "aleph",
};

const DELIMITER_MAP: Record<string, string> = {
    "(": "(",
    ")": ")",
    "[": "[",
    "]": "]",
    "{": "lbrace",
    "}": "rbrace",
    "\\{": "lbrace",
    "\\}": "rbrace",
    "|": "|",
    "\\|": "||",
    ".": ".",
    "\\langle": "<",
    "\\rangle": ">",
    "\\lfloor": "lfloor",
    "\\rfloor": "rfloor",
    "\\lceil": "lceil",
    "\\rceil": "rceil",
};

const ACCENT_MAP: Record<string, string> = {
    hat: "hat",
    widehat: "hat",
    bar: "bar",
    overline: "bar",
    vec: "vec",
    overrightarrow: "vec",
    tilde: "tilde",
    widetilde: "tilde",
    dot: "dot",
    ddot: "ddot",
    underline: "under",
};

const TEXT_COMMANDS = new Set(["text", "mathrm", "textrm", "operatorname", "mbox"]);
const BOLD_COMMANDS = new Set(["mathbf", "boldsymbol", "bm", "textbf"]);
const ITALIC_COMMANDS = new Set(["mathit", "textit"]);
const PASS_THROUGH_STYLE_COMMANDS = new Set(["mathsf", "mathcal", "mathbb", "mathfrak", "mathnormal"]);

class LatexToHwpParser {
    private readonly src: string;
    private pos = 0;

    public constructor(src: string) {
        this.src = src;
    }

    public parse(): string {
        return this.normalizeOutput(this.parseUntil(this.src.length));
    }

    private parseUntil(limit: number): string {
        const parts: string[] = [];

        while (this.pos < limit) {
            const ch = this.src[this.pos];

            if (/\s/.test(ch)) {
                while (this.pos < limit && /\s/.test(this.src[this.pos])) {
                    this.pos += 1;
                }
                parts.push(" ");
                continue;
            }

            if (ch === "{") {
                const group = this.readBraceGroup();
                const inner = group !== undefined ? convertLatexToHwpScript(group) : "";
                parts.push(`{${inner}}`);
                continue;
            }

            if (ch === "^" || ch === "_") {
                this.pos += 1;
                const arg = this.readArgument();
                const converted = this.convertScriptArg(arg);
                parts.push(` ${ch}{${converted}}`);
                continue;
            }

            if (ch === "\\") {
                parts.push(this.parseBackslashCommand(limit));
                continue;
            }

            parts.push(ch);
            this.pos += 1;
        }

        return parts.join("");
    }

    private convertScriptArg(arg: string): string {
        const trimmed = arg.trim();
        if (trimmed === "\\circ") {
            return "deg";
        }
        return convertLatexToHwpScript(trimmed);
    }

    private parseBackslashCommand(limit: number): string {
        if (this.pos + 1 >= limit) {
            this.pos += 1;
            return "";
        }

        const nextCh = this.src[this.pos + 1];
        if (!/[A-Za-z]/.test(nextCh)) {
            this.pos += 2;
            switch (nextCh) {
                case "{":
                    return "lbrace ";
                case "}":
                    return "rbrace ";
                case "|":
                    return "||";
                case "%":
                    return "%";
                case "_":
                    return "_";
                case "&":
                    return "&";
                case "#":
                    return "#";
                case "$":
                    return "$";
                case ",":
                case ";":
                case ":":
                    return "`";
                case " ":
                case "~":
                    return "~";
                case "!":
                    return "";
                case "\\":
                    return " # ";
                default:
                    return nextCh;
            }
        }

        let end = this.pos + 1;
        while (end < limit && /[A-Za-z]/.test(this.src[end])) {
            end += 1;
        }
        const cmd = this.src.slice(this.pos + 1, end);
        this.pos = end;

        if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
            const numerator = this.readArgument();
            const denominator = this.readArgument();
            return `{{${convertLatexToHwpScript(numerator)}} over {${convertLatexToHwpScript(denominator)}}}`;
        }

        if (cmd === "binom" || cmd === "dbinom" || cmd === "tbinom") {
            const top = this.readArgument();
            const bottom = this.readArgument();
            return `{{${convertLatexToHwpScript(top)}} choose {${convertLatexToHwpScript(bottom)}}}`;
        }

        if (cmd === "sqrt") {
            const nth = this.readBracketGroup();
            const radicand = this.readArgument();
            const convRadicand = convertLatexToHwpScript(radicand);
            if (nth !== undefined) {
                return `root {${convertLatexToHwpScript(nth)}} of {${convRadicand}}`;
            }
            return `sqrt {${convRadicand}}`;
        }

        if (cmd === "underbrace" || cmd === "overbrace") {
            const body = this.readArgument();
            const convBody = convertLatexToHwpScript(body);
            const decorator = cmd === "underbrace" ? "under" : "bar";
            const expectedScript = cmd === "underbrace" ? "_" : "^";
            this.skipSpaces();
            if (this.pos < limit && this.src[this.pos] === expectedScript) {
                this.pos += 1;
                const label = this.readArgument();
                return `{${decorator} {${convBody}}} ${expectedScript}{${convertLatexToHwpScript(label)}}`;
            }
            return `${decorator} {${convBody}}`;
        }

        if (cmd === "left" || cmd === "right") {
            const delim = this.readDelimiter();
            return ` ${cmd} ${delim} `;
        }

        if (cmd === "begin") {
            const envName = (this.readBraceGroup() ?? "").trim();
            return this.parseEnvironment(envName, limit);
        }

        if (TEXT_COMMANDS.has(cmd)) {
            const rawText = this.readArgument();
            const cleanText = this.unescapeTextCommandContent(rawText).replace(/"/g, "'");
            return ` rm "${cleanText}" `;
        }

        if (BOLD_COMMANDS.has(cmd)) {
            const inner = this.readArgument();
            return ` bold {${convertLatexToHwpScript(inner)}} `;
        }

        if (ITALIC_COMMANDS.has(cmd)) {
            const inner = this.readArgument();
            return ` it {${convertLatexToHwpScript(inner)}} `;
        }

        if (PASS_THROUGH_STYLE_COMMANDS.has(cmd)) {
            const inner = this.readArgument();
            return `{${convertLatexToHwpScript(inner)}}`;
        }

        if (ACCENT_MAP[cmd]) {
            const inner = this.readArgument();
            return ` ${ACCENT_MAP[cmd]} {${convertLatexToHwpScript(inner)}} `;
        }

        if (cmd === "quad") {
            return "~";
        }
        if (cmd === "qquad") {
            return "~~";
        }
        if (cmd === "displaystyle" || cmd === "textstyle" || cmd === "scriptstyle") {
            return "";
        }

        if (COMMAND_MAP[cmd]) {
            return ` ${COMMAND_MAP[cmd]} `;
        }

        return ` ${cmd} `;
    }

    private parseEnvironment(envName: string, limit: number): string {
        const endMarker = `\\end{${envName}}`;
        const beginMarker = `\\begin{${envName}}`;
        let depth = 1;
        let scan = this.pos;

        while (scan < limit) {
            if (this.src.startsWith(beginMarker, scan)) {
                depth += 1;
                scan += beginMarker.length;
                continue;
            }
            if (this.src.startsWith(endMarker, scan)) {
                depth -= 1;
                if (depth === 0) {
                    const body = this.src.slice(this.pos, scan);
                    this.pos = scan + endMarker.length;
                    return this.convertEnvironmentBody(envName, body);
                }
                scan += endMarker.length;
                continue;
            }
            scan += 1;
        }

        const remaining = this.src.slice(this.pos, limit);
        this.pos = limit;
        return this.convertEnvironmentBody(envName, remaining);
    }

    private convertEnvironmentBody(envName: string, body: string): string {
        const rows = this.splitTopLevelRows(body)
            .map((row) => row.trim())
            .filter((row) => row.length > 0);

        const convertedRows = rows.map((row) => {
            const cols = this.splitTopLevelColumns(row).map((cell) => convertLatexToHwpScript(cell));
            return cols.join(" & ");
        });

        const matrixContent = convertedRows.join(" # ");
        switch (envName) {
            case "pmatrix":
                return ` left ( matrix { ${matrixContent} } right ) `;
            case "bmatrix":
                return ` left [ matrix { ${matrixContent} } right ] `;
            case "Bmatrix":
                return ` left lbrace matrix { ${matrixContent} } right rbrace `;
            case "vmatrix":
                return ` left | matrix { ${matrixContent} } right | `;
            case "Vmatrix":
                return ` left || matrix { ${matrixContent} } right || `;
            case "cases":
                return ` cases { ${matrixContent} } `;
            case "aligned":
            case "align":
            case "align*":
            case "gathered":
            case "gather":
                return ` eqalign { ${matrixContent} } `;
            default:
                return ` matrix { ${matrixContent} } `;
        }
    }

    private splitTopLevelRows(body: string): string[] {
        const rows: string[] = [];
        let braceDepth = 0;
        let start = 0;
        let i = 0;
        while (i < body.length) {
            const ch = body[i];
            if (ch === "\\" && body[i + 1] === "\\" && braceDepth === 0) {
                rows.push(body.slice(start, i));
                i += 2;
                start = i;
                continue;
            }
            if (ch === "\\" && i + 1 < body.length) {
                i += 2;
                continue;
            }
            if (ch === "{") {
                braceDepth += 1;
            } else if (ch === "}") {
                braceDepth = Math.max(0, braceDepth - 1);
            }
            i += 1;
        }
        rows.push(body.slice(start));
        return rows;
    }

    private splitTopLevelColumns(row: string): string[] {
        const cols: string[] = [];
        let braceDepth = 0;
        let start = 0;
        let i = 0;
        while (i < row.length) {
            const ch = row[i];
            if (ch === "&" && braceDepth === 0) {
                cols.push(row.slice(start, i));
                i += 1;
                start = i;
                continue;
            }
            if (ch === "\\" && i + 1 < row.length) {
                i += 2;
                continue;
            }
            if (ch === "{") {
                braceDepth += 1;
            } else if (ch === "}") {
                braceDepth = Math.max(0, braceDepth - 1);
            }
            i += 1;
        }
        cols.push(row.slice(start));
        return cols;
    }

    private readDelimiter(): string {
        this.skipSpaces();
        if (this.pos >= this.src.length) {
            return ".";
        }
        if (this.src[this.pos] === "\\") {
            let end = this.pos + 1;
            if (end < this.src.length && /[A-Za-z]/.test(this.src[end])) {
                while (end < this.src.length && /[A-Za-z]/.test(this.src[end])) {
                    end += 1;
                }
            } else if (end < this.src.length) {
                end += 1;
            }
            const raw = this.src.slice(this.pos, end);
            this.pos = end;
            return DELIMITER_MAP[raw] ?? raw.replace(/^\\/, "");
        }
        const ch = this.src[this.pos];
        this.pos += 1;
        return DELIMITER_MAP[ch] ?? ch;
    }

    private readArgument(): string {
        this.skipSpaces();
        if (this.pos >= this.src.length) {
            return "";
        }
        if (this.src[this.pos] === "{") {
            return this.readBraceGroup() ?? "";
        }
        if (this.src[this.pos] === "\\") {
            let end = this.pos + 1;
            if (end < this.src.length && /[A-Za-z]/.test(this.src[end])) {
                while (end < this.src.length && /[A-Za-z]/.test(this.src[end])) {
                    end += 1;
                }
            } else if (end < this.src.length) {
                end += 1;
            }
            const rawCmd = this.src.slice(this.pos, end);
            this.pos = end;
            return rawCmd;
        }
        const single = this.src[this.pos];
        this.pos += 1;
        return single;
    }

    private readBraceGroup(): string | undefined {
        this.skipSpaces();
        if (this.pos >= this.src.length || this.src[this.pos] !== "{") {
            return undefined;
        }
        const start = this.pos + 1;
        let depth = 1;
        let scan = start;

        while (scan < this.src.length) {
            const ch = this.src[scan];
            if (ch === "\\" && scan + 1 < this.src.length) {
                scan += 2;
                continue;
            }
            if (ch === "{") {
                depth += 1;
            } else if (ch === "}") {
                depth -= 1;
                if (depth === 0) {
                    const content = this.src.slice(start, scan);
                    this.pos = scan + 1;
                    return content;
                }
            }
            scan += 1;
        }

        const content = this.src.slice(start);
        this.pos = this.src.length;
        return content;
    }

    private readBracketGroup(): string | undefined {
        this.skipSpaces();
        if (this.pos >= this.src.length || this.src[this.pos] !== "[") {
            return undefined;
        }
        const start = this.pos + 1;
        let depth = 1;
        let scan = start;

        while (scan < this.src.length) {
            const ch = this.src[scan];
            if (ch === "\\" && scan + 1 < this.src.length) {
                scan += 2;
                continue;
            }
            if (ch === "[") {
                depth += 1;
            } else if (ch === "]") {
                depth -= 1;
                if (depth === 0) {
                    const content = this.src.slice(start, scan);
                    this.pos = scan + 1;
                    return content;
                }
            }
            scan += 1;
        }

        return undefined;
    }

    private skipSpaces(): void {
        while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) {
            this.pos += 1;
        }
    }

    private unescapeTextCommandContent(raw: string): string {
        return raw.replace(/\\([_%&#${}])/g, "$1");
    }

    private normalizeOutput(raw: string): string {
        // Collapse extra whitespace only outside double-quoted `rm "..."` segments
        const segments = raw.split(/("[^"]*")/g);
        return segments
            .map((seg, idx) => {
                if (idx % 2 === 1) {
                    return seg;
                }
                return seg
                    .replace(/[ \t]+/g, " ")
                    .replace(/\{\s+/g, "{")
                    .replace(/\s+\}/g, "}")
                    .replace(/\s+,/g, ",");
            })
            .join("")
            .trim();
    }
}

/**
 * Recursively parses balanced-brace LaTeX math into Hancom Office HWP Equation Script.
 */
export function convertLatexToHwpScript(latex: string): string {
    const trimmed = latex.trim();
    if (!trimmed) {
        return "";
    }
    return new LatexToHwpParser(trimmed).parse();
}
