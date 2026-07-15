# Change Log

All major updates and bug fixes are recorded here.

## [0.0.1] - Initial Release

### Added (New Additions)

- **Core:** Implementation of a core conversion engine that reads Markdown text and exports it to HWPX files
- **Typography:** Added parsing and conversion features for headings (H1: 16pt, H2: 14pt, H3: 12pt), bold, and underline styles
- **Lists:** Added analysis of nested lists and insertion of level-specific symbols (□, ◦, •)
- **Tables:** Added a feature to convert Markdown tables and quotes (`>`) into native Korean tables (`<hp:tbl>`)
- **Command:** Registration of the `Export to HWP` command via the command palette

### Fixed (Bug Fixes and Stabilization)

- **XML Integrity:** Fixed a critical bug where the entire file would not open due to the destruction of the existing tag order when dynamically injecting styles (`charPr`, `paraPr`) (Regular expression (Ensuring safety through base override)
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
