-- 기존 테스트 데이터 정리
DELETE FROM drive_backup_logs WHERE document_id LIKE 'test-doc-%';
DELETE FROM approval_steps WHERE document_id LIKE 'test-doc-%';
DELETE FROM documents WHERE id LIKE 'test-doc-%';

-- 신규 테스트 문서 5건
INSERT INTO documents
  (id, title, content, template_id, author_id, branch, department, status, created_at, updated_at, cancelled)
VALUES
  ('test-doc-101',
   '컨설팅 계약서 - 홍길동',
   '<div style="padding:20px;font-family:Malgun Gothic,sans-serif;"><h2 style="text-align:center;margin-bottom:20px;font-size:22px;">부동산 경매 컨설팅 계약서</h2><div style="line-height:2;font-size:14px;"><p><strong>계약자명:</strong> 홍길동</p><p><strong>연락처:</strong> 010-1234-5678</p><p><strong>주소:</strong> 서울시 강남구 테헤란로 123</p><br/><p><strong>제1조 (목적)</strong><br/>갑(의뢰인)과 을(마이옥션)은 부동산 경매 컨설팅 업무 수행에 관하여 다음과 같이 계약을 체결한다.</p><p><strong>제2조 (업무범위)</strong><br/>을은 갑에게 부동산 경매 관련 시장분석·권리분석·입찰가 산정 등 전문 컨설팅을 제공한다.</p><p><strong>제3조 (계약금액)</strong><br/>계약금액은 금 오십오만원(￦550,000, VAT 포함)으로 한다.</p><p><strong>제4조 (계약기간)</strong><br/>본 계약의 유효기간은 계약일로부터 6개월로 한다.</p><p style="margin-top:50px;text-align:center;">2026년 4월 15일</p></div></div>',
   NULL, 'user-003', '서초', '경매사업부1팀', 'approved',
   '2026-04-15 09:30:00', '2026-04-15 17:20:00', 0),
  ('test-doc-102',
   '컨설팅 계약서 - 김영수',
   '<div style="padding:20px;font-family:Malgun Gothic,sans-serif;"><h2 style="text-align:center;margin-bottom:20px;font-size:22px;">부동산 경매 컨설팅 계약서</h2><div style="line-height:2;font-size:14px;"><p><strong>계약자명:</strong> 김영수</p><p><strong>연락처:</strong> 010-2222-3333</p><p><strong>주소:</strong> 서울시 서초구 반포대로 45</p><br/><p><strong>제1조 (목적)</strong><br/>갑과 을은 부동산 경매 컨설팅 업무에 관한 사항을 정한다.</p><p><strong>제2조 (계약금액)</strong><br/>계약금액은 금 백십만원(￦1,100,000, VAT 포함)으로 한다.</p><p><strong>제3조 (업무내용)</strong><br/>시장조사, 권리분석, 입찰대행, 사후관리까지 포함.</p><p style="margin-top:50px;text-align:center;">2026년 4월 18일</p></div></div>',
   NULL, 'user-003', '서초', '경매사업부1팀', 'approved',
   '2026-04-18 10:00:00', '2026-04-18 16:50:00', 0),
  ('test-doc-103',
   '물건분석 보고서 - 박상희',
   '<div class="property-report" style="padding:20px;font-family:Malgun Gothic,sans-serif;"><h1 style="text-align:center;font-size:24px;margin-bottom:30px;">물건분석 보고서</h1><table style="width:100%;border-collapse:collapse;font-size:13px;"><tr><td style="border:1px solid #333;padding:8px;background:#f0f0f0;width:30%;"><b>의뢰인</b></td><td style="border:1px solid #333;padding:8px;">박상희</td></tr><tr><td style="border:1px solid #333;padding:8px;background:#f0f0f0;"><b>물건 주소</b></td><td style="border:1px solid #333;padding:8px;">서울 강남구 역삼동 123-45</td></tr><tr><td style="border:1px solid #333;padding:8px;background:#f0f0f0;"><b>감정가</b></td><td style="border:1px solid #333;padding:8px;">850,000,000원</td></tr><tr><td style="border:1px solid #333;padding:8px;background:#f0f0f0;"><b>최저매각가</b></td><td style="border:1px solid #333;padding:8px;">680,000,000원</td></tr></table><h3 style="margin-top:24px;">분석 소견</h3><p style="line-height:1.8;">본 물건은 지하철 역세권에 위치한 우량 자산으로, 권리관계는 대부분 정리되어 있으며 명도도 비교적 수월할 것으로 예상됩니다.</p><p style="line-height:1.8;"><b>예상 낙찰가:</b> 720,000,000원 ~ 740,000,000원 범위 권장</p></div>',
   NULL, 'user-007', '의정부', '경매사업부2팀', 'approved',
   '2026-04-20 11:15:00', '2026-04-20 18:00:00', 0),
  ('test-doc-104',
   '컨설팅 계약서 - 이은영',
   '<div style="padding:20px;font-family:Malgun Gothic,sans-serif;"><h2 style="text-align:center;margin-bottom:20px;font-size:22px;">부동산 경매 컨설팅 계약서</h2><div style="line-height:2;font-size:14px;"><p><strong>계약자명:</strong> 이은영</p><p><strong>연락처:</strong> 010-4444-5555</p><br/><p><strong>제1조</strong>갑과 을은 부동산 경매 컨설팅 업무 수행에 관하여 다음과 같이 계약한다.</p><p><strong>제2조</strong>계약금액은 금 오십오만원(￦550,000, VAT 포함)으로 한다.</p><p><strong>제3조</strong>을은 해당 물건의 권리관계를 분석하여 갑에게 제공한다.</p><p style="margin-top:50px;text-align:center;">2026년 4월 21일</p></div></div>',
   NULL, 'user-003', '서초', '경매사업부1팀', 'approved',
   '2026-04-21 09:00:00', '2026-04-21 15:30:00', 0),
  ('test-doc-105',
   '컨설팅 계약서 - 최지민',
   '<div style="padding:20px;font-family:Malgun Gothic,sans-serif;"><h2 style="text-align:center;margin-bottom:20px;font-size:22px;">부동산 경매 컨설팅 계약서</h2><div style="line-height:2;font-size:14px;"><p><strong>계약자명:</strong> 최지민</p><p><strong>연락처:</strong> 010-7777-8888</p><p><strong>주소:</strong> 경기도 의정부시 신곡동</p><br/><p>본 계약은 갑(의뢰인 최지민)과 을(주식회사 마이옥션) 사이에 체결된다.</p><p><strong>계약금액:</strong> 770,000원 (VAT 포함)</p><p><strong>업무범위:</strong> 권리분석, 시세조사, 입찰가 자문, 낙찰 후 명도 자문</p><p style="margin-top:50px;text-align:center;">2026년 4월 22일</p></div></div>',
   NULL, 'user-007', '의정부', '경매사업부1팀', 'approved',
   '2026-04-22 14:00:00', '2026-04-22 17:00:00', 0);

-- 결재선
INSERT INTO approval_steps (id, document_id, step_order, approver_id, status, signed_at, comment) VALUES
  ('step-101-1', 'test-doc-101', 1, 'test-mgr-02', 'approved', '2026-04-15 14:10:00', ''),
  ('step-101-2', 'test-doc-101', 2, 'admin-001',  'approved', '2026-04-15 17:20:00', ''),
  ('step-102-1', 'test-doc-102', 1, 'test-mgr-02', 'approved', '2026-04-18 13:40:00', ''),
  ('step-102-2', 'test-doc-102', 2, 'admin-001',  'approved', '2026-04-18 16:50:00', ''),
  ('step-103-1', 'test-doc-103', 1, 'admin-001',  'approved', '2026-04-20 18:00:00', ''),
  ('step-104-1', 'test-doc-104', 1, 'test-mgr-02', 'approved', '2026-04-21 12:10:00', ''),
  ('step-104-2', 'test-doc-104', 2, 'admin-001',  'approved', '2026-04-21 15:30:00', ''),
  ('step-105-1', 'test-doc-105', 1, 'admin-001',  'approved', '2026-04-22 17:00:00', '');

-- 확인
SELECT d.id, d.title, d.status, d.branch,
  (SELECT COUNT(*) FROM approval_steps s WHERE s.document_id = d.id) as steps,
  (SELECT COUNT(*) FROM drive_backup_logs b WHERE b.document_id = d.id AND b.status = 'success') as backed_up
FROM documents d WHERE d.id LIKE 'test-doc-%' ORDER BY d.created_at;
