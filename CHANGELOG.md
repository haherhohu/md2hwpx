# Change Log

All major updates and bug fixes are recorded here.

## [0.0.4]

### Added

- **Native HWPX LaTeX Equations (`<hp:equation>`):** Added a recursive LaTeX-to-HWP equation script converter (`src/math/latexToHwpEqn.ts`) and native `<hp:equation><hp:script>` rendering for inline (`$...$`) and block (`$$...$$`) math, supporting nested fractions, roots, sums/integrals, matrices, `cases`, and Greek symbols.
- **Binary Image Sizing & Missing-Image Placeholders:** Added pure-Node header parsing for PNG, JPEG, GIF, and WebP (`src/image/imageSizeParser.ts`) to keep small images at 100% natural size and shrink oversized images proportionally within page width/height; generated visible 800×450 placeholder PNGs for all missing image formats (`.png`, `.jpg`, `.svg`, etc.) instead of blank 1×1 pixels.
- **2D Table Cell Merging & Column Alignment:** Added a grid merge engine (`src/renderers/tableGridEngine.ts`) supporting vertical merges (`^`), horizontal merges (`<`), and explicit cell line breaks (`\\`), plus Markdown column alignment (`:---`, `:---:`, `---:`, defaulting headers to center and body cells to left).
- **Automated Verification Suite:** Added unit tests (`npm run test:unit`, 60 tests) and local fixture verification (`npm run verify:local`) covering AST boundaries, Korean preprocessing, image sizing, LaTeX conversion, table merging, and `xmllint` XML validation.

### Changed

- **AST-First Parsing & Modular Renderer Architecture:** Replaced regex-based inline parsing (`parseInlineToRuns`) with recursive `marked` AST traversal (`src/renderers/inlineRenderer.ts`) and custom tokenizer extensions (`src/pipeline/markdownExtensions.ts`), and split rendering into focused modules (`StyleRegistry`, `TableRenderer`, `ImageRenderer`, `InlineRenderer`, `hwpxConstants.ts`).
- **Codebase Cleanup & Constant Consolidation:** Removed unused dead state/helpers (`linkObjects` / `registerLinkObject`), deduplicated hyperlink/table/borderFill/entity XML builders, and centralized HWPX layout and style constants in `src/hwpxConstants.ts` and `src/tokenUtils.ts`.

### Fixed

- **Double-Tilde Strikethrough, Unicode Punctuation & Crossed Emphasis:** Restricted strikethrough parsing to exact `~~...~~` (preventing single-tilde ranges like `Phase 1~3` or `5,000만~1.8억` from turning into strikethrough), extended closing/opening delimiter boundaries to non-ASCII punctuation (`·`, `「`, `」`, etc.), and split crossed overlapping emphasis (`~~...**...~~...**`) into properly nested AST spans.
- **Endnote Hanging Indent (Shift+Tab) & Left Alignment:** Replaced non-contiguous `paraPr id="1050"` with contiguous 0-based `paraPr` IDs (`itemCnt`-aligned) so Hancom HWP reliably applies `LEFT` alignment, `BREAK_WORD`, `autoTabLeft`, `<hp:tab>`, and `HwpUnitChar` (`-2200`) / `default` (`-4400`, 2×) hanging indents to endnotes and nested lists.
- **Block Boundaries, Callouts & Inline Media:** Fixed blockquote lazy continuation and pipe-table boundaries without blank lines, preserved AST tokens across captions and HTML tables, rendered blockquotes recursively with `LEFT` alignment, embedded inline images inside paragraphs/tables as `<hp:pic>`, and rendered fenced code blocks literally inside left-aligned callouts.

## [0.0.3] - Hotfix

### Fixed

- **Extension Activation & Packaging Hotfix (`Cannot find module '@resvg/resvg-js'` in v0.0.2):**
  - Fixed a critical activation error in v0.0.2 where the packaged `.vsix` extension failed to load because `@resvg/resvg-js` was marked as `external` in `esbuild.js` while `node_modules/**` was excluded by `.vscodeignore`.
  - Migrated the SVG-to-PNG rendering engine from OS-specific native binaries (`@resvg/resvg-js`) to universal WebAssembly (**`@resvg/resvg-wasm`**).
  - Updated `esbuild.js` to bundle `@resvg/resvg-wasm` directly into `dist/extension.js` (`external: ['vscode']` only) and automatically copy `index_bg.wasm` to `dist/index_bg.wasm`, eliminating all runtime `node_modules` dependencies and enabling a single universal `.vsix` package to run across macOS, Windows, and Linux.
  - Added asynchronous WebAssembly module initialization (`HwpxXmlRenderer.ensureWasmInitialized()`), cached in-memory system font buffers (`fontBuffers`), and explicit WASM memory deallocation (`rendered.free()`, `resvg.free()`) after each SVG render.

## [0.0.2]

### Added

- **Images & 300 DPI SVG Rendering:**
  - Embedded Markdown images (`![alt](path)`) and inline `<svg>...</svg>` blocks as native `<hp:pic>` nodes in `section0.xml`, packaged into `BinData/` and registered in `Contents/content.hpf` (`<opf:manifest>`) with automatic deduplication.
  - Integrated `@resvg/resvg-js` to rasterize `.svg` files and inline SVG diagrams into 300 DPI PNG images (`pHYs` chunk set to `11811 pixels/meter`) with OS CJK/Latin/symbol font fallbacks (`Malgun Gothic`, `Apple SD Gothic Neo`, `NanumGothic`, `Helvetica`, `Arial`, `Apple Symbols`, `Segoe UI Symbol`, `DejaVu Sans`).
  - Normalized SVG 2 `<marker orient="auto-start-reverse">` definitions to SVG 1.1 `orient="auto"` (plus auto-generated 180°-rotated `<marker id="...__start_rev">` clones when `marker-start` is used) so arrowheads follow vertical, diagonal, and bidirectional line angles accurately.

- **Native Table & Image Captions (`<hp:caption>`):**
  - Automatically bound `[표 1-1] ...`, `[표 1] ...`, and `[요약표 1] ...` lines preceding or following a table as top `<hp:caption side="TOP">` captions formatted as `표 1-1.`, `표 1.`, `요약표 1.`.
  - Automatically attached image alt text (`![그림 1-1 ...](...)`) as bottom `<hp:caption side="BOTTOM">` captions mapped to the template's `캡션` style (`styleIDRef="21"`, `paraPrIDRef="19"`).

- **Clickable Hyperlinks, Superscript Footnotes & Hanging-Indent References:**
  - Converted Markdown links (`[label](url)`) and raw URLs (`https://...`) into clickable underlined HWPX `HYPERLINK` field controls (`<hp:fieldBegin type="HYPERLINK">`).
  - Converted Markdown footnotes (`[^1]`, `[^REF-01]`) into superscript (`<hh:supscript>1</hh:supscript>`) bookmark hyperlinks (`?ref_N`) linked to `<hp:bookmark name="ref_N"/>` definitions at the end of the document.
  - Added hanging-indent paragraph style (`paraPr id="1050"`, `intent="-1800" left="1800"`) for footnote and reference lists.

- **Typography, LaTeX Math & Horizontal Rules:**
  - Extended heading support to `H1`–`H6` and added dynamic `<hh:charPr>` generation for combinatorial inline styles (`bold`, `italic`, `strike`, `underline`, `supscript`, `subscript`).
  - Added custom inline parser handling `**Bold**`, `*Italic*`, `_Italic_`, and `~~Strikethrough~~` immediately followed by Korean particles while protecting underscores inside inline code and URLs.
  - Added LaTeX math (`$...$`, `$$...$$`) normalization to Unicode symbols and superscript/subscript runs.
  - Rendered single horizontal rules (`---`) as selectable 0.5mm `<hp:line width="141" treatAsChar="1">` objects with `<hp:linesegarray>`, while keeping consecutive `---` rules as page breaks (`pageBreak="1"`).

### Fixed

- **Table Right-Margin Overflow & Multi-Page Splitting:**
  - Dynamically extracted printable body width (`42520 hwpunit` = `150mm`) from `<hp:pagePr>` and `<hp:margin>` in `section0.xml`, removed the `1410 hwpunit` (`5mm`) left/right `<hp:outMargin>`, and changed `<hp:tbl pageBreak="CELL">` so tables fit the exact page margins and split cleanly across pages.
  - Split `<br>`, `<br/>`, and `</br>` tags inside table cells into multiple `<hp:p>` paragraphs while preserving enclosing `**...**` emphasis across lines.

- **Template Initial Blank Line Removal:**
  - Merged the template's initial `<hp:secPr>` and `<hp:colPr>` run directly into the first generated content paragraph so no empty line precedes the document title.

- **OWPML `header.xml` Schema Ordering:**
  - Injected custom `<hh:borderFill>` definitions inside `<hh:borderFills>` with updated `itemCnt` (instead of appending `<hh:borderFillList>` after `<hh:compatibleDocument>`) to prevent HWPX load failures when paragraphs carry `pageBreak="1"`.

## [0.0.1] - Initial Release

### Added (New Additions)

- **Core:** Implementation of a core conversion engine that reads Markdown text and exports it to HWPX files
- **Typography:** Added parsing and conversion features for headings (H1: 16pt, H2: 14pt, H3: 12pt), bold, and underline styles
- **Lists:** Added analysis of nested lists and insertion of level-specific symbols (□, ◦, •)
- **Tables:** Added a feature to convert Markdown tables and quotes (`>`) into native Korean tables (`<hp:tbl>`)
- **Command:** Registration of the `Export to HWP` command via the command palette

### Fixed (Bug Fixes and Stabilization)

- **XML Integrity:** Fixed a critical bug where the entire file would not open due to the destruction of the existing tag order when dynamically injecting styles (`charPr`, `paraPr`) (Regular expression (Ensuring safety through base override))
- **List Indentation:** Fixed an issue where multiple lists were treated as simple text spaces, and implemented perfect indentation by dynamically injecting native Korean paragraph formatting (left margin).
- **Table Layout:** Fixed an issue where rendering was ignored (vanished) when table objects were included inside the `<hp:run>` tag, and standardized table margins (`inMargin`, `outMargin`).

- **ID Collision:** Eliminated the risk of collisions when documents became long due to random ID issuance, and introduced a sequential ID issuance system starting from 1,000,000,000.
- **Resolved HWPX Table Object Rendering Missing Issue**
  - Normalized the document structure to reflect the strict hierarchical specifications of the HWPX parser, ensuring that `<hp:tbl>` objects are correctly wrapped inside `<hp:p>` and `<hp:run>` tags. - Resolved a critical error where the parser stopped generating tables by forcing the placement order of internal child tags within cells (`<hp:tc>`) to conform to the OWPML standard specification (placing the data `<hp:subList>` with the highest priority).

- **Fixed table width reduction and left-biased placement**
  - By applying the HWPX hwpunit standard, the default width of tables has been adjusted to match the available standard A4 width (approx. 170mm, 42000 units) to fill the page layout.

- **Resolved table border transparency and non-printing errors**
  - Added injection logic to dynamically inject a solid border style into the `<hh:borderFills>` area of ​​`header.xml` during conversion. (Full support for the `hh:` namespace structure)
  - Normalized the line type attribute to PascalCase (`Solid`) to reflect the case strictness of the OWPML parser, and modified the color code to the standard hex code (`#000000`).
  - Improved the logic to explicitly enable top, bottom, left, and right border visibility at the individual cell level (`<hp:tcPr>`), separate from the parent table attribute.

- **Fixed an issue where second-line indentation (Hanging Indent) and margins could not be applied during list conversion**
  - **Issue:** Resolved the issue where second-line text did not automatically align to the list marker width (Shift+Tab effect) during Markdown list conversion.

  - **Cause:**
    1. The HWPX (OWPML) rendering engine structurally ignores inline margins (`<hp:margin>` inside `<hp:pPr>`) declared directly within the body (`<hp:p>`).
    2. When non-standard attributes (`top`, `bottom`, etc.) are mixed within the `<hp:margin>` tag, the engine omits the tag from rendering.

  - **Solution:** Discontinue the inline formatting method and change the rendering architecture to the **Static Template Mapping** method.
    - Predefine paragraph style attributes (`<hh:paraPr>`) for each list depth (Depth 1, 2, 3...) within the `<hh:paraProperties>` of the `header.xml` template.
    - (e.g., `left="2000" intent="-2000" prev="0" next="0"`)
    - Modify parser logic when parsing the body (`section0.xml`) to calculate the depth of the Markdown list and connect only the unique IDs (`paraPrIDRef`) of the predefined paragraph styles.

---

_Enjoy seamless Markdown to HWPX conversion!_
