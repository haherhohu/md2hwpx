import { marked } from "marked";
import * as JSZip from "jszip";
import * as fs from "fs";

export class HwpxGenerator {
    // 동적으로 생성할 스타일 ID들을 저장하는 객체
    private styleIds = { bold: 0, ul: 0, h1: 0, h2: 0, h3: 0 };

    // ★ 추가: 문단/표 등에 부여할 고유 ID 카운터 (안전하게 10억부터 시작)
    private currentElementId: number = 1000000000;

    // ★ 수정: 랜덤 난수 대신 1씩 증가하는 순차적 ID 반환
    private generateHwpId(): number {
        return this.currentElementId++;
    }

    private generateHwpRandomId(): number {
        return Math.floor(Math.random() * 9000000000) + 1000000000;
    }

    /**
     * 한글 표준 규격에 맞는 기본 문단 태그를 생성하는 헬퍼 함수
     */
    private createParagraphTag(runXml: string): string {
        const id = this.generateHwpId();
        // 유저분이 뽑아주신 정석 양식 그대로 속성을 주입합니다.
        return `<hp:p id="${id}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runXml}</hp:p>`;
    }

    /**
     * 마크다운 텍스트를 받아 HWPX 파일로 변환하여 저장합니다.
     * @param mdContent 변환할 마크다운 텍스트
     * @param templatePath 미리 준비된 빈 hwpx 파일 경로
     * @param outputPath 저장할 파일 경로
     */
    public async generate(mdContent: string, templatePath: string, outputPath: string) {
        try {
            const { marked } = require("marked");
            // 3. 템플릿 HWPX 로드 및 XML 주입
            const templateBuffer = fs.readFileSync(templatePath);
            const zip = await JSZip.loadAsync(templateBuffer);

            // 1. [핵심] header.xml을 먼저 조작하여 순차적 ID 발급 및 글자 크기(헤딩) 동적 생성
            const headerXmlFile = zip.file("Contents/header.xml");
            if (headerXmlFile) {
                let headerXml = await headerXmlFile.async("string");

                const nsMatch = headerXml.match(/<([a-zA-Z]+):charProperties/);
                const ns = nsMatch ? nsMatch[1] : "hh";

                let currentItemCnt = 0;
                // 현재 등록된 스타일 개수를 파악하고 5개를 추가로 늘려줍니다.
                headerXml = headerXml.replace(new RegExp(`<${ns}:charProperties([^>]*)>`), (match, attrs) => {
                    const itemCntMatch = attrs.match(/itemCnt="(\d+)"/);
                    if (itemCntMatch) {
                        currentItemCnt = parseInt(itemCntMatch[1], 10);
                        return `<${ns}:charProperties ` + attrs.replace(/itemCnt="\d+"/, `itemCnt="${currentItemCnt + 5}"`) + `>`;
                    }
                    return match;
                });

                // 발급받은 순차적 ID 등록
                this.styleIds = {
                    bold: currentItemCnt,
                    ul: currentItemCnt + 1,
                    h1: currentItemCnt + 2,
                    h2: currentItemCnt + 3,
                    h3: currentItemCnt + 4,
                };

                const baseStyleMatch = headerXml.match(new RegExp(`<${ns}:charPr\\s+id="0"([^>]*)>([\\s\\S]*?)<\\/${ns}:charPr>`));
                if (baseStyleMatch) {
                    let attrs = baseStyleMatch[1];
                    let inner = baseStyleMatch[2];

                    // 높이(폰트 사이즈)를 조작하는 헬퍼 함수 (1000 = 10pt)
                    const setHeight = (attrStr: string, height: string) => {
                        return attrStr.includes("height=") ? attrStr.replace(/height="\d+"/, `height="${height}"`) : attrStr + ` height="${height}"`;
                    };

                    const customStyles = `
                    <${ns}:charPr id="${this.styleIds.bold}" ${attrs}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.ul}" ${attrs}>${inner}<${ns}:underline type="bottom" shape="solid" color="000000"/></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.h1}" ${setHeight(attrs, "1600")}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.h2}" ${setHeight(attrs, "1400")}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    <${ns}:charPr id="${this.styleIds.h3}" ${setHeight(attrs, "1200")}>${inner}<${ns}:bold>1</${ns}:bold></${ns}:charPr>
                    `;

                    headerXml = headerXml.replace(new RegExp(`</${ns}:charProperties>`), `${customStyles}</${ns}:charProperties>`);
                    zip.file("Contents/header.xml", headerXml);
                }
            }

            // 2. 마크다운 변환 시작 (이제 styleIds가 정상적으로 세팅됨)
            // 1. 마크다운 파싱 (AST 추출)
            const tokens = marked.lexer(mdContent);
            let hwpxXmlContent = "";
            // 2. 토큰을 순회하며 HWPX XML 태그로 변환
            for (const token of tokens) {
                hwpxXmlContent += this.convertTokenToXml(token);
            }

            // 3. 본문(section0.xml) 주입
            // HWPX 내부의 본문 파일인 section0.xml을 찾습니다.
            const sectionXmlFile = zip.file("Contents/section0.xml");
            if (!sectionXmlFile) {
                throw new Error("템플릿 파일 형식이 올바르지 않습니다.");
            }
            let sectionXml = await sectionXmlFile.async("string");

            // 본문 영역(<hp:sec>)이 끝나는 지점 바로 앞에 우리가 만든 XML을 삽입합니다.
            // 🔥 핵심 수정 부분: HWPX의 Section 태그는 'hp'가 아니라 'hs' 입니다!
            if (sectionXml.includes("</hs:sec>")) {
                sectionXml = sectionXml.replace("</hs:sec>", `${hwpxXmlContent}</hs:sec>`);
            } else {
                // hs:sec가 안 보일 경우를 대비해, 이름에 상관없이 sec 닫는 태그를 찾는 정규식 안전장치
                sectionXml = sectionXml.replace(/<\/[a-zA-Z0-9:]*sec>/i, `${hwpxXmlContent}$&`);
            }
            // 4. 수정된 XML을 다시 ZIP에 덮어쓰고 저장
            zip.file("Contents/section0.xml", sectionXml);

            const generatedBuffer = await zip.generateAsync({ type: "nodebuffer" });
            fs.writeFileSync(outputPath, generatedBuffer);
        } catch (error) {
            console.error("HWPX 생성 중 오류 발생:", error);
            throw error;
        }
    }

    /**
     * 마크다운 토큰을 HWPX XML로 변환합니다.
     * @param token 변환할 마크다운 토큰
     * @param listLevel 목록의 깊이 (기본값: 0)
     * @returns 변환된 HWPX XML 문자열
     */
    private convertTokenToXml(token: any, listLevel: number = 0): string {
        let xml = "";

        switch (token.type) {
            // 타이틀 처리: 글자 크기를 키운 문단으로 처리 (간략화된 예시)
            case "heading":
                // 헤딩 레벨에 따라 폰트 사이즈가 지정된 ID 매핑 (H1:16pt, H2:14pt, H3:12pt)
                let hId = this.styleIds.h3;
                if (token.depth === 1) {
                    hId = this.styleIds.h1;
                } else if (token.depth === 2) {
                    hId = this.styleIds.h2;
                }
                xml = this.createParagraphTag(this.parseInlineToRuns(token.text, hId));
                break;

            case "paragraph":
                xml = this.createParagraphTag(this.parseInlineToRuns(token.text));
                break;

            // 목록 처리: 들여쓰기 및 수준별 기호 삽입
            case "list":
                for (const item of token.items) {
                    xml += this.convertTokenToXml(item, listLevel);
                }
                break;

            case "list_item":
                // 수준에 따른 기호 설정 (0: □, 1: ◦, 2: •)
                // 다중 목록 완벽 분리 로직: 텍스트와 하위 목록(list)을 분리하여 처리
                const bullet = listLevel === 0 ? "□ " : listLevel === 1 ? "  ◦ " : "    • ";
                if (token.tokens && token.tokens.length > 0) {
                    let isFirstText = true;
                    for (const child of token.tokens) {
                        if (child.type === "text" || child.type === "paragraph") {
                            const prefix = isFirstText ? bullet : "    "; // 첫 줄에만 기호 붙이기
                            xml += this.createParagraphTag(this.parseInlineToRuns(`${prefix}${child.text}`));
                            isFirstText = false;
                        } else if (child.type === "list") {
                            xml += this.convertTokenToXml(child, listLevel + 1); // 재귀 호출로 단계별 구분점 처리
                        }
                    }
                } else {
                    xml += this.createParagraphTag(this.parseInlineToRuns(`${bullet}${token.text}`));
                }
                break;

            case "blockquote":
                // 인용 박스 처리 (1칸 표)
                // 표는 <hp:tbl>, 행은 <hp:tr>, 셀은 <hp:tc> 태그를 사용합니다.
                xml = this.createTableXml([[token.text]]);
                break;

            case "table":
                // 표 처리 로직 (행과 열을 순회하며 XML 구성)
                const rows: string[][] = [];
                rows.push(token.header.map((cell: any) => cell.text));
                token.rows.forEach((row: any) => {
                    rows.push(row.map((cell: any) => cell.text));
                });
                xml = this.createTableXml(rows);
                break;

            case "space":
                xml = this.createParagraphTag("<hp:run><hp:t></hp:t></hp:run>");
                break;

            default:
                // 이미지 처리는 압축 파일 내 'BinData/' 폴더 조작이 필요하여 기본 구조만 남깁니다.
                if (token.raw) {
                    xml = this.createParagraphTag(this.parseInlineToRuns(token.raw));
                }
                break;
        }
        return xml;
    }

    // 인라인 스타일 분석기 (기본 ID를 주입받아 폰트 사이즈 유지 가능)
    /**
     * 텍스트 내의 볼드체, 밑줄 등을 처리합니다.
     */
    private parseInlineToRuns(text: string, defaultStyleId?: number): string {
        if (!text) {
            return `<hp:run ${defaultStyleId ? `charPrIDRef="${defaultStyleId}"` : ""}><hp:t></hp:t></hp:run>`;
        }

        // XML 특수문자 이스케이프 (태그 충돌 방지를 위해 가장 먼저 실행)
        let processed = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // 볼드 및 밑줄은 텍스트 형태로 우선 구분해 둡니다.
        // 볼드체 처리 (**텍스트**) - 한글 XML에서 글꼴 속성 참조로 구현해야 하지만,
        // 텍스트 변환 과정의 직관성을 위해 HTML 태그 형태를 유지하거나 단순화하여 맵핑합니다.
        // 볼드와 밑줄 분리 (defaultStyleId가 있으면 기본 속성으로 복귀하도록 처리)
        const defAttr = defaultStyleId ? `charPrIDRef="${defaultStyleId}"` : "";
        processed = processed.replace(
            /\*\*(.*?)\*\*/g,
            `</hp:t></hp:run><hp:run charPrIDRef="${this.styleIds.bold}"><hp:t>$1</hp:t></hp:run><hp:run ${defAttr}><hp:t>`,
        );
        // 밑줄 처리 (마크다운 표준이 아니므로 HTML <u> 태그 사용을 가정)
        processed = processed.replace(
            /<u>(.*?)<\/u>/g,
            `</hp:t></hp:run><hp:run charPrIDRef="${this.styleIds.ul}"><hp:t>$1</hp:t></hp:run><hp:run ${defAttr}><hp:t>`,
        );

        let result = `<hp:run ${defAttr}><hp:t>${processed}</hp:t></hp:run>`;
        result = result.replace(/<hp:run[^>]*><hp:t><\/hp:t><\/hp:run>/g, ""); // 빈 태그 청소

        return result;
    }

    // [신규 수정] 한글 규격에 완벽히 호환되는 표 생성기
    private createTableXml(rows: string[][]): string {
        const tableId = this.generateHwpId();
        // borderFillIDRef="1" 유지 (기본 테두리 참조)
        let xml = `<hp:tbl id="${tableId}" zOrder="0" numberingType="table" textWrap="topAndBottom" halfFont="0" borderFillIDRef="1" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">`;
        xml += `<hp:sz width="14000" widthUnit="0" height="0" heightUnit="0"/>`;
        xml += `<hp:pos treatAsChar="1"/>`;

        // 오류의 원인이었던 <hp:margin>을 삭제하고 규격에 맞는 여백 태그 삽입
        xml += `<hp:outMargin left="0" right="0" top="0" bottom="0"/>`;
        xml += `<hp:inMargin left="141" right="141" top="141" bottom="141"/>`;

        rows.forEach((row, rowIndex) => {
            xml += `<hp:tr>`;
            xml += `<hp:sz width="14000" height="0"/>`; // 행 높이 지정 필수

            // 각 셀의 너비를 열 개수에 맞게 균등 배분
            const cellWidth = Math.floor(14000 / row.length);

            row.forEach((cellText, colIndex) => {
                xml += `<hp:tc name="" header="0" hasMargin="0" protect="0" borderFillIDRef="1">`;
                xml += `<hp:cellAddr colAddr="${colIndex}" rowAddr="${rowIndex}" />`;
                xml += `<hp:cellSpan colSpan="1" rowSpan="1" />`;
                xml += `<hp:cellSz width="${cellWidth}" height="0"/>`; // 셀 너비 지정 필수
                xml += `<hp:subList>${this.createParagraphTag(this.parseInlineToRuns(cellText))}</hp:subList>`;
                xml += `</hp:tc>`;
            });
            xml += `</hp:tr>`;
        });
        xml += `</hp:tbl>`;

        return this.createParagraphTag(`<hp:run>${xml}</hp:run>`);
    }
}
