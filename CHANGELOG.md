# Change Log

모든 주요 업데이트와 버그 수정 내역이 이곳에 기록됩니다.

## [1.0.0] - Initial Release

### Added (신규 추가)

- **Core:** 마크다운 텍스트를 읽어 HWPX 파일로 내보내는 핵심 변환 엔진 구현
- **Typography:** 제목(H1: 16pt, H2: 14pt, H3: 12pt), 볼드체, 밑줄 스타일 파싱 및 변환 기능 추가
- **Lists:** 다중 목록(Nested Lists) 분석 및 수준별 기호(□, ◦, •) 삽입 기능 추가
- **Tables:** 마크다운 표 및 인용구(`>`)를 한글 네이티브 표(`<hp:tbl>`)로 변환하는 기능 추가
- **Command:** 명령 팔레트를 통한 `Export to HWP` 명령어 등록

### Fixed (버그 수정 및 안정화)

- **XML Integrity:** 스타일(`charPr`, `paraPr`) 동적 주입 시, 기존 태그 순서를 파괴하여 파일 전체가 열리지 않던 크리티컬 버그 수정 (정규식 기반 덮어쓰기로 안전성 확보)
- **List Indentation:** 다중 목록이 단순 텍스트 공백으로 처리되던 문제를 수정하고, 한글 네이티브 문단 모양(왼쪽 여백)을 동적으로 주입하여 완벽한 들여쓰기 구현
- **Table Layout:** `<hp:run>` 태그 내부에 표 객체가 포함되어 렌더링이 무시(증발)되던 문제 수정 및 표 여백(`inMargin`, `outMargin`) 표준화
- **ID Collision:** 랜덤 ID 발급으로 인한 문서 길어짐 시의 충돌 위험을 제거하고 1,000,000,000부터 시작하는 순차적(Sequential) ID 발급 시스템 도입

- **리스트 변환 시 두 번째 줄 내어쓰기(Hanging Indent) 및 여백 적용 불가 현상 수정**
  - **현상:** 마크다운 리스트 변환 시, 두 번째 줄 텍스트가 리스트 마커 너비에 맞춰 자동 정렬(Shift+Tab 효과)되지 않는 문제 해결.
  - **원인:**
    1. HWPX(OWPML) 렌더링 엔진은 본문(`<hp:p>`) 내부에 직접 선언된 인라인 여백(`<hp:pPr>` 내부 `<hp:margin>`)을 구조적으로 무시함.
    2. `<hp:margin>` 태그 내 규격 외 속성(`top`, `bottom` 등) 혼재 시 엔진이 해당 태그를 렌더링에서 누락시킴.
  - **해결 방안:** 인라인 서식 적용 방식을 폐기하고, **정적 템플릿 참조(Static Template Mapping)** 방식으로 렌더링 아키텍처 변경.
    - `header.xml` 템플릿의 `<hh:paraProperties>` 내부에 리스트 뎁스(Depth 1, 2, 3...)별 문단 모양(`<hh:paraPr>`) 속성을 사전 정의.
      _(예: `left="2000" intent="-2000" prev="0" next="0"`)_
    - 본문(`section0.xml`) 파싱 시, 마크다운 리스트의 뎁스를 계산하여 사전 정의된 문단 모양의 고유 ID(`paraPrIDRef`)만 연결하도록 파서 로직 수정.

---

_Enjoy seamless Markdown to HWPX conversion!_
