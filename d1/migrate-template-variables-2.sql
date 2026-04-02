-- 테이블 구조 템플릿: <th>성명</th><td></td> → <th>성명</th><td>{{이름}}</td>
UPDATE templates SET content = REPLACE(content, '<th>성명</th><td></td>', '<th>성명</th><td>{{이름}}</td>') WHERE content LIKE '%<th>성명</th><td></td>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '<th>성 명</th><td></td>', '<th>성 명</th><td>{{이름}}</td>') WHERE content LIKE '%<th>성 명</th><td></td>%' AND is_active = 1;

-- 부서
UPDATE templates SET content = REPLACE(content, '<th>부서</th><td></td>', '<th>부서</th><td>{{부서}}</td>') WHERE content LIKE '%<th>부서</th><td></td>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '<th>부 서</th><td></td>', '<th>부 서</th><td>{{부서}}</td>') WHERE content LIKE '%<th>부 서</th><td></td>%' AND is_active = 1;

-- 직급
UPDATE templates SET content = REPLACE(content, '<th>직급</th><td></td>', '<th>직급</th><td>{{직급}}</td>') WHERE content LIKE '%<th>직급</th><td></td>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '<th>직 급</th><td></td>', '<th>직 급</th><td>{{직급}}</td>') WHERE content LIKE '%<th>직 급</th><td></td>%' AND is_active = 1;

-- 소속
UPDATE templates SET content = REPLACE(content, '<th>소속</th><td></td>', '<th>소속</th><td>{{부서}}</td>') WHERE content LIKE '%<th>소속</th><td></td>%' AND is_active = 1;

-- 연락처
UPDATE templates SET content = REPLACE(content, '<th>연락처</th><td></td>', '<th>연락처</th><td>{{전화번호}}</td>') WHERE content LIKE '%<th>연락처</th><td></td>%' AND is_active = 1;

-- 테이블 내 날짜: 20    년    월    일
UPDATE templates SET content = REPLACE(content, '20    년    월    일', '{{작성일}}') WHERE content LIKE '%20    년    월    일%' AND is_active = 1;

-- 신청인 : (테이블 외)
UPDATE templates SET content = REPLACE(content, '신청인 :  </p>', '신청인 : {{이름_직급}}</p>') WHERE content LIKE '%신청인 :  </p>%' AND is_active = 1;
UPDATE templates SET content = REPLACE(content, '신청인  :</p>', '신청인 : {{이름_직급}}</p>') WHERE content LIKE '%신청인  :</p>%' AND is_active = 1;

-- 작성자 : (테이블 외)
UPDATE templates SET content = REPLACE(content, '작성자  :</p>', '작성자 : {{이름_직급}}</p>') WHERE content LIKE '%작성자  :</p>%' AND is_active = 1;

-- 보고자 : (테이블 외)
UPDATE templates SET content = REPLACE(content, '보고자  :</p>', '보고자 : {{이름_직급}}</p>') WHERE content LIKE '%보고자  :</p>%' AND is_active = 1;

-- p 태그 내 "신청인 :" 뒤에 공백만 있는 경우
UPDATE templates SET content = REPLACE(content, '>신청인 : <', '>신청인 : {{이름_직급}}<') WHERE content LIKE '%>신청인 : <%' AND content NOT LIKE '%>신청인 : {{%' AND is_active = 1;

-- p 태그 내 "작성자 :" 뒤에 공백만 있는 경우
UPDATE templates SET content = REPLACE(content, '>작성자 : <', '>작성자 : {{이름_직급}}<') WHERE content LIKE '%>작성자 : <%' AND content NOT LIKE '%>작성자 : {{%' AND is_active = 1;

-- p 태그 내 "보고자 :" 뒤에 공백만 있는 경우
UPDATE templates SET content = REPLACE(content, '>보고자 : <', '>보고자 : {{이름_직급}}<') WHERE content LIKE '%>보고자 : <%' AND content NOT LIKE '%>보고자 : {{%' AND is_active = 1;
