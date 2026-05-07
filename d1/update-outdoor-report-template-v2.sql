-- 외근보고서 템플릿 v2 — 자유 기술 섹션 제거
-- "활동 내용 및 결과", "후속 조치" 섹션 삭제
-- 외근 내역만 자동 채워지고, 이후 작성자가 자유롭게 본문 추가

UPDATE templates
SET content = '<h1 style="text-align: center;">외 근 보 고 서</h1><p><br></p><p>성 명 : {{이름_직급}}</p><p>부 서 : {{부서}}</p><p><br></p><h2>외근 내역</h2><p class="outdoor-placeholder" style="color:#9aa0a6;font-style:italic;">※ 상단 "외근 일지 선택" 패널에서 일정을 체크한 뒤 "본문 자동 채우기" 버튼을 누르면 이 영역에 외근 정보가 자동으로 채워집니다.</p><p><br></p><p><br></p><p style="text-align: left;">위와 같이 외근을 보고합니다.</p><p><br></p><p style="text-align: center;">{{작성일}}</p>',
  updated_at = datetime('now')
WHERE id = 'tpl-work-007';
