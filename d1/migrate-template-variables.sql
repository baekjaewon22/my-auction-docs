-- 템플릿 변수 치환: 수동 텍스트 → {{변수}} 형태로 변경
-- 성 명 : → 성 명 : {{이름_직급}}
-- 부 서 : → 부 서 : {{부서}}
-- 직 급 : → 직 급 : {{직급}}
-- 소 속 : → 소 속 : {{부서}}
-- 신청인 : → 신청인 : {{이름_직급}}
-- 작 성 자 : → 작 성 자 : {{이름_직급}}
-- 보 고 자 : → 보 고 자 : {{이름_직급}}
-- 20 년 월 일 → {{작성일}}

-- 성 명 :
UPDATE templates SET content = REPLACE(content, '성 명 :</p>', '성 명 : {{이름_직급}}</p>') WHERE content LIKE '%성 명 :</p>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '성 명 : </p>', '성 명 : {{이름_직급}}</p>') WHERE content LIKE '%성 명 : </p>%' AND is_active = 1;

-- 부 서 :
UPDATE templates SET content = REPLACE(content, '부 서 :</p>', '부 서 : {{부서}}</p>') WHERE content LIKE '%부 서 :</p>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '부 서 : </p>', '부 서 : {{부서}}</p>') WHERE content LIKE '%부 서 : </p>%' AND is_active = 1;

-- 직 급 :
UPDATE templates SET content = REPLACE(content, '직 급 :</p>', '직 급 : {{직급}}</p>') WHERE content LIKE '%직 급 :</p>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '직 급 : </p>', '직 급 : {{직급}}</p>') WHERE content LIKE '%직 급 : </p>%' AND is_active = 1;

-- 소 속 :
UPDATE templates SET content = REPLACE(content, '소 속 :</p>', '소 속 : {{부서}}</p>') WHERE content LIKE '%소 속 :</p>%' AND is_active = 1;

-- 신청인 :  (줄 끝)
UPDATE templates SET content = REPLACE(content, '신청인 :</p>', '신청인 : {{이름_직급}}</p>') WHERE content LIKE '%신청인 :</p>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '신청인 : </p>', '신청인 : {{이름_직급}}</p>') WHERE content LIKE '%신청인 : </p>%' AND is_active = 1;

-- 작 성 자 :
UPDATE templates SET content = REPLACE(content, '작 성 자 :</p>', '작 성 자 : {{이름_직급}}</p>') WHERE content LIKE '%작 성 자 :</p>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '작성자 :</p>', '작성자 : {{이름_직급}}</p>') WHERE content LIKE '%작성자 :</p>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '작성자 : </p>', '작성자 : {{이름_직급}}</p>') WHERE content LIKE '%작성자 : </p>%' AND is_active = 1;

-- 보 고 자 :
UPDATE templates SET content = REPLACE(content, '보 고 자 :</p>', '보 고 자 : {{이름_직급}}</p>') WHERE content LIKE '%보 고 자 :</p>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '보고자 :</p>', '보고자 : {{이름_직급}}</p>') WHERE content LIKE '%보고자 :</p>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '보고자 : </p>', '보고자 : {{이름_직급}}</p>') WHERE content LIKE '%보고자 : </p>%' AND is_active = 1;

-- 날짜: "20 년 월 일" → "{{작성일}}"
UPDATE templates SET content = REPLACE(content, '20 년 월 일', '{{작성일}}') WHERE content LIKE '%20 년 월 일%' AND is_active = 1;

-- 날짜: 중앙정렬 날짜 행 (제출일 등)
UPDATE templates SET content = REPLACE(content, '>20  년   월   일<', '>{{작성일}}<') WHERE content LIKE '%>20  년   월   일<%' AND is_active = 1;
