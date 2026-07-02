# 권리분석 보증서 템플릿 폴더

이 폴더의 `certificate.pptx` 파일이 권리분석 보증서 생성에 우선 사용됩니다.
`certificate.pptx`가 없으면 예비용 `certificate.html` 템플릿을 사용합니다.

템플릿 교체 시 같은 파일명으로 넣어주세요.

- 폴더: `backend/templates/rights_certificate`
- PPT 템플릿: `certificate.pptx`
- 원본 샘플: `sample.pptx`
- 예비 HTML 템플릿: `certificate.html`
- 출력: `backend/output/권리분석_보증서_{task_id}.pdf`
- PDF 변환을 사용할 수 없는 PC에서는 `backend/output/권리분석_보증서_{task_id}.pptx`가 다운로드됩니다.

PPT 주요 변수:

- `{{caseNumber}}`
- `{{caceNumber}}` (`caseNumber` 오타 호환)
- `{{court}}`
- `{{createdDate}}`
- `{{createDate}}` (`createdDate` 별칭)
- `{{authorName}}`
- `{{baseRightDescription}}`
- `{{tenantAnalysisText}}`
- `{{tenantOcrText}}`
- `{{surplusDescription}}`
- `{{miscText}}`
- `{{reviewText}}`

현재 주요 파싱 기준:

- 사건번호: `#header_detailz > h2 > strong > span`
- 법원: `#dtl_table > table > tbody > tr:nth-child(2) > td > ul > li:nth-child(1)`
- 말소기준권리: `건물 등기부현황`, `토지 등기부현황`, `등기부현황` 표와 문서 내용을 기준으로 구성
- 임차내역: `#dtlw_link > ul > li:nth-child(5) > a` 또는 `매각물건명세서` 링크/탭을 통해 매각물건명세서 내용을 기준으로 구성
- 임차내역 출력 항목: 점유자 성명 / 점유구분 / 보증금 / 차임 / 전입일 / 확정일 / 배당요구일

추가로 사용할 수 있는 공통 변수:

- `{{propertyType}}`
- `{{appraisalValue}}`
- `{{minBidPrice}}`
- `{{bidDate}}`
- `{{authorTitle}}`
- `{{authorPhone}}`
- `{{baseRightDate}}`
- `{{baseRightType}}`

HTML 예비 템플릿 반복 블록:

```html
{{#each tenantAnalyses}}
<p>{{this.description}}</p>
{{/each}}

{{#each miscItems}}
<li>{{this}}</li>
{{/each}}

{{#each reviewItems}}
<li>{{this}}</li>
{{/each}}
```

HTML 예비 템플릿 조건 블록:

```html
{{#if noTenants}} ... {{/if}}
{{#if hasUnpaidFee}} ... {{/if}}
```
