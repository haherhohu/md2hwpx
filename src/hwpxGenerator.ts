import { marked } from "marked";
import * as JSZip from "jszip";
import * as fs from "fs";
import * as path from "path";

export class HwpxGenerator {
    /**
     * 한글 문단 고유 ID를 생성합니다. (10자리 무작위 정수)
     */
    private generateHwpId(): number {
        return Math.floor(Math.random() * 9000000000) + 1000000000;
    }

    /**
     * 한글 표준 규격에 맞는 기본 문단 태그를 생성하는 헬퍼 함수
     */
    private createParagraphTag(contentXml: string): string {
        const id = this.generateHwpId();
        // 유저분이 뽑아주신 정석 양식 그대로 속성을 주입합니다.
        return `<hp:p id="${id}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run><hp:t>${contentXml}</hp:t></hp:run></hp:p>`;
    }
    /**
     * 마크다운 텍스트를 받아 HWPX 파일로 변환하여 저장합니다.
     * @param mdContent 변환할 마크다운 텍스트
     * @param templatePath 미리 준비된 빈 hwpx 파일 경로
     * @param outputPath 저장할 파일 경로
     */
    public async generate(mdContent: string, templatePath: string, outputPath: string) {
        try {
            // 1. 마크다운 파싱 (AST 추출)
            const tokens = marked.lexer(mdContent);
            let hwpxXmlContent = "";

            // 2. 토큰을 순회하며 HWPX XML 태그로 변환
            for (const token of tokens) {
                hwpxXmlContent += this.convertTokenToXml(token);
            }

            // 3. 템플릿 HWPX 로드 및 XML 주입
            const templateBuffer = fs.readFileSync(templatePath);
            const zip = await JSZip.loadAsync(templateBuffer);

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
     * 마크다운 토큰을 OWPML(한글 XML)로 매핑하는 함수
     */
    private convertTokenToXml2(token: marked.Token, listLevel: number = 0): string {
        let xml = "";

        switch (token.type) {
            case "heading":
                // 타이틀 처리: 글자 크기를 키운 문단으로 처리 (간략화된 예시)
                xml = `<hp:p><hp:run><hp:t>${this.parseInlineStyles(token.text)}</hp:t></hp:run></hp:p>`;
                break;

            case "paragraph":
                xml = `<hp:p><hp:run><hp:t>${this.parseInlineStyles(token.text)}</hp:t></hp:run></hp:p>`;
                break;

            case "list":
                // 목록 처리: 들여쓰기 및 수준별 기호 삽입
                for (const item of token.items) {
                    xml += this.convertTokenToXml(item, listLevel);
                }
                break;

            case "list_item":
                // 수준에 따른 기호 설정 (0: □, 1: ◦, 2: •)
                const bullet = listLevel === 0 ? "□ " : listLevel === 1 ? "  ◦ " : "    • ";
                xml = `<hp:p><hp:run><hp:t>${bullet}${this.parseInlineStyles(token.text)}</hp:t></hp:run></hp:p>`;
                break;

            case "blockquote":
                // 인용 박스 처리 (1칸 표)
                // 표는 <hp:tbl>, 행은 <hp:tr>, 셀은 <hp:tc> 태그를 사용합니다.
                const quoteText = this.parseInlineStyles(token.text);
                xml = `
                <hp:tbl>
                    <hp:tr>
                        <hp:tc>
                            <hp:p><hp:run><hp:t>${quoteText}</hp:t></hp:run></hp:p>
                        </hp:tc>
                    </hp:tr>
                </hp:tbl>`;
                break;

            case "table":
                // 표 처리 로직 (행과 열을 순회하며 XML 구성)
                xml += `<hp:tbl>`;
                // 헤더
                xml += `<hp:tr>`;
                token.header.forEach((headerCell) => {
                    xml += `<hp:tc><hp:p><hp:run><hp:t>${this.parseInlineStyles(headerCell.text)}</hp:t></hp:run></hp:p></hp:tc>`;
                });
                xml += `</hp:tr>`;
                // 본문
                token.rows.forEach((row) => {
                    xml += `<hp:tr>`;
                    row.forEach((cell) => {
                        xml += `<hp:tc><hp:p><hp:run><hp:t>${this.parseInlineStyles(cell.text)}</hp:t></hp:run></hp:p></hp:tc>`;
                    });
                    xml += `</hp:tr>`;
                });
                xml += `</hp:tbl>`;
                break;

            case "space":
                xml = `<hp:p><hp:run><hp:t></hp:t></hp:run></hp:p>`; // 빈 줄
                break;

            default:
                // 이미지 처리는 압축 파일 내 'BinData/' 폴더 조작이 필요하여 기본 구조만 남깁니다.
                if (token.raw.includes("![")) {
                    xml = `<hp:p><hp:run><hp:t>[이미지 삽입 예정 영역: ${token.raw}]</hp:t></hp:run></hp:p>`;
                }
                break;
        }
        return xml;
    }
    // src/hwpxGenerator.ts 파일의 convertTokenToXml 함수를 아래의 안전한 코드로 교체해 보세요.
    private convertTokenToXml3(token: marked.Token, listLevel: number = 0): string {
        let xml = "";

        switch (token.type) {
            case "heading":
                // 제목 구분을 위해 앞뒤로 줄바꿈 문자를 넣어 가독성 확보
                xml = `<hp:p><hp:run><hp:t>[제목] ${this.parseInlineStyles(token.text)}</hp:t></hp:run></hp:p>`;
                break;

            case "paragraph":
                xml = `<hp:p><hp:run><hp:t>${this.parseInlineStyles(token.text)}</hp:t></hp:run></hp:p>`;
                break;

            case "list":
                for (const item of token.items) {
                    xml += this.convertTokenToXml(item, listLevel);
                }
                break;

            case "list_item":
                const bullet = listLevel === 0 ? "□ " : listLevel === 1 ? "  ◦ " : "    • ";
                xml = `<hp:p><hp:run><hp:t>${bullet}${this.parseInlineStyles(token.text)}</hp:t></hp:run></hp:p>`;
                break;

            case "blockquote":
                // 복잡한 표 태그 대신 우선 일반 문단에 기호로 감싸서 안전하게 출력 테스트
                xml = `<hp:p><hp:run><hp:t>[인용] ${this.parseInlineStyles(token.text)}</hp:t></hp:run></hp:p>`;
                break;

            case "table":
                // 표 역시 깨질 확률이 높으므로 단순 텍스트로 치환하여 먼저 출력 확인
                xml += `<hp:p><hp:run><hp:t>=== 표 시작 ===</hp:t></hp:run></hp:p>`;
                token.header.forEach((headerCell) => {
                    xml += `<hp:p><hp:run><hp:t>| ${this.parseInlineStyles(headerCell.text)} </hp:t></hp:run></hp:p>`;
                });
                token.rows.forEach((row) => {
                    let rowText = "| ";
                    row.forEach((cell) => {
                        rowText += this.parseInlineStyles(cell.text) + " | ";
                    });
                    xml += `<hp:p><hp:run><hp:t>${rowText}</hp:t></hp:run></hp:p>`;
                });
                xml += `<hp:p><hp:run><hp:t>=== 표 끝 ===</hp:t></hp:run></hp:p>`;
                break;

            case "space":
                xml = `<hp:p><hp:run><hp:t></hp:t></hp:run></hp:p>`;
                break;

            default:
                xml = `<hp:p><hp:run><hp:t>${this.parseInlineStyles(token.raw)}</hp:t></hp:run></hp:p>`;
                break;
        }
        return xml;
    }
    // src/hwpxGenerator.ts 파일의 convertTokenToXml 함수 내부를 아래처럼 좀 더 '한글 규격'에 맞게 수정해 보세요.
    private convertTokenToXml4(token: marked.Token, listLevel: number = 0): string {
        let xml = "";

        // 한글 빈 문서의 기본 문단 모양 ID는 보통 0번입니다. 속성을 명시해 주면 한글이 훨씬 잘 인식합니다.
        // <hp:p id="3121190098" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
        const defaultParaPr = 'paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"';
        const defaultCharPr = 'charPrIDRef="0"';

        switch (token.type) {
            case "heading":
                // 제목은 눈에 띄게 앞뒤로 특수 기호를 붙여서 텍스트 위주로 먼저 튀어나오게 유도합니다.
                xml = `<hp:p ${defaultParaPr}><hp:run><hp:secPr><hp:charPr ${defaultCharPr}/></hp:secPr><hp:t>[■] ${this.parseInlineStyles(token.text)}</hp:t></hp:run></hp:p>`;
                break;

            case "paragraph":
                xml = `<hp:p ${defaultParaPr}><hp:run><hp:t>${this.parseInlineStyles(token.text)}</hp:t></hp:run></hp:p>`;
                break;

            case "list":
                for (const item of token.items) {
                    xml += this.convertTokenToXml(item, listLevel);
                }
                break;

            case "list_item":
                const bullet = listLevel === 0 ? "□ " : listLevel === 1 ? "  ◦ " : "    • ";
                xml = `<hp:p ${defaultParaPr}><hp:run><hp:t>${bullet}${this.parseInlineStyles(token.text)}</hp:t></hp:run></hp:p>`;
                break;

            case "space":
                xml = `<hp:p ${defaultParaPr}><hp:run><hp:t></hp:t></hp:run></hp:p>`;
                break;

            default:
                xml = `<hp:p ${defaultParaPr}><hp:run><hp:t>${this.parseInlineStyles(token.raw)}</hp:t></hp:run></hp:p>`;
                break;
        }
        return xml;
    }
    private convertTokenToXml(token: marked.Token, listLevel: number = 0): string {
        let xml = "";

        switch (token.type) {
            case "heading":
                // 타이틀(제목) 처리
                xml = this.createParagraphTag(`[■] ${this.parseInlineStyles(token.text)}`);
                break;

            case "paragraph":
                // 일반 본문 처리
                xml = this.createParagraphTag(this.parseInlineStyles(token.text));
                break;

            case "list":
                for (const item of token.items) {
                    xml += this.convertTokenToXml(item, listLevel);
                }
                break;

            case "list_item":
                // 구분점 및 수준 구분 처리 (□, ◦, •)
                const bullet = listLevel === 0 ? "□ " : listLevel === 1 ? "  ◦ " : "    • ";
                xml = this.createParagraphTag(`${bullet}${this.parseInlineStyles(token.text)}`);
                break;

            case "space":
                // 빈 줄 처리
                xml = this.createParagraphTag("");
                break;

            default:
                xml = this.createParagraphTag(this.parseInlineStyles(token.raw));
                break;
        }
        return xml;
    }

    /**
     * 텍스트 내의 볼드체, 밑줄 등을 처리합니다.
     */
    private parseInlineStyles(text: string): string {
        if (!text) {
            return "";
        }

        let processed = text;

        // XML 특수문자 이스케이프 (태그 충돌 방지를 위해 가장 먼저 실행)
        processed = processed.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // 볼드 및 밑줄은 텍스트 형태로 우선 구분해 둡니다.
        // 볼드체 처리 (**텍스트**) - 한글 XML에서 글꼴 속성 참조로 구현해야 하지만,
        // 텍스트 변환 과정의 직관성을 위해 HTML 태그 형태를 유지하거나 단순화하여 맵핑합니다.
        processed = processed.replace(/\*\*(.*?)\*\*/g, "[볼드: $1]");
        // 밑줄 처리 (마크다운 표준이 아니므로 HTML <u> 태그 사용을 가정)
        processed = processed.replace(/<u>(.*?)<\/u>/g, "[밑줄: $1]");

        return processed;
    }
}
