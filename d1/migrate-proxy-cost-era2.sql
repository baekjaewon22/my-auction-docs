-- Era 2 매수신청대리 레코드 보정
-- type_detail에 '수익' 문자열이 포함된 레코드를 Era 3 포맷(amount=gross, '급여반영')으로 변환
-- 각 레코드의 origin gross = parsed cost from type_detail + parsed profit from type_detail
-- 현재 proxy_cost는 그대로 두고 amount/type_detail만 보정 (PUT으로 편집된 cost 보존)

-- 1) 강행원: orig cost=0, profit=120,000 → gross=120,000, current cost=90,000
UPDATE sales_records
SET amount = 120000,
    type_detail = '대리비용 90,000원 / 급여반영 19,091원',
    updated_at = datetime('now', '+9 hours')
WHERE id = 'd01a1ccb-e53e-42b1-b92d-77b450d3d905';

-- 2) 성기방: orig cost=90,000, profit=30,000 → gross=120,000, current cost=90,000
UPDATE sales_records
SET amount = 120000,
    type_detail = '대리비용 90,000원 / 급여반영 19,091원',
    updated_at = datetime('now', '+9 hours')
WHERE id = '1c8996fc-c6de-4f43-b90f-e924edd75505';

-- 3) 김영규: orig cost=0, profit=120,000 → gross=120,000, current cost=0
UPDATE sales_records
SET amount = 120000,
    type_detail = '대리비용 0원 / 급여반영 109,091원',
    updated_at = datetime('now', '+9 hours')
WHERE id = 'ac8d29b9-e460-4837-a995-d13ad76c1ebd';

-- 4) 박비송 김종성: orig cost=0, profit=120,000 → gross=120,000, current cost=90,000
UPDATE sales_records
SET amount = 120000,
    type_detail = '대리비용 90,000원 / 급여반영 19,091원',
    updated_at = datetime('now', '+9 hours')
WHERE id = 'e70b5d60-9d67-44b3-8ece-a6f6a37b4015';

-- 5) 김효준: orig cost=0, profit=120,000 → gross=120,000, current cost=90,000
UPDATE sales_records
SET amount = 120000,
    type_detail = '대리비용 90,000원 / 급여반영 19,091원',
    updated_at = datetime('now', '+9 hours')
WHERE id = 'bf15fce0-3143-497d-93f1-2f770a5893db';

-- 6) 고영주(5/12): orig cost=90,000, profit=30,000 → gross=120,000, current cost=90,000
UPDATE sales_records
SET amount = 120000,
    type_detail = '대리비용 90,000원 / 급여반영 19,091원',
    updated_at = datetime('now', '+9 hours')
WHERE id = '601e2933-fe5c-4696-8f75-762bb186f153';

-- 7) 최다운: orig cost=0, profit=120,000 → gross=120,000, current cost=90,000
UPDATE sales_records
SET amount = 120000,
    type_detail = '대리비용 90,000원 / 급여반영 19,091원',
    updated_at = datetime('now', '+9 hours')
WHERE id = '14be958c-a83e-402e-839a-3dc94fbab399';

-- 8) 고영주(5/20): orig cost=90,000, profit=30,000 → gross=120,000, current cost=90,000
UPDATE sales_records
SET amount = 120000,
    type_detail = '대리비용 90,000원 / 급여반영 19,091원',
    updated_at = datetime('now', '+9 hours')
WHERE id = '7f160947-efe4-4365-a7dc-411b66e84236';
