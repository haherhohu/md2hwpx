# Markdown to HWPX Converter

Working with government agencies is very difficult.

This extension was created to address requests from users who primarily use Markdown, asking them to "please send the file as a Hangul file."

This is an extension that converts Markdown (.md) documents written in VS Code into Hangul (.hwpx) documents. It performs the conversion in compliance with the strict OWPML (Hangul Standard XML) specifications.

## Key Features

- **One-Click HWPX Export:** Converts `.md` files in VS Code into OWPML-compliant `.hwpx` files in the same folder.
- **Typography & Inline Styles:** Supports `H1`–`H6`, `**bold**`, `*italic*`, `~~strikethrough~~`, `<u>underline</u>`, `<sup>`/`<sub>`, and Korean particle / Unicode punctuation boundaries (e.g., `**단어(ABC)**가`, `**기관(DEF)**·`) without misparsing inline code, URLs, or single-tilde ranges (`1~3`).
- **Multilevel Lists & Callouts:** Converts 6-level nested lists with hanging indents, renders blockquotes and fenced code blocks as left-aligned callout boxes, and handles horizontal rules (`---`) and page breaks (`---` × 2).
- **Tables & Captions:** Converts Markdown and HTML tables with column alignment, `<br>` line splits, 2D cell merges (`^`, `<`, `\\`), cell-level page breaks, and automatic top/bottom captions (`[표 1-1]`, `[그림 1-1]`).
- **Images & 300 DPI SVG:** Embeds local images (PNG/JPEG/GIF/WebP) preserving original dimensions and aspect ratios, renders `.svg` files and inline `<svg>` diagrams at 300 DPI PNG via `@resvg/resvg-wasm`, and generates visible placeholders for missing images.
- **Native Math Equations:** Converts inline (`$...$`) and block (`$$...$$`) LaTeX math into native Hangul equation objects.
- **Links & Footnotes:** Renders Markdown links and raw URLs as clickable hyperlinks, and converts footnotes (`[^1]`) into superscript bookmark links with left-aligned hanging-indent endnotes.

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

### 0.0.5

- Re-architected the parser and renderer into a modular `marked` AST pipeline (`StyleRegistry`, `TableRenderer`, `ImageRenderer`, `InlineRenderer`) with centralized constants (`hwpxConstants.ts`).
- Added native LaTeX-to-HWP equation (`<hp:equation>`) conversion and 2D table cell merging (`^`, `<`, `\\`) with column alignment support.
- Added binary image dimension parsing (PNG/JPEG/GIF/WebP) to preserve natural image sizes and aspect ratios, plus visible 800×450 placeholder PNGs for all missing image formats.
- Fixed single-tilde range false strikethroughs (`~~` only), Unicode punctuation emphasis boundaries (`·`, quotes), crossed overlapping emphasis (`~~...**...~~...**`), and contiguous `paraPr` hanging indents / left alignment for endnotes.
- Improved multi-page table splitting ("셀 단위로 나눔") and merged-table column width balancing with a ~2.4-character minimum column width safeguard.

You can view the full update history in [CHANGELOG.md](CHANGELOG.md)

## License

MIT License
