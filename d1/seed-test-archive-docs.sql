-- 로컬 테스트용 승인 완료 문서 4건 삽입

INSERT OR REPLACE INTO documents
  (id, title, content, template_id, author_id, branch, department, status, created_at, updated_at, cancelled)
VALUES
  ('test-doc-001',
   '컨설팅 계약서 - 홍길동',
   '<h2 style="text-align:center">부동산 경매 컨설팅 계약서</h2><p><strong>계약자명:</strong> 홍길동</p><p><strong>연락처:</strong> 010-1234-5678</p><p>갑(의뢰인)과 을(마이옥션) 사이에 아래와 같이 컨설팅 계약을 체결한다.</p><p>1조. 을은 갑에게 부동산 경매 관련 전문 컨설팅을 제공한다.</p><p>2조. 계약금액은 550,000원 (VAT 포함) 으로 한다.</p><p>3조. 계약 기간은 계약일로부터 6개월로 한다.</p><p style="margin-top:40px">2026년 4월 15일</p>',
   NULL, 'user-003', '서초', '경매사업부1팀', 'approved',
   '2026-04-15 09:30:00', '2026-04-15 17:20:00', 0),
  ('test-doc-002',
   '컨설팅 계약서 - 김영수',
   '<h2 style="text-align:center">부동산 경매 컨설팅 계약서</h2><p><strong>계약자명:</strong> 김영수</p><p><strong>연락처:</strong> 010-2222-3333</p><p>갑(의뢰인)과 을(마이옥션) 사이에 아래와 같이 컨설팅 계약을 체결한다.</p><p>1조. 을은 갑에게 부동산 경매 관련 전문 컨설팅을 제공한다.</p><p>2조. 계약금액은 1,100,000원 (VAT 포함) 으로 한다.</p><p style="margin-top:40px">2026년 4월 18일</p>',
   NULL, 'user-003', '서초', '경매사업부1팀', 'approved',
   '2026-04-18 10:00:00', '2026-04-18 16:50:00', 0),
  ('test-doc-003',
   '물건분석 보고서 - 박상희',
   '<div class="property-report"><h2 style="text-align:center">물건분석 보고서</h2><p><strong>의뢰인:</strong> 박상희</p><p><strong>물건 주소:</strong> 서울 강남구 역삼동 123-45</p><p><strong>감정가:</strong> 850,000,000원</p><p><strong>최저매각가:</strong> 680,000,000원</p><h3>분석 소견</h3><p>본 물건은 역세권에 위치한 우량 자산으로, 권리관계 정리가 완료되어 있습니다.</p><p>예상 낙찰가: 720,000,000원 ~ 740,000,000원</p></div>',
   NULL, 'user-007', '의정부', '경매사업부2팀', 'approved',
   '2026-04-20 11:15:00', '2026-04-20 18:00:00', 0),
  ('test-doc-004',
   '컨설팅 계약서 - 이은영',
   '<h2 style="text-align:center">부동산 경매 컨설팅 계약서</h2><p><strong>계약자명:</strong> 이은영</p><p><strong>연락처:</strong> 010-4444-5555</p><p>갑(의뢰인)과 을(마이옥션) 사이에 아래와 같이 컨설팅 계약을 체결한다.</p><p>1조. 을은 갑에게 부동산 경매 관련 전문 컨설팅을 제공한다.</p><p>2조. 계약금액은 550,000원 (VAT 포함) 으로 한다.</p><p style="margin-top:40px">2026년 4월 21일</p>',
   NULL, 'user-003', '서초', '경매사업부1팀', 'approved',
   '2026-04-21 09:00:00', '2026-04-21 15:30:00', 0);

-- 각 문서별 결재 라인 (작성자 제출 → 팀장 승인 → 관리자 승인 모두 완료)
INSERT OR REPLACE INTO approval_steps (id, document_id, step_order, approver_id, status, signed_at, comment) VALUES
  ('step-001-1', 'test-doc-001', 1, 'test-mgr-02', 'approved', '2026-04-15 14:10:00', ''),
  ('step-001-2', 'test-doc-001', 2, 'admin-001',  'approved', '2026-04-15 17:20:00', ''),
  ('step-002-1', 'test-doc-002', 1, 'test-mgr-02', 'approved', '2026-04-18 13:40:00', ''),
  ('step-002-2', 'test-doc-002', 2, 'admin-001',  'approved', '2026-04-18 16:50:00', ''),
  ('step-003-1', 'test-doc-003', 1, 'admin-001',  'approved', '2026-04-20 18:00:00', ''),
  ('step-004-1', 'test-doc-004', 1, 'test-mgr-02', 'approved', '2026-04-21 12:10:00', ''),
  ('step-004-2', 'test-doc-004', 2, 'admin-001',  'approved', '2026-04-21 15:30:00', '');

-- 확인
SELECT d.id, d.title, d.status, d.branch, d.cancelled,
  (SELECT COUNT(*) FROM approval_steps s WHERE s.document_id = d.id) as total_steps,
  (SELECT COUNT(*) FROM approval_steps s WHERE s.document_id = d.id AND s.status = 'approved') as approved_steps
FROM documents d WHERE d.id LIKE 'test-doc-%' ORDER BY d.id;
