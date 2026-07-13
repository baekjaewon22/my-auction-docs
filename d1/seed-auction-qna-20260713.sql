-- qna/경매사례.md의 80개 사례를 법률지원 > 경매에 익명 질문/답변으로 등록합니다.
-- 고정 ID와 INSERT OR IGNORE를 사용하므로 여러 번 실행해도 중복 생성되지 않습니다.

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q001', '부동산은 왜 경매로 넘어가나요?', '경매 물건을 처음 보는데, 멀쩡한 아파트가 왜 경매로 나오는지 이해가 안 됩니다.

[분류] 경매절차
[난이도] 입문
[검색어] 경매 이유, 왜 경매, 채권 채무, 저당권, 빚, 대출 연체, 형식적경매

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q001', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q001',
  'auction', 0, 0, '2026-04-25 02:00:00', '2026-04-25 02:00:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q001', 'auction-qna-q001', u.id, '법률지원팀', '대부분은 채권·채무 관계 때문입니다. 돈을 빌려줄 때는 ①부동산에 저당권을 잡고 빌려주거나 ②신용을 보고 차용증·금전소비대차계약만 쓰고 빌려줍니다. 약속한 날짜에 돈을 갚지 않으면 채권자는 법원에 경매를 신청해 부동산을 팔아 채권을 회수합니다. 이 외에 공유물분할, 상속재산 정리처럼 돈 회수가 목적이 아닌 **형식적 경매**도 있습니다. 즉 "경매 물건 = 하자 있는 물건"이 아니라, "소유자가 돈 문제를 못 푼 물건"으로 이해하면 됩니다.

[핵심 체크]
- 저당권 실행 → 임의경매 / 판결문 등 집행권원 → 강제경매
- 물건 자체의 하자와 소유자의 채무 문제는 별개

[참고 근거]
- 교재 제1강 「왜? 부동산이 경매로 진행되는가」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-04-25 05:00:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q001')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q002', '강제경매와 임의경매는 뭐가 다른가요?', '사건번호는 똑같이 ''타경''인데 어떤 건 강제경매, 어떤 건 임의경매라고 표시됩니다.

[분류] 경매절차
[난이도] 입문
[검색어] 강제경매, 임의경매, 차이, 집행권원, 담보권 실행, 판결문, 근저당

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q002', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q002',
  'auction', 0, 0, '2026-04-26 02:17:00', '2026-04-26 02:17:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q002', 'auction-qna-q002', u.id, '법률지원팀', '**강제경매**는 확정판결문·공정증서 같은 **집행권원**을 가지고 채무자 재산을 압류·환가하는 절차입니다. **임의경매**는 저당권·근저당권·전세권 등 **담보물권을 실행**하는 경매로, 집행권원 없이도 신청할 수 있습니다(민사집행법 제264~275조). 실무에서 은행 근저당으로 진행되는 대부분의 사건이 임의경매이고, 카드사·개인 채권자가 판결을 받아 신청하면 강제경매입니다. 낙찰자 입장에서 권리분석 방법은 거의 동일하지만, 경매개시결정등기가 **강제경매개시결정등기**일 때는 그 자체가 말소기준권리가 될 수 있다는 점이 중요합니다.

[핵심 체크]
- 임의경매: 담보권 존재만 심사 / 강제경매: 집행권원 필요
- 강제경매개시결정등기 → 말소기준권리 6가지 중 하나

[참고 근거]
- 교재 제1강 「꼭 알아야 하는 경매용어」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-04-26 05:17:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q002')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q003', '경매 절차는 신청부터 배당까지 어떤 순서로 진행되나요?', '전체 그림이 안 잡혀서 각 단계가 무슨 의미인지 모르겠습니다.

[분류] 경매절차
[난이도] 입문
[검색어] 경매 절차, 진행 순서, 흐름, 개시결정, 배당요구종기, 매각기일, 배당

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q003', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q003',
  'auction', 0, 0, '2026-04-27 02:34:00', '2026-04-27 02:34:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q003', 'auction-qna-q003', u.id, '법률지원팀', '민사집행법상 순서는 다음과 같습니다.
1. 경매신청 및 경매개시결정(압류·기입등기 촉탁, 채무자 송달)
2. 배당요구 종기 결정 및 공고(압류효력 발생일부터 1주 내 결정)
3. 매각 준비(집행관 현황조사, 감정평가, 최저매각가격 결정, 매각물건명세서 작성)
4. 매각방법 지정·공고·통지(최초 매각기일은 공고일부터 14일 이상 뒤)
5. 매각 실시(기일입찰 또는 기간입찰 → 최고가매수신고인·차순위매수신고인 결정)
6. 매각결정절차(매각기일로부터 통상 7일 뒤 매각결정기일, 즉시항고 가능)
7. 매각대금 납부(지급기한 내 언제든 납부 가능)
8. 소유권이전등기 촉탁 및 인도명령
9. 배당절차(대금납부 후 배당기일 지정)

[핵심 체크]
- 배당요구 종기 = 첫 매각기일 이전 날짜
- 매각허가결정 확정 → 대금지급기한(통상 확정일부터 1개월 내)

[참고 근거]
- 교재 제1강 「민사집행법에 따른 법원경매진행절차」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-04-27 05:34:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q003')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q004', '배당요구를 안 하면 정말 한 푼도 못 받나요?', '확정일자도 받았고 순위도 앞서는데 배당요구를 깜빡했습니다.

[분류] 배당
[난이도] 중급
[검색어] 배당요구, 배당요구종기, 안 하면, 못 받음, 부당이득반환청구, 우선변제권

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q004', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q004',
  'auction', 0, 0, '2026-04-28 02:51:00', '2026-04-28 02:51:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q004', 'auction-qna-q004', u.id, '법률지원팀', '배당요구가 필요한 채권자가 종기까지 배당요구를 하지 않으면, **선순위여도 그 경매절차에서는 배당을 받을 수 없습니다.** 더 뼈아픈 것은, 자기보다 후순위인데 배당을 받아간 사람을 상대로 **부당이득반환청구도 할 수 없다**는 점입니다. 반드시 배당요구를 해야 하는 채권자는 ①집행력 있는 정본을 가진 채권자, ②법률상 우선변제청구권자(소액임차인, 확정일자부 임차인, 임금채권자 등), ③첫 경매개시결정등기 **후** 가압류한 채권자, ④국세 등 교부청구권자입니다. 반대로 첫 개시결정등기 **전**에 이미 등기를 마친 담보권자·임차권등기권자·가압류권자 등은 배당요구 없이도 배당받습니다.

[핵심 체크]
- 선순위 임차인이 배당요구를 안 하면 → 낙찰자가 보증금 전액 인수
- 배당요구는 종기일까지, 법원이 필요시 종기를 연기할 수 있음

[참고 근거]
- 교재 제1강 「배당요구의 종기 결정 및 공고」, 제4강 「배당의 요건」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-04-28 05:51:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q004')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q005', '말소기준권리가 대체 뭔가요? 한 문장으로 설명해 주세요.', '경매 책마다 말소기준권리가 제일 중요하다는데 감이 안 옵니다.

[분류] 권리분석
[난이도] 입문
[검색어] 말소기준권리, 말소기준, 기준권리, 인수, 소멸, 권리분석 시작, 핵심

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q005', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q005',
  'auction', 0, 0, '2026-04-29 02:08:00', '2026-04-29 02:08:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q005', 'auction-qna-q005', u.id, '법률지원팀', '등기부에 적힌 권리 중 **"돈이 목적인 권리"** 가운데 **순위가 가장 빠른 것**이 말소기준권리입니다. 해당하는 권리는 딱 6가지입니다.
①저당권 ②근저당권 ③압류 ④가압류 ⑤담보가등기 ⑥경매개시결정등기
이 기준선보다 **먼저** 들어온 권리는 낙찰자가 **인수**하고, **뒤에** 들어온 권리는 낙찰과 함께 **말소**됩니다. 다르게 말하면 "이 집에 누가 제일 먼저 깃발을 꽂았는가"를 찾는 작업입니다. 교재의 표현대로, 저당권자는 물건에 돈을 요구하고, 가압류권자는 사람에게 돈을 요구하고, 압류는 세금을 요구하고, 경매개시결정등기는 신청 자체가 돈 달라는 것이니 전부 ''돈이 목적''입니다.

[핵심 체크]
- 절대 외우지 말고 "돈이 목적인 권리 중 1번"으로 이해할 것
- 갑구·을구를 섞어서 **접수번호** 순으로 나열해야 정확함

[참고 근거]
- 교재 제2강 「말소기준권리란?」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-04-29 05:08:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q005')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q006', '갑구와 을구 중 어느 쪽 권리가 먼저인가요?', '갑구 2번 가압류와 을구 1번 근저당 중 누가 앞서는지 헷갈립니다.

[분류] 권리분석
[난이도] 입문
[검색어] 갑구 을구, 순위번호, 접수번호, 등기순위, 등기부등본 보는 법

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q006', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q006',
  'auction', 0, 0, '2026-04-30 02:25:00', '2026-04-30 02:25:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q006', 'auction-qna-q006', u.id, '법률지원팀', '같은 구(갑구끼리, 을구끼리) 안에서는 **순위번호**가 빠를수록 앞섭니다. 그러나 **갑구와 을구 사이의 순위는 순위번호가 아니라 ''접수번호''로 판단**합니다. 접수번호는 등기소가 접수 순서대로 부여하는 일련번호이기 때문입니다. 따라서 갑구 2번(접수 제2120호)과 을구 1번(접수 제39962호)이 있다면 접수번호가 작은 갑구 2번이 앞섭니다. 권리분석의 첫 작업은 등기부를 펼쳐 놓고 **갑구·을구를 막론하고 모든 권리를 접수번호 순으로 한 줄로 나열**하는 것입니다.

[핵심 체크]
- 표제부: 지번·면적 / 갑구: 소유권·가등기·가처분·가압류·압류·경매개시 / 을구: 저당권·지상권·전세권·임차권
- 예고등기 없고, 유치권 신고 없고, 맨 위가 저당권·가압류면 비교적 안전한 물건

[참고 근거]
- 교재 제2강 「등기부등본의 구성」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-04-30 05:25:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q006')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q007', '대항력은 어떻게 생기고, 언제부터 효력이 있나요?', '전입신고를 오늘 했는데 오늘 근저당이 잡히면 누가 앞서나요?

[분류] 임차인
[난이도] 입문
[검색어] 대항력, 점유 전입, 다음날 0시, 성립요건, 주택임대차보호법, 세입자 권리

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q007', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q007',
  'auction', 0, 0, '2026-05-01 02:42:00', '2026-05-01 02:42:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q007', 'auction-qna-q007', u.id, '법률지원팀', '대항력 = **인도(점유) + 전입신고**이고, 효력은 **전입한 다음 날 0시부터** 발생합니다. 그래서 같은 날 전입신고와 근저당이 있으면 **근저당이 앞섭니다.** 저당권은 당일 접수시각에 효력이 생기지만 임차인의 대항력은 그 다음 날 0시에 생기기 때문입니다. 하루 차이로 보증금 전액을 못 받는 사고가 실제로 가장 많이 나는 지점입니다.
- 9/7 전입 + 9/8 저당권 → **선순위 대항력**, 낙찰자 인수
- 9/7 전입 + 9/7 저당권 → **후순위**, 인수 안 함
- 9/7 전입 + 9/6 저당권 → **후순위**, 인수 안 함

[핵심 체크]
- 계약서 확정일자만 받고 이사를 안 갔으면 대항력 없음
- 원칙적으로 법인 임차인은 주택임대차보호법 적용 대상이 아님(일부 예외)

[참고 근거]
- 교재 제3강 「대항력의 성립요건」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-01 05:42:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q007')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q008', '세대합가(가족이 나중에 전입)면 누구 날짜가 기준인가요?', '아빠가 3월 17일 전입, 4월 3일 근저당, 5월 5일 아들이 전입했습니다. 임차인은 아들 명의입니다.

[분류] 임차인
[난이도] 중급
[검색어] 세대합가, 세대주, 세대원, 전입일자, 가족 전입, 배우자 전입, 딸 전입

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q008', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q008',
  'auction', 0, 0, '2026-05-02 02:59:00', '2026-05-02 02:59:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q008', 'auction-qna-q008', u.id, '법률지원팀', '대항력은 **세대주 여부와 상관없이 가장 먼저 전입한 세대원의 일자**를 기준으로 판단합니다. 이 사례에서는 아빠의 3월 17일 전입 다음 날 0시부터 대항력이 발생한 것으로 보므로, 4월 3일 근저당보다 **선순위**입니다. 반대로 이 구조를 놓치면 "아들 전입일(5/5)이 근저당(4/3)보다 늦으니 후순위"라고 오판해 보증금을 통째로 인수하게 됩니다. 전입세대열람 시 **세대주보다 전입일자가 빠른 세대원이 있는지** 반드시 확인해야 하는 이유입니다.

[핵심 체크]
- 전입세대열람에는 세대주보다 빠른 세대원 정보가 표시됨
- 세대원 전부가 전출되지 않는 한 세대주 일시 전출로도 대항력은 유지됨

[참고 근거]
- 교재 제3강 「대항력의 성립요건」, 「(참고자료) 주민등록」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-02 05:59:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q008')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q009', '선순위 임차인인데 확정일자가 없습니다. 입찰해도 되나요?', '말소기준권리보다 전입이 빠른 임차인인데 확정일자가 없고 배당요구도 안 했습니다.

[분류] 임차인
[난이도] 중급
[검색어] 선순위 임차인, 확정일자 없음, 보증금 인수, 전액 인수, 위험 물건

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q009', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q009',
  'auction', 0, 0, '2026-05-03 02:16:00', '2026-05-03 02:16:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q009', 'auction-qna-q009', u.id, '법률지원팀', '가장 위험한 유형입니다. 확정일자가 없으면 **법원 배당에 참여할 수 없고**, 선순위 대항력은 그대로 살아 있으므로 **보증금 전액을 낙찰자가 인수**합니다. 즉 "낙찰가 + 임차보증금 전액"이 실제 취득원가입니다. 시세 3억 아파트를 2억에 낙찰받았는데 선순위 보증금이 1억 5천이면 총 3억 5천을 쓴 셈이 됩니다. 임차인의 4가지 형태 중 이 유형(선순위 + 확정일자 ×)이 경매 사고의 핵심입니다.

[핵심 체크]
- 선순위 + 확정일자 ○ + 배당요구 ○ → 배당으로 다 못 받은 차액만 인수
- 선순위 + 확정일자 ○ + 배당요구 × → **전액 인수**
- 후순위는 확정일자 유무와 관계없이 낙찰자 인수 없음

[참고 근거]
- 교재 제3강 「임차인의 4가지 형태」, 제4강 「대항력과 우선변제권을 겸유한 경우」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-03 05:16:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q009')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q010', '전입일과 확정일자 중 배당기준일은 어느 날짜인가요?', '확정일자를 계약할 때 미리 받아놨고 전입은 나중에 했습니다.

[분류] 배당
[난이도] 중급
[검색어] 배당기준일, 우선변제권 기준일, 전입 확정 순서, 확정일자 먼저, 헷갈림

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q010', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q010',
  'auction', 0, 0, '2026-05-04 02:33:00', '2026-05-04 02:33:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q010', 'auction-qna-q010', u.id, '법률지원팀', '공식은 하나입니다. **배당기준일 = max(대항력 발생일, 확정일자일)**. 대항력은 전입 **다음 날 0시**에 생기므로 실무 정리는 이렇습니다.
- 전입이 먼저, 확정일자가 나중 → **확정일자 받은 날**이 배당기준일
- 확정일자가 먼저, 전입이 나중 → **전입 다음 날**이 배당기준일

| 점유 | 전입 | 확정일자 | 배당기준일 |
|---|---|---|---|
| 1/5 | 1/5 | 1/6 | 1/6 |
| 1/5 | 1/5 | 1/4 | 1/6 |
| 1/7 | 1/5 | 1/5 | 1/8 |
| 1/5 | 1/5 | 1/5 | 1/6 |

[핵심 체크]
- 점유가 늦으면 대항력도 늦어짐(점유·전입 둘 다 갖춘 다음 날 0시)
- 대항력 순위와 배당 순위는 **다를 수 있음** (선순위 대항력인데 배당은 후순위)

[참고 근거]
- 교재 제3강 「배당기준일」, 「확정일자 연습」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-04 05:33:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q010')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q011', '9/1 전입·9/5 확정, 9/3 근저당인 임차인은 어떻게 되나요?', '전입은 근저당보다 빠른데 확정일자가 근저당보다 늦습니다.

[분류] 임차인
[난이도] 중급
[검색어] 다행인 임차인, 선순위 대항력 후순위 배당, 확정일자 늦게, 사례 연습

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q011', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q011',
  'auction', 0, 0, '2026-05-05 02:50:00', '2026-05-05 02:50:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q011', 'auction-qna-q011', u.id, '법률지원팀', '임차인은 **선순위 대항력**이 있고, **배당은 저당권자 다음**에 받습니다. 대항력 판단선(전입 다음 날 0시 = 9/2)은 근저당(9/3)보다 앞서지만, 우선변제권 기준일은 확정일자를 받은 9/5이기 때문입니다. 결과적으로 배당에서 보증금을 다 못 받으면 **부족액을 낙찰자가 인수**합니다. 입찰자는 "선순위인데 확정일자가 늦다" 유형을 보면 반드시 예상배당표를 그려 인수 금액을 계산한 뒤 입찰가를 정해야 합니다.

[핵심 체크]
- 선순위 대항력 + 후순위 배당 = 인수 위험 존재
- 낙찰가가 낮을수록 임차인이 못 받는 금액 = 내가 물어줄 금액이 커짐

[참고 근거]
- 교재 제3강 「확정일자 연습」(예시3)

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-05 05:50:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q011')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q012', '임차인·KB은행·NH은행 배당기준일이 모두 같은 날이면?', '임차인C(9/1 전입, 9/2 확정, 보증금 1억), KB은행 근저당 2억(9/2), NH은행 근저당 1억(9/2), 낙찰가 2억.

[분류] 배당
[난이도] 심화
[검색어] 안분배당, 동순위, 같은 날, 비율 배당, 배당 계산, 예시7

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q012', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q012',
  'auction', 0, 0, '2026-05-06 02:07:00', '2026-05-06 02:07:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q012', 'auction-qna-q012', u.id, '법률지원팀', '셋 다 배당기준일이 9월 2일로 **동순위**이므로 **안분배당(비율배당)** 합니다. 채권 총액은 1억+2억+1억 = 4억.
- 임차인C: 2억 × (1/4) = **5,000만원** (미배당 5,000만원)
- KB은행: 2억 × (2/4) = **1억원** (미배당 1억원)
- NH은행: 2억 × (1/4) = **5,000만원** (미배당 5,000만원)
임차인C는 **선순위 대항력**이므로 배당받지 못한 5,000만원은 **낙찰자가 인수**합니다. 실질 매입가는 2억 5천만원인 셈입니다.

[핵심 체크]
- 같은 날 접수여도 은행 근저당끼리는 접수번호로 우열이 갈릴 수 있으니 등기부 원본 확인
- 안분 결과 부족액 → 선순위면 인수, 후순위면 소멸

[참고 근거]
- 교재 제3강 「확정일자 연습」(예시7), 표 「배당할 금액 2억원」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-06 05:07:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q012')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q013', '소액임차인 최우선변제는 무엇이고 요건이 뭔가요?', '확정일자가 없는데도 배당받는 임차인이 있다고 들었습니다.

[분류] 배당
[난이도] 중급
[검색어] 최우선변제, 소액임차인, 소액보증금, 1/2 한도, 확정일자 없어도, 배당요구

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q013', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q013',
  'auction', 0, 0, '2026-05-07 02:24:00', '2026-05-07 02:24:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q013', 'auction-qna-q013', u.id, '법률지원팀', '소액임차인의 **최우선변제권**입니다. 요건은 **소액보증금 + 경매개시결정등기 전 대항요건(점유+전입) + 배당요구**입니다. 확정일자는 요건이 아닙니다. 이 요건을 갖추면 **담보물권자보다 먼저**, **낙찰대금의 1/2 범위 내에서** 보증금 중 일정액을 받습니다(상가는 1/3). 1983년 12월 30일부터 시행됐습니다.

[핵심 체크]
- 최우선변제 = 확정일자 불필요, 배당요구는 필수
- 배당요구를 안 하면 최우선변제도 못 받고 부당이득반환청구도 불가

[참고 근거]
- 교재 제3강 「최우선변제권와 소액임차인」, 제4강 「배당순위」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-07 05:24:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q013')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q014', '소액임차인 해당 여부는 언제 날짜를 기준으로 판단하나요?', '지금 기준으로는 소액임차인인데 배당에서 빠졌다고 합니다.

[분류] 배당
[난이도] 중급
[검색어] 소액보증금 기준일, 담보물권 설정일, 근저당 설정일, 전입일 아님, 기준표

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q014', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q014',
  'auction', 0, 0, '2026-05-08 02:41:00', '2026-05-08 02:41:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q014', 'auction-qna-q014', u.id, '법률지원팀', '소액보증금 범위는 **임차인의 전입일이나 계약일이 아니라, 그 부동산에 최초로 설정된 담보물권(주로 근저당) 설정일**을 기준으로 판단합니다. 저당권이 없으면 담보가등기·전세권 설정일, 그것도 없으면 **경매개시결정등기일** 기준입니다(담보물권이 전혀 없고 가압류·압류만 있다면 실무상 **배당일 현재** 기준으로 판단).
교재의 사례가 극명합니다. 같은 날(2015-03-11) 전입, 같은 보증금 9,500만원인데
- 참이슬빌라(근저당 2013-12-30) → **배당 0원**
- 하이트빌라(근저당 2014-01-03) → **3,200만원 배당**
근저당 설정일 나흘 차이로 결과가 뒤집힙니다.

[핵심 체크]
- 담보물권에 가압류·압류는 포함되지 않음(우선변제권이 없기 때문)
- 확정일자부 임차인은 담보물권에 준하는 것으로 보는 판례 존재

[참고 근거]
- 교재 제3강 「소액보증금의 적용기준」, 「소액임차인 적용기준인 담보물건의 종류」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-08 05:41:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q014')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q015', '소액임차인이 여러 명이면 최우선변제금은 어떻게 나누나요?', '낙찰가 8,000만원(서울)에 소액임차인이 3명입니다.

[분류] 배당
[난이도] 심화
[검색어] 소액임차인 여러명, 3명, 안분, 1/2 한도, 최우선변제 계산, 비율

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q015', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q015',
  'auction', 0, 0, '2026-05-09 02:58:00', '2026-05-09 02:58:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q015', 'auction-qna-q015', u.id, '법률지원팀', '① 먼저 한도를 계산합니다. 8,000만원 × 1/2 = **4,000만원**.
② 각자 받아야 할 최우선변제금을 구합니다(예: B 1,600 / C 1,200 / D 1,600, 합계 4,400만원).
③ 한도(4,000만원)를 각자의 최우선변제금 비율대로 안분합니다.
- B: 4,000 × 1,600 ÷ 4,400 = **1,450만원**
- C: 4,000 × 1,200 ÷ 4,400 = **1,090만원**
- D: 4,000 × 1,600 ÷ 4,400 = **1,450만원**
남은 4,000만원이 그 다음 순위(근저당 등)로 내려갑니다.

[핵심 체크]
- 한도는 낙찰가(매각대금)의 1/2, 상가는 1/3
- 못 받은 나머지는 확정일자가 있으면 순위배당으로 다시 참여

[참고 근거]
- 교재 제3강 「소액임차인 배당연습」(예시10)

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-09 05:58:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q015')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q016', '배당 순위표를 순서대로 알려주세요.', '누가 먼저 배당받는지 순서가 헷갈립니다.

[분류] 배당
[난이도] 중급
[검색어] 배당순위, 1순위, 당해세, 임금채권, 집행비용, 순위표, 배당표

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q016', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q016',
  'auction', 0, 0, '2026-05-10 02:15:00', '2026-05-10 02:15:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q016', 'auction-qna-q016', u.id, '법률지원팀', '1. **경매 집행비용**
2. **필요비·유익비** (민법 제367조)
3. **최우선변제금 + 근로자 임금채권** (경합 시 동순위) — 주택 매각가 1/2, 상가 1/3 / 최종 3개월 임금, 3년분 퇴직금, 재해보상금
4. **당해세** — 국세: 상속세·증여세·종합부동산세 / 지방세: 재산세·자동차세·도시계획세·공동시설세 (취득세·등록세는 당해세 아님)
5. **담보물권 등** (여기서부터 등기부상 순위배당)
6. **일반 임금채권**
7. **담보물권에 후순위인 조세채권**
8. **공과금** (산재보험료·건강보험·국민연금·고용보험 등)
9. **일반채권** (가압류 등)

[핵심 체크]
- 3순위 최우선변제와 임금채권이 경합하면 동순위로 안분
- 낙찰가가 낮으면 5순위 근저당부터 이미 손실이 나기 시작

[참고 근거]
- 교재 제4강 「배당순위」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-10 05:15:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q016')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q017', '안분배당과 흡수배당의 차이는 뭔가요?', '가압류 다음에 근저당이 있는데 배당 계산이 이상합니다.

[분류] 배당
[난이도] 심화
[검색어] 안분배당, 흡수배당, 가압류 후 근저당, 비율배당, 우선변제권, 계산법

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q017', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q017',
  'auction', 0, 0, '2026-05-11 02:32:00', '2026-05-11 02:32:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q017', 'auction-qna-q017', u.id, '법률지원팀', '가압류는 채권이라 우선변제권이 없어 **모든 대상 채권을 합산해 비율대로 나누는 안분배당**을 먼저 합니다. 그런데 근저당권자는 **자기보다 후순위인 권리에 대해서는 우선변제권**이 있으므로, 안분배당 후 **후순위자가 받을 배당액에서 자기 채권이 만족될 때까지 끌어옵니다.** 이것이 **흡수배당**입니다.
즉 순서는 ①전부 안분 → ②우선변제권 있는 자가 후순위 몫을 흡수, 두 단계입니다.

[핵심 체크]
- 가압류 후 근저당: 가압류와는 동순위 안분, 근저당 뒤 권리는 흡수 대상
- 실무 팁: 이미 가압류가 있는 부동산은 은행이 "가압류 말소 조건"으로만 대출해 줌

[참고 근거]
- 교재 제2강 「권리간의 우선순위」(대법원 1987.6.9. 86다카2570, 1992.3.27. 91다44407)

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-11 05:32:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q017')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q018', '물권과 채권의 우선순위는 어떻게 되나요?', '"물권이 채권보다 우선한다"는 말의 예외가 있다고 들었습니다.

[분류] 권리분석
[난이도] 입문
[검색어] 물권 채권, 물권우선주의, 채권자평등의 원칙, 전입 확정일자, 예외

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q018', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q018',
  'auction', 0, 0, '2026-05-12 02:49:00', '2026-05-12 02:49:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q018', 'auction-qna-q018', u.id, '법률지원팀', '원칙은 **물권우선주의**(물권이 채권에 우선)와 **채권자평등의 원칙**(채권끼리는 순위 없이 평등, 그래서 안분)입니다. 물권끼리는 먼저 성립한 물권이 우선합니다.
예외가 딱 하나 있습니다. **임차인의 전입신고 + 확정일자**입니다. 이사(점유)하고 전입신고와 확정일자를 갖추면, 등기된 전세권과 **동일한 효력**을 얻어 물권처럼 순위배당에 참여합니다. 특별법(주택임대차보호법)이 채권인 임차권에 물권적 효력을 부여한 결과입니다.

[핵심 체크]
- 물권: 지배권·절대권 / 채권: 청구권·상대권
- 확정일자부 임차권 = 사실상 물권 취급

[참고 근거]
- 교재 제2강 「물권과 채권의 개념이해」, 제4강 「배당의 기본원칙」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-12 05:49:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q018')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q019', '선순위 가처분이 있는 물건, 입찰해도 되나요?', '등기부 맨 위에 가처분이 보입니다.

[분류] 특수물건
[난이도] 심화
[검색어] 가처분, 선순위 가처분, 소유권 상실, 처분금지가처분, 본안소송, 위험

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q019', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q019',
  'auction', 0, 0, '2026-05-13 02:06:00', '2026-05-13 02:06:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q019', 'auction-qna-q019', u.id, '법률지원팀', '**선순위 가처분은 초보자가 손대면 안 되는 물건**입니다. 가처분권자가 본안 소송에서 승소하면 **낙찰자가 소유권을 박탈**당할 수 있습니다. 대금까지 다 냈는데 소유권을 잃는 구조라 손실이 치명적입니다.
후순위 가처분은 원칙적으로 소멸하지만 **예외 2가지**가 있으니 방심하면 안 됩니다.
① 토지소유자가 그 지상 건물소유자를 상대로 한 가처분(건물철거청구 목적)
② 선순위 근저당이 이미 소멸했는데 형식상 등기만 남아 있는 경우(껍데기 근저당)

[핵심 체크]
- 가압류는 "돈 달라", 가처분은 "권리 달라"
- 후순위 가처분이라고 무조건 안심 금지

[참고 근거]
- 교재 제2강 「가처분의 권리분석」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-13 05:06:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q019')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q020', '가등기가 있는데 담보가등기인지 소유권이전청구권가등기인지 어떻게 아나요?', '등기부에는 그냥 "가등기"라고만 적혀 있습니다.

[분류] 특수물건
[난이도] 심화
[검색어] 가등기, 담보가등기, 소유권이전청구권가등기, 구별, 매각물건명세서, 본등기

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q020', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q020',
  'auction', 0, 0, '2026-05-14 02:23:00', '2026-05-14 02:23:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q020', 'auction-qna-q020', u.id, '법률지원팀', '등기부만으로는 구별되지 않습니다. **매각물건명세서, 법원 제출 자료(채권신고서 등)** 를 통해 성격을 파악해야 합니다. 실무상 **채권금액이 신고되어 있으면 담보가등기**로 봅니다.
- **담보가등기**: 목적이 돈. 선순위면 **말소기준권리**가 되고, 매각으로 소멸하며 순위에 따라 배당받습니다. (저당권과 같다고 보면 됨)
- **소유권이전청구권가등기**: 목적이 소유권. 매매예약등기로서 **등기순위에 따라 매수인에게 인수**됩니다. 가등기권자가 나중에 본등기를 하면 **낙찰자는 소유권을 잃습니다.**

[핵심 체크]
- 선순위 소유권이전청구권가등기 = 소유권 상실 위험, 입찰 회피
- 가등기와 본등기 사이의 다른 등기는 본등기 시 순위보전 효력으로 말소됨

[참고 근거]
- 교재 제2강 「가등기의 권리분석」, 제1강 「가등기」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-14 05:23:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q020')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q021', '유치권이 신고된 물건, 초보자가 입찰해도 되나요?', '공사업자가 유치권 3억을 신고했습니다. 감정가 대비 많이 떨어졌습니다.

[분류] 특수물건
[난이도] 심화
[검색어] 유치권, 유치권 신고, 공사대금, 점유, 인도명령 불가, 유치권포기각서

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q021', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q021',
  'auction', 0, 0, '2026-05-15 02:40:00', '2026-05-15 02:40:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q021', 'auction-qna-q021', u.id, '법률지원팀', '유치권이 성립하면 **인도명령을 통한 강제집행을 할 수 없고**, 유치권자와 협의해 **유치권포기각서**를 받아야 인도받을 수 있습니다. 유치권자는 배당에서 우선변제를 못 받지만, 채권 변제 전까지 인도를 거부할 수 있어 **사실상 우선변제권처럼 작동**합니다. 게다가 유치권은 **등기가 필요 없고 신고하지 않아도 법률상 당연히 발생**하므로, 신고가 없는 물건도 안심할 수 없습니다.
다만 반대로 보면, 유치권을 깰 수 있다고 판단되면 경쟁이 줄어 싸게 낙찰받을 기회이기도 합니다. 초보자 단계에서는 전문가 검토 없이는 피하는 것이 맞습니다.

[핵심 체크]
- 성립요건: 목적물 관련 채권 + 변제기 도래 + **적법한 점유** + 배제특약 없음 + **경매개시결정 이전 성립**(대법 2005다22688)
- 깨는 포인트: 점유의 적법성·계속성, 성립 시점, 채권의 견련성

[참고 근거]
- 교재 제4강 「유치권, 지상권, 예고등기 개념정리」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-15 05:40:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q021')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q022', '유치권은 어떤 경우에 소멸하나요?', '유치권을 깨는 방법이 궁금합니다.

[분류] 특수물건
[난이도] 심화
[검색어] 유치권 소멸, 점유 상실, 소멸시효, 담보 제공, 무단 임대, 깨는 법

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q022', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q022',
  'auction', 0, 0, '2026-05-16 02:57:00', '2026-05-16 02:57:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q022', 'auction-qna-q022', u.id, '법률지원팀', '- 유치권 자체에는 소멸시효가 없지만, **피담보채권이 소멸시효로 소멸하면 유치권도 소멸**합니다.
- 유치권자가 **채무자 승낙 없이** 목적물을 사용·임대·담보제공하면, 소멸청구 소송으로 소멸시킬 수 있습니다.
- 채무자가 **상당한 다른 담보를 제공**하고 소멸을 청구할 수 있습니다.
- 유치권자가 **점유를 상실**하면 소멸합니다(단, 불법행위로 점유를 잃은 경우 1년 내 점유물반환청구소송으로 회복하면 처음부터 소멸하지 않은 것으로 봄).

[핵심 체크]
- 현장에서 "실제로 계속 점유 중인가"를 사진·탐문으로 입증하는 것이 실무의 핵심
- 경매개시결정 이후에 점유를 시작한 유치권은 성립하지 않음

[참고 근거]
- 교재 제4강 「유치권의 소멸」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-16 05:57:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q022')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q023', '법정지상권이 성립하면 낙찰자는 어떻게 되나요?', '토지만 경매로 나왔는데 그 위에 건물이 있습니다.

[분류] 특수물건
[난이도] 심화
[검색어] 법정지상권, 토지만 낙찰, 건물 철거 불가, 지료, 성립요건, 관습법상 법정지상권

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q023', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q023',
  'auction', 0, 0, '2026-05-17 02:14:00', '2026-05-17 02:14:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q023', 'auction-qna-q023', u.id, '법률지원팀', '법정지상권이 성립하면 **토지 낙찰자는 건물을 철거시킬 수 없고**, 건물 소유자에게 토지 사용을 허용해야 합니다(지료 청구는 가능). 성립요건은 ①저당권 설정 당시 **건물이 존재**할 것 ②저당권 설정 당시 **토지와 건물의 소유자가 동일**할 것 ③경매로 **소유권이 분리**될 것입니다. **성립 시기는 매수인이 대금을 지급한 때**이며 **등기가 필요 없습니다.** 즉 **등기부에 지상권 등기가 없어도 성립할 수 있다**는 점이 함정입니다.

[핵심 체크]
- 등기부에 없다고 안심 금지 — 현장에서 건물 존재·건축 시점 확인 필수
- 법정지상권 성립 물건은 대출도 거의 안 나옴

[참고 근거]
- 교재 제4강 「법정지상권」, 「관습법상의 법정지상권」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-17 05:14:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q023')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q024', '대지권미등기 아파트, 감정평가에 대지가 포함되면 안전한가요?', '"대지와 건물을 함께 감정평가했으면 문제없다"는 말을 들었습니다.

[분류] 특수물건
[난이도] 심화
[검색어] 대지권미등기, 대지권, 감정평가 포함, 아파트, 속설, 대지권 성립여부

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q024', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q024',
  'auction', 0, 0, '2026-05-18 02:31:00', '2026-05-18 02:31:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q024', 'auction-qna-q024', u.id, '법률지원팀', '**법적으로는 틀린 말입니다.** 대지권 취득 여부는 **감정평가의 유무가 아니라 대지권의 성립 여부**에 따라 결정됩니다.
- 대지·건물 모두 감정평가되었지만 **대지권 성립요건을 못 갖췄다면 → 대지권 취득 불가**
- 건물만 감정평가되었지만 **대지권이 성립되어 있다면 → 대지권을 무상 취득 가능**
미등기 사유는 대개 분·합필 및 환지절차 지연, 세대당 지분비율 결정 지연, 시행사 내부사정, 타 세대 분양대금 미납 등 **절차적 사유**여서 실제로는 문제없는 경우가 많습니다. 다만 "많다"와 "안전하다"는 다릅니다.

[핵심 체크]
- 매각물건명세서의 비고란·특별매각조건 확인
- 분양계약서·시행사 확인으로 대지권 성립 여부를 직접 확인

[참고 근거]
- 교재 제4강 「대지권미등기」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-18 05:31:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q024')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q025', '토지별도등기 ''있음'' 표시가 된 빌라, 위험한가요?', '집합건물 등기부 을구 대지권란에 ''별도등기 있음''이 적혀 있습니다.

[분류] 특수물건
[난이도] 심화
[검색어] 토지별도등기, 별도등기 있음, 구분지상권, 토지 저당권, 을구 대지권란

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q025', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q025',
  'auction', 0, 0, '2026-05-19 02:48:00', '2026-05-19 02:48:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q025', 'auction-qna-q025', u.id, '법률지원팀', '토지 등기부를 반드시 함께 확인해야 합니다. 유형은 크게 둘입니다.
① **구분지상권**(지하철 지하구간 등) — 경매에서 큰 문제 없음
② **토지에 대한 저당권** — 시행사가 토지를 담보로 대출받은 뒤 미분양으로 상환하지 못한 경우. 이때 법원은 토지 저당권자에게 배당신청을 시켜 토지 해당분을 배당하고 별도등기를 말소하는 것이 일반적입니다.

[핵심 체크]
- 확인 3종: ①매각물건명세서 비고란 인수 여부 ②토지 저당권자의 채권계산서 제출 여부 ③감정평가서에 대지 평가 포함 여부
- 실무상 돈 받을 권리가 아닌 권리(가등기·가처분·지상권 등)는 매각조건에 인수 여부가 기재됨

[참고 근거]
- 교재 제4강 「토지별도등기」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-19 05:48:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q025')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q026', '임야를 낙찰받았는데 남의 묘가 있습니다. 옮길 수 있나요?', '토지 낙찰 후 현장에 가보니 분묘가 있습니다.

[분류] 특수물건
[난이도] 심화
[검색어] 분묘기지권, 묘, 분묘, 임야, 이장, 장사 등에 관한 법률, 20년 시효

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q026', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q026',
  'auction', 0, 0, '2026-05-20 02:05:00', '2026-05-20 02:05:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q026', 'auction-qna-q026', u.id, '법률지원팀', '분묘기지권이 성립하면 **철거·이장을 청구할 수 없습니다.** 성립요건은 시점에 따라 다릅니다.

[핵심 체크]
- 임야 입찰 전 현장 답사에서 분묘 유무·기수 확인은 필수
- 토지 입찰 시 체크: 분묘 / 법정지상권 / 진입로

[참고 근거]
- 교재 제4강 「분묘기지권」, 제7강 「토지(농지, 임야 등)」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-20 05:05:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q026')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q027', '예고등기가 있는 물건은 어떻게 되나요?', '오래된 등기부에 예고등기가 보입니다.

[분류] 특수물건
[난이도] 심화
[검색어] 예고등기, 말소 안 됨, 소유권 상실, 등기원인 무효, 예비등기

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q027', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q027',
  'auction', 0, 0, '2026-05-21 02:22:00', '2026-05-21 02:22:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q027', 'auction-qna-q027', u.id, '법률지원팀', '예고등기는 등기원인의 무효·취소로 인한 말소·회복의 소가 제기된 사실을 제3자에게 경고하기 위한 등기입니다. **경락(낙찰)과 관계없이 무조건 말소되지 않으며**, 낙찰 후에도 예고등기를 한 측이 승소하면 **낙찰자가 소유권을 상실**할 수 있습니다. 따라서 예고등기가 있는 물건은 입찰에 극도로 신중해야 합니다.
(참고: 예고등기 제도는 현재 폐지되어 신규 등기는 없지만, 과거에 마쳐진 예고등기가 남아 있는 물건이 여전히 등장할 수 있습니다.)

[핵심 체크]
- 권리분석 첫 단계에서 예고등기·유치권 신고 유무부터 확인
- 예고등기 + 유치권 없음 + 맨 위 저당권/가압류 = 비교적 안심 구조

[참고 근거]
- 교재 제1강 「예고등기」, 제2강 「등기부등본의 구성」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-21 05:22:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q027')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q028', '가장임차인(위장 임차인)은 어떻게 판별하나요?', '선순위 임차인이라는데 아무래도 소유자 가족 같습니다.

[분류] 임차인
[난이도] 심화
[검색어] 가장임차인, 위장임차인, 허위 임차인, 무상임차확인서, 판별법, 가족 임차인

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q028', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q028',
  'auction', 0, 0, '2026-05-22 02:39:00', '2026-05-22 02:39:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q028', 'auction-qna-q028', u.id, '법률지원팀', '판별 포인트는 다음과 같습니다.
① **금융권에서 정상적으로 대출이 실행**되었다(은행은 대출 시 무상임차확인서 등으로 임차인 부존재를 확인합니다 — 가장 강력한 단서).
② **확정일자가 없다.**
③ **배당요구를 하지 않는 경우가 많다.**
④ 임차인 이름이 채무자·소유자와 비슷하다(형제·가족).
⑤ 권리신고를 배당요구 종기일에 임박해서 한다.
⑥ 점유를 하지 않거나 일부만 점유한다.
의심 정황: 임대차계약이 저당권 설정 직전이나 경매개시 전후에 몰려 있는 경우, 친인척 간 계약, 실제 거주가 의심스러운 경우, 소액임차인 요건이 지나치게 딱 맞는 경우.

[핵심 체크]
- 조사법: 가족관계등록부 열람·주변 탐문 / 보증금 계좌이체 내역 확인 / 담보권 설정 시 방문조사한 금융기관 문의
- 임대차 성립 가능성 낮음: 부부간, 부모-자녀간, 사위-장모간
- 배제하기 어려움: 형제·자매간, 직계존비속 제외 친척간, 사돈간

[참고 근거]
- 교재 제5강 「가장임차인 판별법」, 「가장임차인 조사방법」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-22 05:39:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q028')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q029', '상가 임차인의 대항력·우선변제 요건은 주택과 뭐가 다른가요?', '상가 경매를 보는데 전입신고가 아니라 사업자등록이 나옵니다.

[분류] 임차인
[난이도] 중급
[검색어] 상가임대차보호법, 사업자등록, 상가 대항력, 환산보증금, 세무서 확정일자

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q029', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q029',
  'auction', 0, 0, '2026-05-23 02:56:00', '2026-05-23 02:56:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q029', 'auction-qna-q029', u.id, '법률지원팀', '상가는 주민등록 대신 **사업자등록**입니다.
- **대항력 = 인도(점유) + 사업자등록** → 신청한 **다음 날부터** 효력
- **우선변제 = 인도 + 사업자등록 + 확정일자**(확정일자는 **세무서**에서 받음)
- **최우선변제 = 인도 + 사업자등록 + 소액보증금**
그리고 결정적으로 상가는 **환산보증금**이 법 적용 범위 안에 들어와야 보호받습니다.

[핵심 체크]
- 상가건물임대차보호법 시행일: **2002년 11월 1일**
- 사업자등록 + 확정일자 + **실제 영업**까지 있어야 적용

[참고 근거]
- 교재 제5강 「상가의 대항력의 요건」, 「최우선변제의 요건」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-23 05:56:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q029')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q030', '환산보증금 계산 예시를 보여주세요.', '상가 임차인이 소액임차인인지 계산하고 싶습니다.

[분류] 임차인
[난이도] 입문
[검색어] 환산보증금, 계산, 월세 100배, 소액보증금 범위, 상가 최우선변제

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q030', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q030',
  'auction', 0, 0, '2026-05-24 02:13:00', '2026-05-24 02:13:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q030', 'auction-qna-q030', u.id, '법률지원팀', '**환산보증금 = 보증금 + (월세 × 100)**
- 사례1: 서울 강남구 개포동 문방구, 보증금 1,000만원 + 월세 30만원
 → 1,000 + (30 × 100) = **4,000만원** → 서울 소액보증금 범위 안 → **최우선변제 가능**
- 사례2: 서울 양천구 신월동 PC수리점, 보증금 2,000만원 + 월세 40만원
 → 2,000 + (40 × 100) = **6,000만원** → 서울 소액보증금 범위 초과 → **최우선변제 불가**
- 사례3: 보증금 1억 + 월세 180만원 → 1억 + 1억 8천 = **2억 8천만원** → 당시 적용범위 초과 → 보호법 대상 아님(민법 적용, 대항력 없음)

[핵심 체크]
- 적용 금액 기준은 **선순위 근저당 설정일 기준**으로 적용하며, 사업자등록일·확정일자 기준이 아님
- 근저당 설정일이 2002.11.1. 이전이면 상가 임차인은 그 저당권자보다 우선변제받지 못함

[참고 근거]
- 교재 제5강 「상가건물 최우선변제권의 보호범위 및 액수」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-24 05:13:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q030')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q031', '2018년 상가임대차보호법 개정으로 뭐가 바뀌었나요?', '상가 낙찰 후 임차인을 내보내려는데 갱신요구권을 주장합니다.

[분류] 임차인
[난이도] 중급
[검색어] 상가임대차보호법 개정, 2018년 9월 20일, 계약갱신요구권 10년, 권리금 6개월

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q031', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q031',
  'auction', 0, 0, '2026-05-25 02:30:00', '2026-05-25 02:30:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q031', 'auction-qna-q031', u.id, '법률지원팀', '2018년 9월 20일 개정으로 다음이 바뀌었습니다.
- **계약갱신요구권 행사기간이 5년 → 10년**으로 연장. 갱신되는 임대차는 전 임대차와 동일 조건으로 보되, 보증금·월세는 증감 가능하며 증액은 **5% 초과 불가**.
- **권리금 회수 기회 보호기간이 임대차 종료 3개월 전 → 6개월 전**으로 확대.
- 기존에 적용되지 않던 **전통시장에도 권리금 규정 적용**.
- 대한법률구조공단에 **상가건물임대차분쟁조정위원회** 설치.
상가 낙찰 시에는 명도 난이도와 기간이 주택보다 길어질 수 있음을 감안해 수익률을 계산해야 합니다.

[핵심 체크]
- 대항력 있는 상가 임차인은 갱신요구권까지 낙찰자에게 주장 가능
- 상가 입찰 전 임대차 시작일·갱신 이력 확인 필수

[참고 근거]
- 교재 제5강 「상가건물임대차보호법의 적용 보증금액의 범위」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-25 05:30:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q031')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q032', '전세권 설정과 전입신고+확정일자 중 뭐가 더 유리한가요?', '집주인이 전세권 설정을 해준다는데 굳이 해야 할지 모르겠습니다.

[분류] 임차인
[난이도] 중급
[검색어] 전세권, 확정일자, 비교, 차이, 토지 배당, 등기 당일 효력, 승계

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q032', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q032',
  'auction', 0, 0, '2026-05-26 02:47:00', '2026-05-26 02:47:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q032', 'auction-qna-q032', u.id, '법률지원팀', '| 구분 | 전세권 등기 | 입주+전입신고+확정일자 |
|---|---|---|
| 대상 | 주거·상가·기타 건물 | 사실상 주거용이면 가능(미등기·무허가 포함) |
| 요건 | 점유·주민등록 불필요 | 점유·주민등록 이전 및 유지 필요 |
| 대항력 | **등기 당일** 효력 발생 | 전입+입주 **다음 날**부터 |
| 절차 | 주인 동의 + 법원 설정등기 | 세입자 단독으로 동사무소 등에서 |
| 효력 | **등기한 건물 값에서만** 우선배당 | **건물 + 토지** 전체에서 우선배당 |
| 승계 | 제3자 승계(전대) 가능 | 주인 동의 없으면 승계 불가 |
| 비용 | 등록세·지방교육세 0.24% 등 (5천만원 기준 약 12.9만원) | 600원 (동사무소 일부 무료) |

[핵심 체크]
- 전세권을 건물에만 설정하면 **토지 매각대금에서는 배당 못 받음** → 토지까지 설정해야 하는 이유
- 실무에서는 **전입+확정일자를 기본**으로 하고, 필요 시 전세권을 추가하는 방식이 안전

[참고 근거]
- 교재 제4강 「전세권등기」 및 비교표

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-26 05:47:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q032')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q033', '다가구주택에 전세권만 설정했는데 경매를 못 넣는다고 합니다.', '다가구 1층에 전세권을 설정했는데 보증금을 못 받고 있습니다.

[분류] 특수물건
[난이도] 심화
[검색어] 다가구주택, 전세권, 경매 신청 불가, 1층만 임대, 보증금 반환 소송

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q033', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q033',
  'auction', 0, 0, '2026-05-27 02:04:00', '2026-05-27 02:04:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q033', 'auction-qna-q033', u.id, '법률지원팀', '다가구주택은 각 호실이 독립공간이지만 **소유권이 분리되어 있지 않습니다**(다세대와 다른 점). 2층에 집주인이 살고 1층만 임대한 경우, 전세권자는 **경매를 신청할 수 없습니다.** 2층에는 전세권 효력이 미치지 않아 건물 전체를 매각할 수 없고, 1·2층이 등기상 분리되어 있지 않아 1층만 따로 매각할 수도 없기 때문입니다.
이 경우에는 **보증금반환청구소송**으로 판결을 받아 그 확정판결을 집행권원으로 **강제경매**를 신청해야 합니다. 다만 자신이나 제3자가 신청한 경매사건에서 **우선변제권은 매각대금 전체에 대해 행사**할 수 있습니다.

[핵심 체크]
- 다가구: 3층 이하, 건물면적 660㎡ 이하, 소유권 단일
- 다가구 물건은 임차인 수가 많아 명도·배당 분석 난이도가 높음

[참고 근거]
- 교재 제4강 「다가구주택에서의 전세권설정」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-27 05:04:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q033')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q034', '임차권등기명령은 언제, 어떻게 쓰나요?', '계약이 끝났는데 보증금을 못 받았고, 새 집으로 이사는 가야 합니다.

[분류] 임차인
[난이도] 중급
[검색어] 임차권등기명령, 이사 가야 하는데, 보증금 못 받음, 대항력 유지, 1991년

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q034', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q034',
  'auction', 0, 0, '2026-05-28 02:21:00', '2026-05-28 02:21:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q034', 'auction-qna-q034', u.id, '법률지원팀', '임차권등기명령을 신청하면 이사를 가고 주민등록을 옮겨도 **대항력과 우선변제권이 유지**됩니다. 임대인의 동의 없이 **임차인 단독으로** 임차주택 소재지 관할 법원에 신청합니다.
가장 중요한 것은 효력 발생 시점입니다. **효력은 신청 시가 아니라 임차권등기가 실제로 마쳐진(경료된) 때 발생**합니다. 신청만 해놓고 곧바로 이사·전출하면 대항력을 잃습니다. **반드시 등기가 완료된 것을 확인한 뒤에 이사하세요.**

[핵심 체크]
- 임대차 **기간 종료 후** 신청 가능(합의 해지도 가능) / 보증금 **일부**만 못 받아도 신청 가능
- 등기 가능한 건물만 가능 — **무허가건물은 불가**
- 전차인은 신청 불가 / 등기 비용은 임대인에게 청구 가능(주임법 제3조의3 제8항)

[참고 근거]
- 교재 제4강 「임차권등기명령」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-28 05:21:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q034')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q035', '무잉여로 경매가 취소된다는 게 무슨 뜻인가요?', '열심히 분석했는데 무잉여로 취소될 수 있다고 합니다.

[분류] 경매절차
[난이도] 중급
[검색어] 무잉여, 잉여의 가망, 경매 취소, 직권 취소, 남는 게 없음, 후순위 채권자

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q035', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q035',
  'auction', 0, 0, '2026-05-29 02:38:00', '2026-05-29 02:38:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q035', 'auction-qna-q035', u.id, '법률지원팀', '최저매각가격으로 경매신청채권자의 채권에 **우선하는 부담 전부 + 경매비용**을 변제하면 **남는 것이 없을 때**, 법원은 이를 신청채권자에게 통지하고, 채권자가 7일 내에 우선채권을 넘는 가격으로 매수신청(+보증 제공)하지 않으면 **직권으로 경매를 취소**합니다.
조건식: **[ 경매비용 + 우선변제 채권액 ≧ 최저매각가격 ] → 직권 취소**
후순위 채권자가 신청한 사건에서 유찰이 거듭돼 최저가가 낮아지면 무잉여가 될 수 있습니다. 낙찰까지 받았는데 절차가 취소되면 시간과 기회비용을 날립니다.

[핵심 체크]
- 신청채권자의 채권액이 선순위 부담 대비 지나치게 작으면 무잉여·취하 위험 신호
- 선순위 채권자가 중복경매를 신청하면 무잉여 취소를 막을 수 있음

[참고 근거]
- 교재 제1강 「무잉여」, 제8강 「무잉여 가능성 판단」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-29 05:38:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q035')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q036', '낙찰받았는데 채무자가 빚을 갚아 취하되면 어떻게 되나요?', '낙찰 후 채무자가 돈을 마련했다며 취하하려 합니다.

[분류] 입찰낙찰
[난이도] 중급
[검색어] 경매 취하, 낙찰 후 취하, 동의, 최고가매수신고인 동의, 시간 낭비

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q036', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q036',
  'auction', 0, 0, '2026-05-30 02:55:00', '2026-05-30 02:55:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q036', 'auction-qna-q036', u.id, '법률지원팀', '경매 취하는 **경매신청채권자만** 할 수 있고, **매각대금 납부 전까지** 가능합니다. 다만 **최고가매수신고인이 결정된 뒤에는 최고가매수신고인과 차순위매수신고인의 동의가 없으면 취하할 수 없습니다.** 즉 낙찰 후에는 내가 동의하지 않으면 취하되지 않습니다.
문제는 채무자·소유자가 **취소**(변제 후 강제집행 취소)로 방향을 틀 수 있다는 것입니다. 취소에는 **낙찰자 동의가 필요 없습니다.**

[핵심 체크]
- 취하 위험 신호: 청구금액이 감정가·시세 대비 아주 적음, 다른 채권자가 없음
- 중복사건은 선행사건이 취하돼도 후행사건이 진행되므로 취하 위험이 낮은 편
- 취하되면 보증금은 돌려받지만 이자 손실과 시간 손실은 회복 불가

[참고 근거]
- 교재 제8강 「경매 취하 가능성 판단」, 「경매 취소 가능성 판단」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-30 05:55:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q036')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q037', '공유자우선매수권 때문에 지분 물건은 못 먹는다던데요?', '지분 물건에 최고가로 입찰했는데 공유자가 우선매수를 신고했습니다.

[분류] 입찰낙찰
[난이도] 중급
[검색어] 공유자우선매수권, 지분경매, 공유지분, 호창, 우선매수 신고, 민사집행법 140조

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q037', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q037',
  'auction', 0, 0, '2026-05-31 02:12:00', '2026-05-31 02:12:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q037', 'auction-qna-q037', u.id, '법률지원팀', '민사집행법 제140조에 따라 공유자는 **매각기일까지 보증을 제공하고 최고가매수신고가격과 같은 가격으로 우선매수하겠다는 신고**를 할 수 있고, 적법한 신고가 있으면 **법원은 공유자에게 매각을 허가**해야 합니다. 즉 내가 아무리 높게 써도 공유자가 같은 가격에 가져갈 수 있습니다.
타이밍이 핵심입니다. 집행관이 "공유자 우선매수신고 하시겠습니까"라고 묻고 **호창(최고가매수인 선언)이 끝나기 전**에 신고해야 합니다. 반응이 없으면 집행관은 그대로 최고가매수인을 선언하고 사건을 종결합니다.

[핵심 체크]
- 입법 취지: 새로운 사람이 공유자로 들어오는 것보다 기존 공유자에게 기회를 주는 것이 적절
- 지분 물건은 대출도 어렵고(대지지분 경매물건) 실익 계산을 보수적으로

[참고 근거]
- 교재 제1강 「공유자우선매수권」, 제8강 「공유자우선매수신고」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-05-31 05:12:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q037')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q038', '차순위매수신고는 언제 하는 게 유리한가요?', '1등이 시세보다 훨씬 높게 써서 미납할 것 같습니다.

[분류] 입찰낙찰
[난이도] 중급
[검색어] 차순위매수신고, 차순위, 보증금 묶임, 미납 예상, 잔금 미납

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q038', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q038',
  'auction', 0, 0, '2026-06-01 02:29:00', '2026-06-01 02:29:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q038', 'auction-qna-q038', u.id, '법률지원팀', '차순위매수신고를 할 수 있는 사람은 **최고가매수신고액에서 보증금을 뺀 금액보다 높게 쓴 입찰자**입니다. 1등이 ①0을 하나 더 붙이는 등 터무니없는 금액을 썼거나 ②선순위 임차보증금 인수를 모르고 높게 썼다면 **잔금 미납 가능성이 높으므로** 차순위신고를 해볼 만합니다.
단, **입찰보증금이 최고가매수인의 잔금납부 시점까지 약 1~2개월 묶입니다.** 그 기간의 자금 기회비용을 감수할 수 있을 때만 하세요.

[핵심 체크]
- 최고가매수인이 대금을 완납하면 차순위매수신고인은 즉시 보증금을 돌려받음
- 미납 시 차순위매수신고인에 대한 매각허가 여부를 법원이 결정

[참고 근거]
- 교재 제8강 「차순위매수신고」, 제1강 「차순위매수신고인」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-01 05:29:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q038')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q039', '입찰표에 금액을 잘못 써서 두 줄 긋고 고쳤습니다. 괜찮나요?', '입찰가를 쓰다가 실수해서 고쳐 썼습니다.

[분류] 입찰낙찰
[난이도] 입문
[검색어] 입찰표 정정, 수정, 무효, 개찰 제외, 입찰가액 정정, 실수

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q039', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q039',
  'auction', 0, 0, '2026-06-02 02:46:00', '2026-06-02 02:46:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q039', 'auction-qna-q039', u.id, '법률지원팀', '**무효입니다.** 입찰가액의 기재를 정정한 경우에는 **정정인 날인 여부를 불문하고 개찰에서 제외**됩니다. 도장을 찍든 안 찍든 소용없습니다. **새 용지를 받아 처음부터 다시 쓰세요.** 입찰표는 얼마든지 다시 받을 수 있습니다.
개찰에서 제외되는 또 다른 경우: 입찰자 본인 또는 대리인의 주소·성명이 **위임장 기재와 다른** 경우.

[핵심 체크]
- 입찰금액은 숫자를 정자로 또박또박, **수정 절대 금지**
- 흔한 사고: 입찰금액과 입찰보증금 칸을 바꿔 씀 / 보증금 부족 / 인감증명서와 인감도장 불일치 / 1개 사건에 1인이 중복입찰

[참고 근거]
- 교재 제8강 「개찰에서 제외시키는 경우」, 「입찰표 작성시 주의사항」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-02 05:46:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q039')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q040', '사건번호나 물건번호를 안 썼습니다. 무효인가요?', '입찰표에 일부 기재를 빠뜨렸습니다.

[분류] 입찰낙찰
[난이도] 중급
[검색어] 사건번호 누락, 물건번호 누락, 개찰 포함, 입찰봉투, 특정 가능

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q040', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q040',
  'auction', 0, 0, '2026-06-03 02:03:00', '2026-06-03 02:03:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q040', 'auction-qna-q040', u.id, '법률지원팀', '"특정할 수 있는가"가 기준입니다(대법원 송민 93-2 제10조의2).

[핵심 체크]
- 사건번호는 입찰표에 맞게 썼어도 **입찰봉투에 틀리게 쓰면** 경쟁입찰일 때 제외됨
- 물건번호가 여러 개인 사건은 물건번호 누락이 치명적

[참고 근거]
- 교재 제8강 「입찰 무효처리 기준」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-03 05:03:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q040')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q041', '입찰하러 갈 때 뭘 챙겨야 하나요? (개인/대리인/법인/공동)', '처음 법원에 갑니다.

[분류] 입찰낙찰
[난이도] 입문
[검색어] 준비서류, 신분증, 도장, 인감증명서, 대리입찰, 법인 입찰, 공동입찰

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q041', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q041',
  'auction', 0, 0, '2026-06-04 02:20:00', '2026-06-04 02:20:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q041', 'auction-qna-q041', u.id, '법률지원팀', '- **개인 입찰**: ①신분증 ②도장(막도장 가능, 경우에 따라 지장도 가능)
- **개인 대리인 입찰**: ①대리인 신분증 ②대리인 도장 ③**본인의 인감도장**(입찰표 뒷면 위임장에 날인) ④**본인의 인감증명서**
- **법인 입찰**: ①대표자 신분증 ②도장(법인인감 아니어도 됨) ③법인등기부등본
- **법인 대리인 입찰**: ①대리인 신분증 ②대리인 도장 ③법인인감도장(위임장 날인) ④법인등기부등본 ⑤법인인감증명서
- **공동입찰**: ①전원 신분증 ②전원 도장(막도장 가능) ③**공동입찰신고서** ④**공동입찰자목록** — 공동입찰 서류는 **간인 필수**
공동입찰자 전원 참석이 원칙이며, 불참자가 있으면 그 사람에 대해 대리인 서류(인감증명서·인감도장)를 제출해야 합니다.

[핵심 체크]
- 매수보증금은 최저매각가격의 **10%**. 재매각 사건 등 특별매각조건이면 **20~30%** — 반드시 사전 확인
- 보증금은 수표 1장으로 준비하는 것이 안전

[참고 근거]
- 교재 제8강 「경매 입찰시 준비서류」, 제1강 「매수보증금」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-04 05:20:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q041')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q042', '입찰 당일 아침에 뭘 확인해야 하나요?', '법원에 갔는데 사건이 변경됐다고 하면 허탕입니다.

[분류] 입찰낙찰
[난이도] 입문
[검색어] 입찰 당일, 진행여부 확인, 취하 연기, 변경, 경매계 전화, 송달통지서

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q042', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q042',
  'auction', 0, 0, '2026-06-05 02:37:00', '2026-06-05 02:37:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q042', 'auction-qna-q042', u.id, '법률지원팀', '① 대법원 사이트에서 **연기신청서 제출 여부** 확인(매각기일 전날 18시 이후 열람 가능)
② 입찰일 **오전에 법원 경매계에 직접 전화** — 당일에 취하·연기가 접수되는 경우도 있습니다
③ 경매법정 게시판의 **취하/변경 사건 공고** 확인
그리고 법원에 조금 일찍 도착해 **경매기록을 다시 열람**하세요. 인터넷에 공개되지 않는 임차인·채무자 제출 서류를 볼 수 있고, 특히 **송달통지서의 적법송달 여부**는 향후 경매 결과에 중대한 영향을 미치므로 입찰 당일 반드시 확인해야 합니다.

[핵심 체크]
- 입찰은 보통 10시 시작, 마감은 법원마다 다름(서울중앙 11:10, 수원 본원 11:40, 의정부 본원 11:50, 부천 오후 14:00 등)
- "10시까지 입장"이 아니라 **마감시간까지 입찰표 제출**이면 됨

[참고 근거]
- 교재 제8강 「입찰 당일 확인사항」, 「경매 입찰법정 분위기 익히기」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-05 05:37:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q042')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q043', '유찰되면 가격이 얼마나 떨어지나요?', '2회 유찰된 물건인데 가격 계산이 헷갈립니다.

[분류] 경매절차
[난이도] 입문
[검색어] 유찰, 저감, 20% 30%, 최저매각가격, 재경매, 감정가

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q043', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q043',
  'auction', 0, 0, '2026-06-06 02:54:00', '2026-06-06 02:54:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q043', 'auction-qna-q043', u.id, '법률지원팀', '유찰은 매각기일에 아무도 매수하지 않아 매각되지 않은 경우입니다. 통상 **20~30% 저감**된 가격으로 다음 매각기일에 다시 진행합니다. 중요한 것은 **감정평가액 자체는 변하지 않고 최저매각가격만 저감**된다는 점, 그리고 **2회 유찰이면 이미 저감된 최저가에서 다시 20~30%를 저감**한다는 점입니다(단순 40~60% 차감이 아닙니다).
예: 감정가 1억, 저감률 30% → 1회 유찰 7,000만원 → 2회 유찰 4,900만원.

[핵심 체크]
- 저감률은 법원마다 20% 또는 30%로 다름
- **재매각(재경매)** 은 유찰이 아니라 낙찰자가 잔금을 미납해 다시 하는 매각 — 이때는 **최저매각가격이 낮아지지 않습니다**

[참고 근거]
- 교재 제1강 「유찰 & 재경매」, 제2강 「최저매각가격의 결정」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-06 05:54:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q043')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q044', '잔금을 못 내면 보증금은 어떻게 되나요?', '대출이 안 나와서 잔금을 못 낼 것 같습니다.

[분류] 입찰낙찰
[난이도] 중급
[검색어] 잔금 미납, 보증금 몰수, 몰취, 재매각, 배당재단 편입, 재입찰 금지

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q044', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q044',
  'auction', 0, 0, '2026-06-07 02:11:00', '2026-06-07 02:11:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q044', 'auction-qna-q044', u.id, '법률지원팀', '지급기한까지 대금을 내지 않으면 ①차순위매수신고인이 있으면 그에 대한 매각허가 여부를 결정하고 ②없으면 **재매각**을 명합니다. 이때 종전 매수인의 **매수신청보증금은 돌려받지 못하고 배당재단에 편입**됩니다(몰취).
또한 **종전 매수인은 재매각 절차에 참가할 수 없습니다.** 재매각기일에는 종전과 **같은 최저매각가격·매각조건이 그대로 적용**되어 가격이 낮아지지 않습니다.
되돌릴 방법은 하나 있습니다. **재매각기일 3일 전까지 매각대금 + 연 20% 지연이자 + 재매각 절차비용을 납부**하면 재매각 절차가 취소되고 소유권을 취득할 수 있습니다.

[핵심 체크]
- 잔금 미납의 최다 원인 = **대출 미실행**. 입찰 전 3곳 이상 금융기관에 사전 확인
- 재매각 사건은 보증금이 20~30%로 올라가는 경우가 많음

[참고 근거]
- 교재 제1강 「매각대금 미지급에 따른 법원의 조치」, 「유찰 & 재경매」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-07 05:11:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q044')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q045', '경락대출은 얼마나 나오나요?', '낙찰가의 몇 %까지 대출이 가능한지 궁금합니다.

[분류] 대출등기
[난이도] 중급
[검색어] 경락대출, 낙찰잔금대출, 80%, 원시취득, LTV, DTI, 대출 한도

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q045', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q045',
  'auction', 0, 0, '2026-06-08 02:28:00', '2026-06-08 02:28:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q045', 'auction-qna-q045', u.id, '법률지원팀', '일반매매는 **승계취득**이고 법원경매 낙찰은 **원시취득**입니다. 원시취득은 특별한 경우를 제외하면 소유권 이외의 권리가 남지 않으므로 은행 입장에서 담보가 깨끗해, **일반매매보다 대출 한도를 더 주는 경향**이 있습니다.
아파트·빌라·연립·다세대의 경우 **낙찰가의 80%까지** 가능한 것이 통상입니다. 보통 70% 이하 구간은 이자율이 동일하고, 70%를 넘어가면 이자율이 올라갑니다. 소득·신용이 양호하면 80%도 가능합니다.
다만 **지역별 대출규제(LTV·DTI)** 에 따라 크게 달라지므로 반드시 현행 기준으로 재확인해야 합니다.

[핵심 체크]
- **LTV**(담보인정비율): 담보가치 대비 대출 한도
- **DTI**(총부채상환비율): 연소득 대비 연간 원리금 상환액 제한. 예) DTI 40%면 연간 상환액이 연소득의 40% 이내
- 확인 4종: ①가능금액·이자율 ②취득세·등록세·근저당설정비·법무사비 등 추가비용 ③매매 시 승계·상환 조건 ④기타 조건

[참고 근거]
- 교재 제8강 「경락대출」, 「물건별 대출가능금액 및 이자율」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-08 05:28:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q045')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q046', '대출이 아예 안 나오는 물건은 어떤 것들인가요?', '낙찰 후 대출 상담을 갔더니 안 된다고 합니다.

[분류] 대출등기
[난이도] 중급
[검색어] 대출 불가, 대출 안 되는 물건, 선순위 전입자, 유치권, 법정지상권, 지분

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q046', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q046',
  'auction', 0, 0, '2026-06-09 02:45:00', '2026-06-09 02:45:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q046', 'auction-qna-q046', u.id, '법률지원팀', '은행은 채권회수를 위해 완벽한 담보를 요구하므로 다음 물건은 대출이 어렵습니다.
㉠ **말소기준권리보다 앞선 선순위 전입자**가 있는 물건 (권리가 없는 채무자 겸 소유자의 자녀가 전입해 있어도 대출 불가. 단 배당요구를 한 선순위 전입자는 무관)
㉡ 유치권 성립 물건
㉢ 법정지상권 성립 물건
㉣ **대지지분(지분) 경매물건**
㉤ 대지지분 없는 아파트 및 건물
㉥ 도시계획저촉 도로 ㉦ 근린공원 ㉧ 철도 ㉨ 공공용지
반대로 보면, 대출이 어려운 물건은 경쟁이 적어 낙찰가가 낮아지므로 **자금 여력이 있고 권리를 깰 수 있다면 오히려 수익 기회**가 됩니다.

[핵심 체크]
- **반드시 입찰 전에** 물건정보를 들고 은행·대출상담사에게 가능 여부를 확인
- 대출 실행에는 자필 후 3~4일이 소요 → 잔금 일정 역산

[참고 근거]
- 교재 제8강 「대출이 어려운 물건」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-09 05:45:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q046')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q047', '채권상계신청(차액지급신고)이 뭔가요?', '제가 근저당권자인데 제 물건을 낙찰받았습니다.

[분류] 대출등기
[난이도] 심화
[검색어] 채권상계, 차액지급신고, 상계, 퉁친다, 배당받을 채권자가 낙찰

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q047', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q047',
  'auction', 0, 0, '2026-06-10 02:02:00', '2026-06-10 02:02:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q047', 'auction-qna-q047', u.id, '법률지원팀', '낙찰자가 동시에 **배당받을 채권자**인 경우, 자신이 받을 배당액을 뺀 나머지 대금만 내겠다고 법원에 신고할 수 있습니다. 이것이 **채권상계신청(차액지급신고)** 입니다. 쉽게 말해 "퉁친다"입니다.

[핵심 체크]
- 기한 도과 시 전액 현금 납부해야 함 → 자금 계획 붕괴
- 유사 제도: **채무인수신청** (아래 Q048)

[참고 근거]
- 교재 제8강 「채권상계신청」, 제1강 「매각대금 지급의 효과」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-10 05:02:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q047')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q048', '채무인수로 잔금을 줄일 수 있나요?', '잔금이 부족한데 방법이 없을까요?

[분류] 대출등기
[난이도] 심화
[검색어] 채무인수, 채무인수신청, 잔금 줄이기, 승낙서, 근저당 인수

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q048', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q048',
  'auction', 0, 0, '2026-06-11 02:19:00', '2026-06-11 02:19:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q048', 'auction-qna-q048', u.id, '법률지원팀', '매수인은 **배당표 실시에 관계되는 채권자들이 승낙하면** 매각대금 한도에서 대금 납부 대신 **채무를 인수**할 수 있습니다. 예를 들어 1억에 낙찰받은 아파트에 은행 근저당 2천만원이 있고 은행이 승낙하면, 2천만원 채무를 인수하고 **8천만원만 납부**하면 됩니다.
절차: **대금납부기일이 지정되기 전**에 채무인수 신청서를 제출하고, ①채권자의 **채무인수승낙서** ②인감증명서 ③부동산 목록 ④채권계산서를 첨부합니다. 채무인수가 이루어지면 채권자 요구에 따라 채무자를 매수인으로 바꾸는 변경등기를 합니다.

[핵심 체크]
- 강제사항이 아닌 **협의사항** → **입찰 전에** 채권자와 미리 협의해야 실현 가능
- 상계(내가 받을 배당과 상계)와 인수(남의 채무를 떠안음)는 다른 제도

[참고 근거]
- 교재 제8강 「채무인수신청」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-11 05:19:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q048')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q049', '소유권이전등기는 낙찰자가 직접 하나요, 법무사를 쓰나요?', '등기 비용을 아끼고 싶습니다.

[분류] 대출등기
[난이도] 중급
[검색어] 소유권이전등기촉탁, 셀프등기, 법무사, 잔금대출, 등기권리증, 절차

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q049', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q049',
  'auction', 0, 0, '2026-06-12 02:36:00', '2026-06-12 02:36:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q049', 'auction-qna-q049', u.id, '법률지원팀', '- **대출을 받는 경우**: 낙찰자가 직접 촉탁 신청을 **할 수 없습니다.** 은행이 지정한 법무사가 잔금 납부와 소유권이전·근저당 설정을 동시에 처리합니다.
- **전액 현금 납부하는 경우**: **셀프등기** 가능합니다.
셀프등기 절차: ①경매계 방문(대금납부서 수령) → ②은행(잔금 납부) → ③경매계(낙찰대금완납증명서 수령) → ④물건지 구청(세무과·지적과) → ⑤은행(취·등록세 납부, 국민주택채권 매입) → ⑥경매계(소유권이전등기촉탁 신청서 제출) → ⑦약 1주 후 등기권리증 수령.
제출서류: 주민등록등본, 등록세 영수필통지서·영수필확인서, 국민주택채권매입필증 등.

[핵심 체크]
- 촉탁등기 신청 후 약 2주면 등기필 날인된 권리증이 경매법원을 통해 지급됨
- 등기소는 이전등기 후 **인수되지 않는 권리를 말소**함

[참고 근거]
- 교재 제8강 「소유권이전등기촉탁」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-12 05:36:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q049')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q050', '인도명령은 언제까지 신청해야 하나요?', '점유자가 나가지 않습니다.

[분류] 명도
[난이도] 중급
[검색어] 인도명령, 6개월, 기한, 명도소송, 대금완납, 강제집행

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q050', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q050',
  'auction', 0, 0, '2026-06-13 02:53:00', '2026-06-13 02:53:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q050', 'auction-qna-q050', u.id, '법률지원팀', '매수인은 **대금 완납 후 6개월 이내**에 인도명령을 신청할 수 있습니다. **6개월이 지나면 인도명령이 아니라 명도소송**을 해야 하는데, 판결까지 통상 6개월, 강제집행까지 합치면 **총 7~8개월**이 걸립니다. 인도명령은 신청 후 보통 2주 내 결정이 나므로 시간 차이가 어마어마합니다.

[핵심 체크]
- 신청서에 1,000원 인지 첨부, 1통 제출, 송달료(2회분) 납부
- 유치권 신고가 있는 사건은 기본 양식으로 내면 **기각**될 수 있음 → 유치권 불성립 사유와 입증자료를 첨부해 작성

[참고 근거]
- 교재 제8-2강 「인도명령」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-13 05:53:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q050')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q051', '인도명령 대상이 되는 사람은 누구인가요?', '집에 있는 사람이 임차인이라고 주장합니다.

[분류] 명도
[난이도] 중급
[검색어] 인도명령 대상자, 채무자, 소유자, 점유자, 대항력 없는 임차인, 점유보조자

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q051', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q051',
  'auction', 0, 0, '2026-06-14 02:10:00', '2026-06-14 02:10:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q051', 'auction-qna-q051', u.id, '법률지원팀', '- **채무자**: 개시결정에 표시된 채무자 및 특정승계인, 동거 가족·고용인, 법인의 기관, 점유보조자·관리자, 채무자와 공모해 집행을 방해할 목적으로 점유한 자, 근친자
- **소유자**: (강제경매) 압류 당시 소유명의자 / (임의경매) 소유자 겸 채무자, 일반승계인, 압류 후 제3취득자
- **점유자**: 압류 효력 발생 후 **대항력 없는 직접 점유자**, 압류 전에 점유를 풀었다가 압류 후 다시 점유한 자, 압류 전 전대했다가 압류 후 전대계약을 해제해 직접 점유한 자, **경매개시결정 기입등기 이후의 임차인·지상권자·전세권자**
즉 대항력 없는 임차인은 인도명령 대상입니다. 대항력 있는 선순위 임차인은 인도명령 대상이 아닙니다.

[핵심 체크]
- 점유자는 **강제집행 종료 시까지** 인도명령에 불복 가능
- 점유가 제3자에게 승계된 경우 **승계집행문**을 받아 집행

[참고 근거]
- 교재 제8-2강 「인도명령 대상자」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-14 05:10:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q051')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q052', '강제집행은 어떤 순서로, 얼마나 걸리나요?', '협상이 결렬돼 강제집행까지 가야 할 것 같습니다.

[분류] 명도
[난이도] 중급
[검색어] 강제집행, 절차, 기간, 송달증명원, 집행관사무실, 집행비용 예납

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q052', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q052',
  'auction', 0, 0, '2026-06-15 02:27:00', '2026-06-15 02:27:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q052', 'auction-qna-q052', u.id, '법률지원팀', '1. 인도명령 신청 (대금완납 후 즉시 가능)
2. 서면심리 및 심문 (민사집행법 제136조 제4항)
3. **인도명령 결정** — 신청 후 **약 2주**
4. 인도명령 결정문 송달 — **1~2주**
5. **송달증명원** 발급 (송달 즉시)
6. 강제집행 신청 (인도명령결정문 + 송달증명원)
7. 집행관사무실 접수 → 8. 현장 조사 → 9. **집행비용 예납**
10. 강제집행 기일 통지 — **약 2주**
11. 강제(인도)집행 실시
방문 신청 시 당일 접수 가능하지만, 우편 접수는 1~2주가 더 걸립니다.

[핵심 체크]
- 인도명령은 채무명의가 부여된 것이므로 **집행문 부여 불필요**(승계가 있으면 승계집행문 필요)
- 실무 총 소요: 대략 **1~2개월**

[참고 근거]
- 교재 제8-2강 「강제집행」, 인도명령 진행절차 표

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-15 05:27:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q052')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q053', '점유자가 문을 안 열어주거나 집이 비어 있으면?', '집행일에 점유자가 문을 잠그고 나오지 않습니다.

[분류] 명도
[난이도] 중급
[검색어] 문 안 열어줌, 집행불능, 빈집, 강제개문, 유체동산 보관, 창고비

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q053', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q053',
  'auction', 0, 0, '2026-06-16 02:44:00', '2026-06-16 02:44:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q053', 'auction-qna-q053', u.id, '법률지원팀', '- **문을 안 열어줄 때**: 집행이 2회 이상 불능되면 **입회자의 입회 하에 집행관이 강제로 문을 열고** 점유자 소유 물건을 반출할 수 있습니다(최후 수단).
- **빈집일 때**: 이웃이나 관리실에 확인해 빈집임이 확인되면, 이웃·관리인 **입회 하에 강제 개문** 후 집행합니다.
반출한 물건이 적으면 건물 한쪽에 보관하고, 양이 많으면 **낙찰자 비용으로 유료창고에 통상 3개월 보관**한 뒤 소유자에게 창고비를 청구합니다. 받지 못하면 채무명의를 얻어 **유체동산 경매**로 집행비용을 회수해야 합니다.
- **집행 후 재침입**: 민사적으로는 다시 채무명의를 얻어 재집행해야 하지만, **무단침입죄가 성립**하므로 형사고소가 더 효과적일 수 있습니다.

[핵심 체크]
- 창고보관비·처리비는 대부분 낙찰자가 선지출 → 이사비 협상이 오히려 저렴한 경우가 많음
- 명도 완료 후 **열쇠 교체** 권장

[참고 근거]
- 교재 제8-2강 「인도명령 대상자가 부재중일 때의 집행」, 「건물이 비어 있을 때의 집행」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-16 05:44:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q053')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q054', '체납관리비는 낙찰자가 다 내야 하나요?', '관리사무소에서 밀린 관리비 500만원을 내라고 합니다.

[분류] 명도
[난이도] 중급
[검색어] 체납관리비, 관리비, 공용부분, 전유부분, 승계, 아파트 관리사무소

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q054', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q054',
  'auction', 0, 0, '2026-06-17 02:01:00', '2026-06-17 02:01:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q054', 'auction-qna-q054', u.id, '법률지원팀', '판례상 낙찰자가 승계하는 것은 **공용부분 관리비**입니다. 전유부분(세대 내 전기·수도 등)은 승계 대상이 아닙니다. 공용부분은 전체 공유자의 이익에 관한 것이어서 특별승계인에게 승계의사와 관계없이 청구할 수 있도록 특별규정을 두고 있기 때문입니다.
다만 **실무에서는** 금액이 과다하지 않다면 낙찰자가 체납 관리비 전액을 납부하는 경우가 많습니다. 단, 이는 **관리비 금액이 이사비 지급액 이내**이고, 점유자와 협의해 **이사비에서 관리비·공과금을 선공제**한 뒤 나머지를 지급하는 경우에 한합니다.

[핵심 체크]
- 임장 때 관리사무소에서 **체납 기간·금액(공용/전유 구분), 월평균 관리비**를 반드시 확인
- 수도 지역번호+121 / 전기 지역번호+123 / 도시가스 해당지역 114 문의

[참고 근거]
- 교재 제8-2강 「체납관리비 및 공과금 정산」, 제7강 「주거용 집합건물 확인사항」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-17 05:01:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q054')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q055', '이사비는 꼭 줘야 하나요? 얼마가 적당한가요?', '점유자가 이사비 500만원을 요구합니다.

[분류] 명도
[난이도] 중급
[검색어] 이사비, 이주비, 명도비, 협상, 강제집행 비용, 얼마

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q055', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q055',
  'auction', 0, 0, '2026-06-18 02:18:00', '2026-06-18 02:18:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q055', 'auction-qna-q055', u.id, '법률지원팀', '**법적 의무는 없습니다.** 다만 명도의 원활한 진행과 배려 차원에서 일정액을 지급하는 것이 통상적인 관례입니다. 기준선은 하나입니다. **강제집행을 할 경우의 비용보다 적게.** 강제집행은 비용도 들지만 시간이 오래 걸려 대출이자·기회비용이 함께 발생하므로, 그 금액 이내에서 협의된다면 협의가 낫습니다.
지급 방식도 중요합니다. **체납 관리비·공과금을 먼저 정산하고 그 잔액을 이사비로** 지급하도록 협의하세요. 둘 다 낙찰자가 부담하면 부담이 급증합니다.

[핵심 체크]
- 이사비는 **집을 완전히 비우고 열쇠를 받은 뒤** 지급
- 지급 시 **이사비 영수증 + 유체동산 포기각서**에 자필 서명 받기

[참고 근거]
- 교재 제8-2강 「이사비 지급」, 「명도협상에서의 주의사항」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-18 05:18:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q055')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q056', '명도 협상에서 지켜야 할 원칙이 있나요?', '점유자를 처음 만나러 갑니다.

[분류] 명도
[난이도] 중급
[검색어] 명도협상, 협상 기술, 조급함, 점유자 심리, 명도확인서, 흥분 금지

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q056', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q056',
  'auction', 0, 0, '2026-06-19 02:35:00', '2026-06-19 02:35:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q056', 'auction-qna-q056', u.id, '법률지원팀', '교재의 11가지 원칙을 요약하면 이렇습니다.
① 가능한 빨리 대면하라 — 만나서 대화하면 해결책이 보입니다.
② 조급함을 버려라 — 낙찰자가 급해 보이면 점유자가 역이용합니다. **시간을 가진 자가 유리합니다.**
③ 이사비 없는 명도를 꿈꾸지 마라 — 너무 적게 책정하면 역효과입니다.
④ 절대 흥분하지 마라 — 차분하고 냉정한 대응이 가장 효과적입니다.
⑤ 점유자를 믿지 마라 — 합의했어도 **인도명령 등 법적 절차는 원칙대로 병행**하세요.
⑥ 상대의 약점을 파악하라 — **배당받는 임차인에게는 ''명도확인서''가 최대 지렛대**입니다(명도확인서 없으면 배당일에 배당을 못 받습니다).
⑦ 이사 날짜와 이사비는 **낙찰자가 먼저 제시**하라 — 날짜를 못 맞추면 이사비를 다 줄 수 없음을 확인시키세요.
⑧ 너무 자극하지 마라 — 코너로 몰면 쥐도 고양이를 뭅니다.
⑨ 이사비는 집을 다 비우고 열쇠를 받은 후 지급하라.
⑩ 관리비·공과금 정산 후 영수증·유체동산 포기각서를 받아라.
⑪ 즐거운 마음으로 임하라 — 서로 상생 관계로 보는 것이 가장 빠릅니다.

[핵심 체크]
- 임차인은 **명도확인서 + 낙찰자 인감증명서**가 있어야 배당금을 수령
- 법적 절차(인도명령)와 협상은 **투트랙**으로 동시에

[참고 근거]
- 교재 제8-2강 「명도협상에서의 주의사항」, 제4강 「배당의 요건」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-19 05:35:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q056')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q057', '감정평가액을 믿고 입찰해도 되나요?', '감정가가 시세보다 높은 것 같습니다.

[분류] 경매절차
[난이도] 중급
[검색어] 감정평가서, 감정가, 기준시점, 거래사례비교법, 시세 차이, 재감정

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q057', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q057',
  'auction', 0, 0, '2026-06-20 02:52:00', '2026-06-20 02:52:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q057', 'auction-qna-q057', u.id, '법률지원팀', '감정평가액은 **현재 시세가 아니라 과거의 가격정보**입니다. 감정은 매각 훨씬 전에 이루어지므로 매각기일 시점의 시세와 차이가 납니다. 상승장이면 감정가보다 높게 써야 낙찰되고, 하락장이면 감정가보다 낮게 써야 손해를 면합니다.
또 아파트처럼 거래가 잦은 물건은 **거래사례비교법**이 잘 맞지만, **상가·수익형 부동산은 소득접근법**이 필요해 감정가만 믿으면 위험합니다. 감정평가서에서 확인할 것은 ①비교사례 선정이 적정한가 ②제시외 물건이 평가에 포함됐는가 ③기준시점이 언제인가입니다.

[핵심 체크]
- 감정 시점이 오래됐다는 사실·감정액이 낮다는 사실만으로는 **재평가 사유가 되지 않음**
- 다만 장기 정지 후 속행되며 경제사정이 급변했다면 법원이 재평가를 명할 수 있음

[참고 근거]
- 교재 제2강 「감정평가서」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-20 05:52:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q057')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q058', '매각물건명세서에서 꼭 봐야 할 항목은?', '서류가 여러 개인데 뭘 먼저 봐야 할지 모르겠습니다.

[분류] 경매절차
[난이도] 중급
[검색어] 매각물건명세서, 최선순위 저당권설정일자, 비고란, 특별매각조건, 인수

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q058', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q058',
  'auction', 0, 0, '2026-06-21 02:09:00', '2026-06-21 02:09:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q058', 'auction-qna-q058', u.id, '법률지원팀', '매각물건명세서는 **법원이 공식적으로 인수 여부를 알려주는 문서**입니다. 필수 확인 항목은 다음과 같습니다.
1) **부동산의 표시** — 제시외 건물 포함 여부, 일괄매각 여부
2) **점유관계와 관계인 진술** — 점유자·점유권원·보증금·차임·전입일자·사업자등록신청일자·확정일자·배당요구 여부. "조사된 임차내역 없음"이면 채무자가 전부 점유 중이라는 뜻.
3) **최선순위 저당권설정일자 등** — 임차인의 대항력 판단 기준. **건물과 토지 일자가 다르면 모두 기재**됩니다.
4) **비고란 / 특별매각조건** — 인수되는 권리(가등기·가처분·지상권·토지별도등기 등)와 매수보증금 특례가 여기에 적힙니다. **여기가 진짜 핵심입니다.**
매각기일 **1주일 전까지** 법원에 비치되며, 현황조사보고서·감정평가서 사본도 함께 비치됩니다. 열람은 무료지만 **복사는 안 됩니다.**

[핵심 체크]
- 3~4회 매각기일을 일괄 지정한 경우에도 **각 매각기일 1주일 전까지** 작성·비치
- 매각물건명세서의 중대한 하자는 매각불허가·변경 사유가 됨

[참고 근거]
- 교재 제2강 「매각물건명세서」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-21 05:09:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q058')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q059', '현황조사보고서에는 어떤 내용이 담기나요?', '현황조사보고서를 어떻게 읽어야 하나요?

[분류] 경매절차
[난이도] 입문
[검색어] 현황조사보고서, 집행관, 점유관계, 전입세대, 임대차관계, 2주

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q059', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q059',
  'auction', 0, 0, '2026-06-22 02:26:00', '2026-06-22 02:26:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q059', 'auction-qna-q059', u.id, '법률지원팀', '집행관이 부동산의 **현상, 점유관계, 차임 또는 임대차보증금의 액수, 기타 현황**을 조사해 정해진 날짜(2주)까지 법원에 제출하는 문서입니다. 실무상 ①부동산의 현상 및 점유관계 ②임대차관계 ③기타 현황 ④야간·휴일 조사 사유로 구성되고, 점유자와 점유권원, 임차인, 보증금·차임·임대차기간, **주민등록 전입 여부와 확정일자 여부**를 조사합니다.
주택이면 전입신고된 **세대주 전원의 주민등록등본·초본**을 발급받고 가능한 한 임대차계약서 사본도 붙입니다. 건물이 멸실되고 신축된 경우, 고가 정원석·제시외 건물·건축 중 건물 등 감정평가에 영향을 주는 물건도 기재됩니다.

[핵심 체크]
- 현황조사보고서와 다른 내용의 권리신고·배당요구가 있으면 **매각물건명세서에는 신고내용대로** 기재됨 → 두 서류를 대조할 것
- 지목이 전·답·과수원이면 현황 지목과 농지 해당 여부가 기재됨(농지취득자격증명 이슈)

[참고 근거]
- 교재 제2강 「현황조사 보고서」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-22 05:26:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q059')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q060', '농지(전·답·과수원)를 낙찰받으려면 뭐가 필요한가요?', '지목이 ''전''인 토지에 입찰하려고 합니다.

[분류] 입찰낙찰
[난이도] 중급
[검색어] 농지취득자격증명, 농취증, 전 답 과수원, 매각결정기일까지, 농지법

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q060', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q060',
  'auction', 0, 0, '2026-06-23 02:43:00', '2026-06-23 02:43:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q060', 'auction-qna-q060', u.id, '법률지원팀', '농지를 취득하려면 **농지취득자격증명(농취증)** 이 필요합니다. 다만 **입찰 시에 첨부할 필요는 없고, 매각결정기일까지 보완하면 됩니다.** 반대로 말하면 **매각결정기일까지 농취증을 내지 못하면 매각불허가가 되고, 보증금을 몰취당할 수 있습니다.**
현황이 농지가 아니거나(불법 형질변경 등) 발급 요건을 못 갖추면 발급이 거부될 수 있으므로, **입찰 전에 관할 관청에 발급 가능 여부를 문의**하는 것이 안전합니다.

[핵심 체크]
- 입찰 자격: 권리능력·행위능력 필요. 미성년자는 법정대리인을 통해서만 참가 가능
- 현황조사보고서에 현황 지목과 농지 해당 여부에 대한 집행관 의견이 기재될 수 있음

[참고 근거]
- 교재 제1강 「매각의 실시 – 주의사항」, 제2강 「현황조사 보고서」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-23 05:43:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q060')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q061', '임장(현장조사)에서 꼭 확인할 것은?', '현장에 가서 뭘 봐야 할지 모르겠습니다.

[분류] 경매절차
[난이도] 입문
[검색어] 임장, 현장조사, 체크리스트, 관리비, 우편함, 공실, 시세 확인

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q061', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q061',
  'auction', 0, 0, '2026-06-24 02:00:00', '2026-06-24 02:00:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q061', 'auction-qna-q061', u.id, '법률지원팀', '**1) 주거용 집합건물(아파트·빌라·다세대·오피스텔)**
- 관리비 체납 기간·금액(공용/전유 구분), 월평균 관리비
- 해당 호수의 **우편함**(우편물 = 실제 거주 단서), 현관문 상태, 점유자 현황
- 수도(지역번호+121), 전기(지역번호+123), 도시가스(해당지역 114)
- 대법원 정보·경매정보지와 다른 점 체크

[핵심 체크]
- 서류(공부)와 현장이 다른 경우가 실제로 존재 → 대조 확인이 임장의 목적
- **감정평가액과 현재 시세의 차이**를 반드시 확인

[참고 근거]
- 교재 제7강 「임장」, 「그 외 임장에서 필요한 확인사항들」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-24 05:00:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q061')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q062', '전입세대열람은 누가, 어디서 할 수 있나요?', '등기부에 없는 임차인을 확인하고 싶습니다.

[분류] 경매절차
[난이도] 입문
[검색어] 전입세대열람, 동사무소, 경매참가자, 세대주, 세대원, 전입일자

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q062', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q062',
  'auction', 0, 0, '2026-06-25 02:17:00', '2026-06-25 02:17:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q062', 'auction-qna-q062', u.id, '법률지원팀', '전입세대열람은 해당 물건에 어떤 세대가 전입해 있는지 확인하는 절차입니다. 소유자·세입자 외에 **경매참가자, 신용정보업자, 감정평가업자, 금융기관** 등도 열람할 수 있습니다. 열람하면 **세대주 성명과 전입일자, 동거인 성명·전입일자, 그리고 세대주보다 전입일자가 빠른 세대원이 있으면 그 세대원의 성명·전입일자**를 확인할 수 있습니다. 신청은 **물건 소재지 동사무소**에서 합니다.
이것이 중요한 이유는 Q008(세대합가) 때문입니다. 임차인 본인의 전입일만 보고 후순위라고 판단했다가, 가족의 빠른 전입일 때문에 선순위가 되는 사고를 막아줍니다.

[핵심 체크]
- 상가 임차인의 **사업자등록일자는 세무서에서 확인할 수 없습니다**(입찰 전 확인 불가한 정보 — 상가 경매의 구조적 리스크)
- 팁: 몇 명이나 전입세대열람을 해갔는지 확인하면 경쟁 강도를 가늠할 수 있음

[참고 근거]
- 교재 제7강 「전입세대열람」, 「상가임차인의 사업자등록 확인」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-25 05:17:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q062')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q063', '중복경매(이중경매)가 걸린 물건은 어떤 의미인가요?', '사건번호가 두 개 붙어 있습니다.

[분류] 경매절차
[난이도] 중급
[검색어] 중복경매, 이중경매, 공동경매, 취하 방지, 선순위 채권자

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q063', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q063',
  'auction', 0, 0, '2026-06-26 02:34:00', '2026-06-26 02:34:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q063', 'auction-qna-q063', u.id, '법률지원팀', '수인의 채권자가 동시에, 또는 개시결정 전에 다른 채권자가 같은 부동산에 경매를 신청하면 병합해 하나의 개시결정을 합니다. 중복경매가 발생하는 이유는 두 가지입니다.
① **취하 방지**: 신청채권자의 채권액이 소액이라 채무자가 변제하고 취하할 가능성이 있을 때, 다른 채권자들이 취하를 막기 위해 중복 신청
② **무잉여 취소 방지**: 후순위 채권자가 신청해 유찰이 반복되면 무잉여로 취소되는데, **선순위 채권자가 중복경매를 신청하면 이를 방지**할 수 있음
입찰자 입장에서는 **중복사건이 오히려 취하·취소 위험이 낮다**는 신호입니다.

[핵심 체크]
- 선행사건이 취하돼도 후행사건이 진행됨
- 배당요구 종기까지 신청한 이중경매신청인은 배당요구 없이도 배당 가능

[참고 근거]
- 교재 제1강 「중복경매」, 제8강 「경매 취하 가능성 판단」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-26 05:34:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q063')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q064', '매각허가결정에 불복하려면 어떻게 하나요?', '이해관계인이 항고를 했다고 합니다.

[분류] 경매절차
[난이도] 심화
[검색어] 즉시항고, 매각허가결정, 매각불허가, 항고보증금, 10분의 1, 1주일

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q064', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q064',
  'auction', 0, 0, '2026-06-27 02:51:00', '2026-06-27 02:51:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q064', 'auction-qna-q064', u.id, '법률지원팀', '이해관계인은 매각허가·불허가 결정으로 손해를 볼 경우 **즉시항고**를 할 수 있습니다. 항고장은 **결정 선고일부터 1주일 내**에 원심법원에 제출하고, 항고이유를 적지 않았으면 제출일부터 **10일 내**에 항고이유서를 내야 합니다.
매각허가결정에 항고하려면 **매각대금의 10분의 1에 해당하는 금전 또는 유가증권을 보증으로 공탁**해야 합니다. 보증이 없으면 원심법원이 7일 내에 각하하고 절차를 계속 진행합니다.
- **채무자·소유자**의 항고가 기각되면 → 보증금 **전액을 반환받지 못하고** 배당재단에 편입
- **그 외 사람**의 항고가 기각되면 → 항고일부터 기각확정일까지의 **연 20% 지연손해금**만 배당에 포함되고 나머지는 반환

[핵심 체크]
- 항고는 명백한 **시간 지연 전략**으로 쓰이기도 함 → 대출·잔금 일정에 여유를
- 매각결정기일은 통상 매각기일 **7일 뒤**

[참고 근거]
- 교재 제1강 「매각허부에 대한 즉시항고」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-27 05:51:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q064')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q065', '배당표에 이의가 있으면 어떻게 하나요?', '가장임차인이 배당을 받아가려 합니다.

[분류] 배당
[난이도] 심화
[검색어] 배당이의, 배당이의의 소, 7일, 소제기증명원, 공탁, 배당기일

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q065', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q065',
  'auction', 0, 0, '2026-06-28 02:08:00', '2026-06-28 02:08:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q065', 'auction-qna-q065', u.id, '법률지원팀', '낙찰자가 대금을 완납하면 법원은 **완납일부터 2주 이내로 배당기일**을 지정하고 채권자들에게 통지합니다. 배당기일에 이의를 제기하면 **이의 부분에 한해 배당이 유보**됩니다.
그 다음이 중요합니다. 이의를 제기한 자는 **배당기일부터 7일 이내에 배당이의의 소를 제기하고, 소제기증명원을 경매계에 제출**해야 합니다. 이 절차를 밟지 않으면 **이의의 효력이 상실되고 원래 배당표대로 배당**됩니다.

[핵심 체크]
- 낙찰자도 인수 부담이 걸린 경우 이해관계인으로서 대응 필요
- 채권자는 배당요구 종기까지 채권계산서를 내야 하며, 종기 후에는 채권액 보충 불가

[참고 근거]
- 교재 제4강 「배당의 정의」, 제1강 「채권계산서의 제출」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-28 05:08:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q065')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q066', '낙찰가 8,000만원에 근저당 A(5,000만원)·B(6,000만원), 후순위 임차인 C(보증금 4,000만원)면 배당은?', '2008년 8월 근저당 A 5,000만원, 2008년 9월 근저당 B 6,000만원, 2008년 12월 전입한 임차인 C 보증금 4,000만원, 낙찰가 8,000만원.

[분류] 배당
[난이도] 심화
[검색어] 배당 계산 연습, 순위배당, 후순위 임차인, 근저당 우선, 사례

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q066', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q066',
  'auction', 0, 0, '2026-06-29 02:25:00', '2026-06-29 02:25:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q066', 'auction-qna-q066', u.id, '법률지원팀', '① **최우선변제** 여부를 먼저 봅니다. C가 소액임차인 요건(최초 담보물권 설정일 = 2008년 8월 기준)에 해당하고 배당요구를 했다면, 낙찰가의 1/2인 4,000만원 한도 내에서 일정액을 **A·B보다 먼저** 받습니다.
② 남은 금액을 **순위대로** 배당합니다. 근저당 A(선순위) → 근저당 B → 확정일자 있는 C 순.
③ 낙찰가 8,000만원은 A+B(1억 1,000만원)에도 못 미치므로, **C는 최우선변제금 외에는 사실상 배당이 없습니다.**
④ 다만 C는 **후순위 대항력**이므로 **낙찰자 인수 금액은 0원**입니다. 못 받은 보증금은 채무자에게 청구할 문제입니다.

[핵심 체크]
- 순서: 집행비용 → 최우선변제 → 당해세 → 순위배당
- 후순위 임차인은 낙찰자와 무관 — 감정적으로 흔들리지 말 것

[참고 근거]
- 교재 제3강 「소액임차인 배당연습」, 제4강 「배당순위」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-29 05:25:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q066')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q067', '선순위 임차인이 배당요구를 했는데 다 못 받으면 차액은 누가 부담하나요?', '선순위 임차인이 배당요구를 했으니 안심해도 될까요?

[분류] 임차인
[난이도] 중급
[검색어] 선순위 임차인 차액 인수, 미배당금, 낙찰자 부담, 겸유, 대항력 우선변제

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q067', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q067',
  'auction', 0, 0, '2026-06-30 02:42:00', '2026-06-30 02:42:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q067', 'auction-qna-q067', u.id, '법률지원팀', '아닙니다. **대항력과 우선변제권을 모두 가진 선순위 임차인**이 배당요구를 한 경우, 배당으로 **받지 못한 차액은 낙찰자가 인수**합니다. 최우선변제 + 확정일자에 의한 우선변제로 받고 남은 금액이 낙찰자 부담이 됩니다.
그리고 더 나쁜 경우가 **배당요구를 아예 하지 않은 경우**로, 이때는 **보증금 전액을 인수**합니다.
따라서 선순위 임차인이 있는 물건은 **예상배당표를 반드시 그려서** "낙찰가 얼마일 때 임차인이 얼마 받고, 내가 얼마를 물어주는지"를 계산한 뒤 입찰가를 정해야 합니다.

[핵심 체크]
- 실질 취득원가 = 낙찰가 + 인수 보증금 + 명도비 + 취득세 등
- 낙찰가를 낮게 쓸수록 임차인 배당이 줄고 → 내 인수액이 늘어남(총액은 크게 안 줄어듦)

[참고 근거]
- 교재 제4강 「대항력과 우선변제권을 겸유한 경우」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-06-30 05:42:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q067')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q068', '임차인이 보증금을 증액했는데 계약서를 새로 써도 되나요?', '1억에 살던 집을 1억 3천으로 올리면서 계약서를 새로 쓰려고 합니다.

[분류] 임차인
[난이도] 중급
[검색어] 보증금 증액, 재계약, 확정일자 다시, 우선순위 밀림, 증액분 별도 계약서

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q068', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q068',
  'auction', 0, 0, '2026-07-01 02:59:00', '2026-07-01 02:59:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q068', 'auction-qna-q068', u.id, '법률지원팀', '**기존 1억 계약서 원본은 그대로 두고, 증액된 3,000만원에 대해서만 새 계약서를 작성해 확정일자를 받으세요.** 전체 금액으로 새 계약서를 쓰면, 그 사이에 새로 설정된 담보물권이 있을 경우 **전체 보증금의 순위가 새 담보물권보다 밀립니다.**
또한 증액분은 **기존 근저당권자보다 우선해 배당받을 수 없고**, 재계약서 없이 임대인이 써준 **영수증에 확정일자만 받은 경우에는 효력이 인정되지 않아** 우선변제를 받지 못합니다. 반드시 임대차관계를 확인할 수 있는 형태의 **계약서**를 작성하고 확정일자를 받아야 합니다.

[핵심 체크]
- 집주인이 바뀌거나 기간 만료 시에도 **새로 설정된 물권이 없는지 확인 후** 계약서 작성
- 안전 기준(교재): 선순위근저당 + 선순위보증금 + 내 보증금 합계가 아파트 시세의 80%, 다세대 70%, 단독 60% 이내

[참고 근거]
- 교재 제3강 「(참고자료) 임차인이 임대차계약시 주의할 점」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-01 05:59:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q068')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q069', '경매 취소·취하·변경(연기)은 어떻게 다른가요?', '사건 상태가 자꾸 바뀝니다.

[분류] 경매절차
[난이도] 중급
[검색어] 취소 취하 변경, 연기, 차이, 직권 취소, 2회 연기, 2개월

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q069', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q069',
  'auction', 0, 0, '2026-07-02 02:16:00', '2026-07-02 02:16:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q069', 'auction-qna-q069', u.id, '법률지원팀', '- **취소**: 법원이 **직권**으로 하는 것(무잉여 등). 채무자가 채무를 청산하고 판결을 받아 취소할 수도 있고, 부동산 멸실·담보권 소멸·원인무효 등의 사유로도 가능합니다. **낙찰자 동의 불필요.**
- **취하**: 경매를 신청한 **채권자**가 신청을 철회하는 것. **매각대금 납부 전까지** 가능하되, **낙찰 후에는 최고가매수신고인·차순위매수신고인의 동의 필요.**
- **변경(연기)**: 신청채권자의 매각기일 연기신청은 원칙적으로 **2회까지**, 1회 연기기간은 **2개월**. **채무자·소유자는 채권자 동의 없이 연기 불가.** 법원 직권 연기도 가능합니다(개시결정 이의, 송달 부적법, 매각물건명세서의 중대한 하자, 감정가 결정의 하자, 공고상 중대한 오류, 집행정지 서류 제출 등).

[핵심 체크]
- 입찰 당일에 취하·연기가 접수되기도 하므로 아침에 경매계 전화 확인
- 반복 연기되는 사건은 채무자가 시간을 벌고 있다는 신호

[참고 근거]
- 교재 제1강 「경매의 취소 / 취하 / 변경(연기)」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-02 05:16:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q069')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q070', '매수보증금이 10%가 아니라 20~30%인 물건이 있던데요?', '보증금이 최저가의 20%라고 적혀 있습니다.

[분류] 입찰낙찰
[난이도] 입문
[검색어] 매수보증금, 20% 30%, 특별매각조건, 재매각, 미납, 불허가

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q070', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q070',
  'auction', 0, 0, '2026-07-03 02:33:00', '2026-07-03 02:33:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q070', 'auction-qna-q070', u.id, '법률지원팀', '원칙은 **최저매각가격의 10분의 1(10%)** 입니다. 그러나 **불허가결정이 있었거나, 미납으로 재매각이 진행되는 등 특별한 사유**가 있으면, 법원은 신중한 입찰 참여를 요구하기 위해 **특별매각조건으로 보증금을 20~30%로 정할 수 있습니다.**
보증금이 상향된 물건은 곧 **"이 물건은 앞선 낙찰자가 잔금을 못 냈다"** 는 신호이기도 합니다. 왜 미납했는지(권리분석 실패? 대출 불가? 인수 보증금 발견?)를 반드시 역추적하세요.

[핵심 체크]
- 보증금이 부족하면 **무효** — 금액을 꼭 다시 확인
- 재매각 사건에서 **전 낙찰자는 응찰 불가**

[참고 근거]
- 교재 제1강 「매수보증금」, 제8강 「입찰 무효처리 기준」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-03 05:33:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q070')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q071', '공동입찰(가족·동업자와 함께)은 어떻게 하나요?', '부부 공동명의로 낙찰받고 싶습니다.

[분류] 입찰낙찰
[난이도] 중급
[검색어] 공동입찰, 공동입찰신고서, 공동입찰자목록, 간인, 지분, 부부 공동

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q071', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q071',
  'auction', 0, 0, '2026-07-04 02:50:00', '2026-07-04 02:50:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q071', 'auction-qna-q071', u.id, '법률지원팀', '2인 이상이 공동소유 목적으로 응찰하려면 **공동입찰신고서**와 **공동입찰자목록**을 작성해 입찰표, 각자의 인감증명서와 함께 제출합니다. **공동입찰 서류는 반드시 간인**해야 합니다.
전원 참석이 원칙이며, 일부 또는 전원이 불참하고 대리인이 입찰하는 경우에는 불참자에 대해 대리인 입찰과 동일한 서류(**인감증명서, 인감도장 날인된 위임장**)를 제출해야 합니다.
지분 비율은 공동입찰자목록에 기재한 대로 등기됩니다.

[핵심 체크]
- 지분 비율을 미리 정해서 목록에 정확히 기재
- 낙찰 후 지분 변경은 어려우므로 대출·세금까지 고려해 결정

[참고 근거]
- 교재 제1강 「공동입찰」, 제8강 「경매 입찰시 준비서류」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-04 05:50:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q071')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q072', '기일입찰과 기간입찰의 차이는?', '입찰 방식이 여러 개라고 들었습니다.

[분류] 경매절차
[난이도] 입문
[검색어] 기일입찰, 기간입찰, 호가경매, 우편 입찰, 매각방법

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q072', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q072',
  'auction', 0, 0, '2026-07-05 02:07:00', '2026-07-05 02:07:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q072', 'auction-qna-q072', u.id, '법률지원팀', '- **기일입찰**: 매각기일에 매각장소에서 입찰표를 제출하는 방식. **가장 일반적입니다.** 집행관이 당일 개찰해 최고가매수신고인과 차순위매수신고인을 정합니다.
- **기간입찰**: 지정된 입찰기간 안에 직접 또는 **우편**으로 입찰표를 제출하는 방식. 집행관이 기간 중 입찰봉투를 접수·보관하다가 매각기일에 개봉합니다. 매각기일에는 입찰을 실시하지 않습니다.
- **호가경매**: 과거에 시행했으나 현재는 하지 않습니다.
하나의 매각기일에 2건 이상이 있으면 **동시매각이 원칙**입니다(담합 방지, 자유로운 응찰 보장).

[핵심 체크]
- 매수신청에는 권리능력·행위능력이 필요 — 미성년자는 법정대리인을 통해서만 가능
- 매각방법은 법원이 지정해 공고

[참고 근거]
- 교재 제1강 「매각의 실시」, 「기일입찰 & 기간입찰 & 호가경매」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-05 05:07:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q072')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q073', '경매 물건은 어디서 검색하나요?', '어디서 물건을 찾아야 하나요?

[분류] 경매절차
[난이도] 입문
[검색어] 경매 사이트, 대법원 법원경매정보, courtauction, 마이옥션, 인터넷등기소

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q073', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q073',
  'auction', 0, 0, '2026-07-06 02:24:00', '2026-07-06 02:24:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q073', 'auction-qna-q073', u.id, '법률지원팀', '- **대법원 법원경매정보** www.courtauction.go.kr — 공식 정보(매각물건명세서·현황조사보고서·감정평가서 열람). 공고 요지도 여기서 확인합니다.
- **마이옥션** www.my-auction.co.kr — 무료 경매정보 사이트
- **인터넷등기소** www.iros.go.kr — 등기부등본 열람·발급
- 그 외: 토지이용계획(토지이음), 온나라 부동산포털, **국토교통부 실거래가**
공부서류 확인은 **등기부등본 / 건축물대장 / 토지이용계획확인서 / 지적도 / 토지대장** 5종 세트가 기본입니다.

[핵심 체크]
- 사설 경매정보지의 요약은 참고용 — **최종 판단은 반드시 대법원 원본 서류**로
- 매각기일 공고는 법원 게시판 게시가 원칙, 요지는 인터넷·일간신문에 게재

[참고 근거]
- 교재 제1강 「부동산경매 검색하는 방법」, 제6강 「부동산경매 관련 사이트」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-06 05:24:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q073')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q074', '아파트 전용면적·공급면적·계약면적은 어떻게 다른가요?', '평과 평형이 다르다고 합니다.

[분류] 경매절차
[난이도] 입문
[검색어] 전용면적, 공용면적, 분양면적, 공급면적, 계약면적, 평 평형, 시세 계산

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q074', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q074',
  'auction', 0, 0, '2026-07-07 02:41:00', '2026-07-07 02:41:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q074', 'auction-qna-q074', u.id, '법률지원팀', '- **전용면적**: 현관·방·거실·주방 등 **나만 쓰는 공간** → "평"으로 표시
- **공용면적**: 계단·복도·각 동 현관 등 반드시 거쳐 가는 공간
- **분양면적(공급면적)**: 전용 + 공용 → "평형"으로 표시
- **계약면적**: 분양면적 + 주차장면적
시세 계산 방식이 물건 종류마다 다릅니다.
- **아파트**: 분양면적 × 평당분양가
- **빌라·오피스텔·상업용·업무용**: 계약면적 × 평당분양가

[핵심 체크]
- 감정평가서의 면적 기준과 시세 비교 대상의 면적 기준을 일치시켜야 함
- 같은 "32평"이라도 전용/공급 기준에 따라 실제 크기가 다름

[참고 근거]
- 교재 제7강 「(참고) 아파트 면적의 이해」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-07 05:41:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q074')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q075', '아파트를 고를 때 어떤 조건을 봐야 하나요?', '경매로 아파트를 사려는데 어떤 단지가 좋은 단지인가요?

[분류] 경매절차
[난이도] 입문
[검색어] 아파트 점검사항, 단지규모, 용적률, 주차, 학군, 환금성, 체크리스트

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q075', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q075',
  'auction', 0, 0, '2026-07-08 02:58:00', '2026-07-08 02:58:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q075', 'auction-qna-q075', u.id, '법률지원팀', '**단지 여건**: 300가구 이상(밀집지역이면 300가구도 무난), 단지 내 편의시설, 평형 배치가 지역 소득과 조화를 이루는가, 남향·일조량, 가구당 주차대수(2·3중 주차가 보이면 가격 상승 어려움), 난방방식, **용적률 200% 이하**(쾌적), 단지 경사도, 조망·녹지, 인근 시세 대비 분양가, 전세가율, **환금성(거래가 활발한가)**, 발전 가능성(신설 도로·지하철 계획)

[핵심 체크]
- **비선호시설**: 쓰레기매립장·소각장·분뇨처리장·화장장·공원묘지·하수종말처리장(혐오성), 원전·화력발전소·핵폐기물시설·교도소(위험성)
- 재개발·재건축 호재 지역이면 **대지지분**이 중요(보상가·추가부담금이 지분에 따라 달라짐)

[참고 근거]
- 교재 제7강 「(참고) 아파트 매입시 점검사항」, 「혐오시설, 선호시설」, 「재개발, 재건축」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-08 05:58:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q075')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q076', '권리분석은 외워야 하나요?', '배울 때는 알겠는데 조금만 바뀌면 헷갈립니다.

[분류] 권리분석
[난이도] 입문
[검색어] 권리분석 공부법, 외우지 마라, 이해, 초보자 어려움, 공부 방법

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q076', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q076',
  'auction', 0, 0, '2026-07-09 02:15:00', '2026-07-09 02:15:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q076', 'auction-qna-q076', u.id, '법률지원팀', '교재의 핵심 메시지는 명확합니다. **"경매의 법리를 절대 외우지 마라. 단, 반드시 이해해야 한다."**
초보자가 권리분석을 어려워하는 이유는 "1+1=2, 2+3=5"처럼 결과를 통째로 외우기 때문입니다. 그러면 "10+20"이 나오면 무너집니다. 원리를 이해하면 조합이 아무리 복잡해져도 풀립니다.
이해해야 할 원리는 딱 세 줄입니다.
1. **경매는 순위 싸움이다.** 하루라도 빨리 태어난 권리가 우선한다.
2. **말소기준권리 = 등기부상 돈이 목적인 권리 중 1번.**
3. **그보다 먼저 온 권리는 인수, 뒤에 온 권리는 말소.**
교재의 말대로, 어려운 것이 아니라 **상식을 자주 쓰지 않는 법률 언어로 표현해 놓은 것**뿐입니다.

[핵심 체크]
- 말소기준권리와 대항력만 제대로 판단하면 **주거용 부동산에서 경매 사고는 거의 발생하지 않음**
- 권리분석 = 중고차 살 때 외관·엔진·사고이력 보는 것과 같은 일

[참고 근거]
- 교재 제2강 「초보자들이 권리분석을 어려워하는 이유」, 「권리분석의 정의」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-09 05:15:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q076')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q077', '1980년대 임차인은 왜 대항력이 없나요? (법 시행일 정리)', '아주 오래된 임차인이 있는 물건을 봤습니다.

[분류] 임차인
[난이도] 중급
[검색어] 주택임대차보호법 시행일, 1981년 3월 5일, 1983년, 1989년, 1991년, 시행일 정리

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q077', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q077',
  'auction', 0, 0, '2026-07-10 02:32:00', '2026-07-10 02:32:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q077', 'auction-qna-q077', u.id, '법률지원팀', '법이 태어난 날 이전의 임차인은 그 법의 보호를 받지 못합니다. 반드시 외워둘 4개의 날짜입니다.

| 제도 | 시행일 |
|---|---|
| **대항력** (주택임대차보호법) | **1981. 03. 05.** |
| **소액임차인 최우선변제** | **1983. 12. 30.** |
| **확정일자 우선변제** | **1989. 12. 30.** |
| **임차권등기명령** | **1991.** |
| **상가건물임대차보호법** | **2002. 11. 01.** |

1980년 7월에 입주·전입한 임차인은 주택임대차보호법이 없던 시절이므로, **민법 제621조의 임대차등기(또는 전세권설정)를 하지 않았다면 대항력이 없습니다.** 반대로 1985년 임차인은 임대인 동의 없이 **이사 + 전입신고만으로** 다음 날 0시에 대항력을 얻습니다.

[핵심 체크]
- **모든 점유·전입 임차인에게는 대항력이 있습니다.** 다만 "기존 집주인에게만" 대항 가능한지, "누구에게나" 대항 가능한지가 다를 뿐입니다.
- 말소기준권리보다 빠르면 **선순위 대항력**, 늦으면 **후순위 대항력** — "대항력이 없다"는 표현은 엄밀히는 부정확합니다.

[참고 근거]
- 교재 제3강 「대항력의 법적 근거」, 「(참고자료) 주택임대차보호법의 입법배경」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-10 05:32:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q077')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q078', '미등기·무허가 건물에 사는 임차인도 보호받나요?', '무허가 건물에 전세로 살고 있습니다.

[분류] 임차인
[난이도] 중급
[검색어] 미등기 건물, 무허가, 주거용, 사용승인, 옥탑방, 보호 대상

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q078', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q078',
  'auction', 0, 0, '2026-07-11 02:49:00', '2026-07-11 02:49:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q078', 'auction-qna-q078', u.id, '법률지원팀', '주택임대차보호법의 ''주택'' 판단 기준은 **공부(서류)가 아니라 실제 사용 용도**입니다.
- **주거용 건물이면 보호 대상** — 공부상 주택이라도 실제 용도가 기준입니다.
- **미등기 건물, 사용승인을 못 받은 주택도 주거용으로 사용되면 보호 대상**입니다.
- 반대로 **비주거용 건물의 일부를 주거 목적으로 쓰는 경우(상가 안의 쪽방 등)는 보호 대상이 아닙니다.**
단, 미등기·무허가 건물은 **임차권등기명령을 신청할 수 없습니다**(등기 가능한 등기부등본이 있는 건물만 가능). 보호는 받지만 등기로 권리를 남길 수는 없다는 뜻입니다.

[핵심 체크]
- 경매 물건에 미등기 건물이 딸려 있으면 **제시외 건물** 여부와 감정평가 포함 여부를 확인
- 무허가건물 임차인의 배당 참여 여부는 매각물건명세서로 확인

[참고 근거]
- 교재 제3강 「주택임대차보호법의 보호대상의 ''주택''의 기준 정리」, 제4강 「임차권등기명령」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-11 05:49:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q078')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q079', '낙찰받으면 등기부의 권리가 전부 깨끗해지나요?', '경매는 원시취득이라 권리가 다 사라진다고 들었습니다.

[분류] 권리분석
[난이도] 중급
[검색어] 말소, 인수, 소멸, 원시취득, 깨끗한 등기, 안 지워지는 권리

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q079', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q079',
  'auction', 0, 0, '2026-07-12 02:06:00', '2026-07-12 02:06:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q079', 'auction-qna-q079', u.id, '법률지원팀', '대부분은 맞지만, **다 사라지지 않습니다.** 말소기준권리 이후의 권리는 소멸하지만, 다음은 **낙찰자가 인수**합니다.
- 선순위 임차인의 대항력(보증금)
- 선순위 가처분, 선순위 소유권이전청구권가등기, 선순위 지상권·전세권(배당요구 안 한 경우)
- **예고등기** (순위와 무관하게 말소되지 않음)
- **유치권** (등기와 무관하게 성립·인수)
- **법정지상권** (등기 없이 성립)
- 매각물건명세서에 **인수 조건으로 명시된 권리** (토지별도등기 등)
즉 **등기부에 안 보이는 권리(유치권·법정지상권·분묘기지권)가 진짜 위험**합니다. 그래서 임장이 필요합니다.

[핵심 체크]
- 인수 여부의 공식 근거 = **매각물건명세서 비고란**
- 등기소는 소유권이전등기 후 "인수되지 않는 권리"만 말소함

[참고 근거]
- 교재 제2강 「말소기준권리의 효력」, 제4강 「유치권·지상권」, 제8강 「소유권이전등기촉탁」

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-12 05:06:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q079')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  'auction-qna-q080', '초보자가 경매 사고를 피하려면 뭘 지켜야 하나요?', '첫 입찰을 앞두고 있습니다.

[분류] 권리분석
[난이도] 입문
[검색어] 초보자, 사고 예방, 체크리스트, 안전한 물건, 피해야 할 물건, 요약

관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.', u.id, '익명', 0,
  'auction_qna_md', 'Q080', 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', 'Q080',
  'auction', 0, 0, '2026-07-13 02:23:00', '2026-07-13 02:23:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  'auction-qna-answer-q080', 'auction-qna-q080', u.id, '법률지원팀', '**① 첫 물건은 단순하게 고르세요.**
- 등기부 맨 위가 근저당·가압류
- 예고등기·유치권 신고 없음
- 임차인이 없거나(채무자 점유), 임차인이 전부 후순위
- 대지권 정상, 토지별도등기 인수 조건 없음

[핵심 체크]
- 말소기준권리 + 대항력, 이 두 가지만 정확히 판단해도 주거용 경매 사고는 거의 없음
- 잔금 미납의 최대 원인은 대출 — 낙찰 전에 확인, 낙찰 후 재확인

[참고 근거]
- 교재 제2강, 제3강, 제7강, 제8강 종합

※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.', 0, '2026-07-13 05:23:00'
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = 'auction-qna-q080')
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;
-- generated cases: 80
