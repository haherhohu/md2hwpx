# Markdown to HWPX Converter

Working with government agencies is very difficult.

This extension was created to address requests from users who primarily use Markdown, asking them to "please send the file as a Hangul file."

This is an extension that converts Markdown (.md) documents written in VS Code into Hangul (.hwpx) documents. It performs the conversion in compliance with the strict OWPML (Hangul Standard XML) specifications.

## Key Features

- **HWPX Conversion:** Open a Markdown file and run the command to create a `.hwpx` file in the same folder without leaving a leading blank line from the template.

- **Typography & Inline Formatting**
  - Headings (`H1`–`H6`): Mapped to bold fonts (`H1`: 16pt, `H2`: 14pt, `H3`–`H6`: 12pt)
  - Emphasis Styles: Full support for `**Bold**`, `*Italic*` / `_Italic_`, `~~Strikethrough~~`, and `<u>Underline</u>`, including markers immediately followed by Korean particles (e.g., `**단어(ABC)**가`)
  - Protects underscores inside inline code (`` `code_name` ``) and URLs from unintended italic conversion
  - Automatically prepends a single leading space to ordinary body paragraphs

- **Multilevel Lists**
  - Automatic symbol conversion based on indentation level (Level 1~6)
  - Alignment provided using the **Hangul Paragraph Margin (Shift+Tab)** hanging-indent function

- **Tables, Captions & Blockquotes**
  - Converts Markdown tables to native Hangul tables (`<hp:tbl>`) matched to the exact printable page width (`42520 hwpunit` / `150mm`) with zero horizontal outer margin (`outMargin left="0" right="0"`) and cell-level page break support (`pageBreak="CELL"`)
  - Automatically attaches `[표 1-1] ...`, `[표 1] ...`, or `[요약표 1] ...` lines above/below a table as native `<hp:caption side="TOP">` captions formatted as `표 1-1.`, `표 1.`, `요약표 1.`
  - Splits `<br>`, `<br/>`, and `</br>` inside table cells into multiple `<hp:p>` paragraphs while preserving inline styles
  - Lifts Markdown tables (`>` + `|`) and HTML `<table>` blocks inside blockquotes into real tables, and renders plain blockquotes as 1x1 callout tables

- **Images & 300 DPI SVG Rendering**
  - Embeds Markdown images (`![alt](path)`) and inline `<svg>...</svg>` blocks as native `<hp:pic>` objects in `BinData/` and `Contents/content.hpf` with automatic deduplication
  - Converts `.svg` files and inline SVG diagrams into crisp **300 DPI PNG** images (`pHYs` `11811 px/m`) cross-platform via `@resvg/resvg-js`, including SVG 2 marker orientation normalization (`orient="auto-start-reverse"` ➔ `orient="auto"` and bidirectional `marker-start` support) and OS CJK/Latin/symbol font fallback
  - Attaches image alt text (`![그림 1-1 ...](...)`) as a native bottom caption (`<hp:caption side="BOTTOM">`)

- **Links, Footnotes & References**
  - Renders Markdown links (`[label](url)`) and raw URLs (`https://...`) as clickable underlined HWPX `HYPERLINK` field controls (`<hp:fieldBegin type="HYPERLINK">`)
  - Converts Markdown footnotes (`[^1]`, `[^REF-01]`) into superscript (`<hh:supscript>`) internal bookmark links (`?ref_N`) jumping to endnote definitions (`<hp:bookmark name="ref_N"/>`)
  - Applies hanging indentation (`intent="-1800" left="1800"`) to reference and footnote lists

- **Page Flow, Horizontal Rules & LaTeX Math**
  - Single horizontal rule (`---`) is rendered as a selectable 0.5mm native line object (`<hp:line width="141" treatAsChar="1">`)
  - Consecutive horizontal rules (`---` followed by `---`) are converted to a page break (`pageBreak="1"`)
  - Normalizes inline/block LaTeX math (`$...$`, `$$...$$`) into Unicode symbols (`±`, `×`, `÷`, `≤`, `≥`, `≠`, `≈`, `∼`, `°`, Greek letters) and native superscript/subscript runs (`^`, `_`)
  - Escaped entities (`&apos;`, `&quot;`, `&lt;`, `&gt;`) and escaped star (`\*` ➔ `※`) are cleanly normalized

## Features in Plan

- Custom `.hwpx` template path configuration setting
- Mermaid diagram to image conversion and insertion
- Advanced TOC/page-number integration (use existing TOC only; add better page-number/header-jump linkage)

## How to Use

1. Open the Markdown (`.md`) file you want to convert.

2. Press `Ctrl + Shift + P` (Mac: `Cmd + Shift + P`) to open the Command Palette.

3. Search for and execute the `Export to HWPX` command.

4. When the completion notification appears in the bottom right corner, check the generated `.hwpx` file in the folder where the Markdown file was located.

## Release Notes

0.0.1

You can view the update history in CHANGELOG.md

## License

MIT License
