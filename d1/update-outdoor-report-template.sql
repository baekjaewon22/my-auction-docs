-- 외근보고서 템플릿 재구성
-- - 빈 placeholder (외근 일자/시간/장소/목적) 제거 (link 시스템으로 대체)
-- - 자동 채우기 섹션 마커 추가 (class="outdoor-placeholder")
-- - 자유 기술 섹션 (활동 내용 / 후속 조치) 구조화

UPDATE templates
SET content = '<h1 style="text-align: center;">외 근 보 고 서</h1><p><br></p><p>성 명 : {{이름_직급}}</p><p>부 서 : {{부서}}</p><p><br></p><h2>외근 내역</h2><p class="outdoor-placeholder" style="color:#9aa0a6;font-style:italic;">※ 상단 "외근 일지 선택" 패널에서 일정을 체크한 뒤 "본문 자동 채우기" 버튼을 누르면 이 영역에 외근 정보가 자동으로 채워집니다.</p><p><br></p><h2>활동 내용 및 결과</h2><p>(외근 중 수행한 주요 활동, 협의 내용, 발견 사항, 결과 등을 자유롭게 기술하세요.)</p><p><br></p><h2>후속 조치</h2><p>(필요한 후속 업무, 다음 일정, 공유 사항 등을 작성하세요.)</p><p><br></p><p><br></p><p style="text-align: left;">위와 같이 외근을 보고합니다.</p><p><br></p><p style="text-align: center;">{{작성일}}</p>',
  updated_at = datetime('now')
WHERE id = 'tpl-work-007';
