# Markdown to HWPX Converter

Working with government agencies is very difficult.

This extension was created to address requests from users who primarily use Markdown, asking them to "please send the file as a Hangul file."

This is an extension that converts Markdown (.md) documents written in VS Code into Hangul (.hwpx) documents. It performs the conversion in compliance with the strict OWPML (Hangul Standard XML) specifications.

## Key Features

- **hwpx Conversion:** Open a Markdown file and run the command to create a `.hwpx` file in the same folder.

- **Typography**
  - Titles (H1, H2, H3): Automatically mapped to bold fonts of 16pt, 14pt, and 12pt respectively
  - Emphasis and Underline: Full support for `**Bold**` and `<u>Underline</u>` styles

- **Multilevel Lists**
  - Automatic symbol conversion based on indentation level (Level 1~6)
  - Alignment provided using the **Hangul Paragraph Margin (Shift+Tab)** function

- **Tables & Blockquotes**
  - Converts Markdown tables to native Hangul tables (`<hp:tbl>`) (automatic distribution of borders and cell width applied)
  - If tables appear inside quotations (`>`), the table is lifted and converted as a real table
  - HTML `<table>` blocks inside quotations are also detected and converted into real tables
  - Plain quotation content remains as normal quoted text flow

- **Images**
  - Markdown image tokens are rendered as image placeholders with source path text

## Features in Plan

- Mermaid diagram to image conversion and insertion

## How to Use

1. Open the Markdown (`.md`) file you want to convert.

2. Press `Ctrl + Shift + P` (Mac: `Cmd + Shift + P`) to open the Command Palette.

3. Search for and execute the `Export to HWP` command.

4. When the completion notification appears in the bottom right corner, check the generated `.hwpx` file in the folder where the Markdown file was located.

## Release Notes

0.0.1

You can view the update history in CHANGELOG.md

## License

MIT License
