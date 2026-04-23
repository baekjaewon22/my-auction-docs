-- 사업소득신고 추가 리스트 (풀) 테이블
CREATE TABLE IF NOT EXISTS business_income_pool (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ssn TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bi_pool_name ON business_income_pool(name);

-- ═══════════════════════════════════════════════════════════
-- [1] 비율제 정규 담당자 — user_accounting에 주민번호/주소 기입
-- (pay_type='commission' 강제 설정 + ssn/address 업서트)
-- ═══════════════════════════════════════════════════════════

-- 서정수
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '760503-1173511',
  '경기도 양주시 광적면 가래비11길 30, 108동 703호(성우헤스티아 아파트)'
FROM users u WHERE u.name = '서정수'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 진성헌
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '750115-1173513',
  '경기도 양주시 옥정서로1길 60, 옥정더퍼스트 아파트 1513동 1203호'
FROM users u WHERE u.name = '진성헌'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 임태율
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '820505-1553427',
  '서울특별시 양천구 남부순환로83길 18, 202동 1303호 (신월동, 목동센트럴아이파크위브 2단지)'
FROM users u WHERE u.name = '임태율'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 주효상
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '840123-1677317',
  '대구광역시 동구 동북로 340, 1008동 902호 (신암동, 동대구해모로스퀘어웨스트)'
FROM users u WHERE u.name = '주효상'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 진은경
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '780323-2094929',
  '부산광역시 남구 고동골로97번길 67, 702호 (문현동, 광원아파트)'
FROM users u WHERE u.name = '진은경'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 박비송
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '870528-2111117',
  '부산광역시 수영구 광안해변로 311, 909호(민락동, 서희스타힐스센텀프리모)'
FROM users u WHERE u.name = '박비송'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 이태욱
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '911111-1120616',
  '경상남도 양산시 물금읍 동중7길 21, A동 703호(삼위로얄아파트)'
FROM users u WHERE u.name = '이태욱'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 박선호
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '821230-1122327',
  '부산광역시 금정구 식물원로9번길 15, 101동 2605호 (장전삼정그린코아더베스트)'
FROM users u WHERE u.name = '박선호'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 박종연
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '840808-1559513',
  '경상남도 양산시 물금읍 백호로 156, 우성스마트시티뷰 101동 703호'
FROM users u WHERE u.name = '박종연'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 윤미진
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '810926-2094210',
  '부산광역시 동래구 금강로131번길 42, 201동 902호 (레미안포레스티지)'
FROM users u WHERE u.name = '윤미진'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 김일환
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '880215-1126712',
  '부산광역시 금정구 체육공원로 56, 502호(구서동, 태평아파트)'
FROM users u WHERE u.name = '김일환'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 이동휘
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '870424-1841912',
  '부산광역시 북구 상학로 35, 102동 1105호(만덕동, 더 래디언트 금정산)'
FROM users u WHERE u.name = '이동휘'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 조성재
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '930324-1094711',
  '부산광역시 부산진구 전포대로306번길 16, 1102호(전포동, 르씨엘파크)'
FROM users u WHERE u.name = '조성재'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 윤현석
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '841219-1063729',
  '대전광역시 중구 태평로 15, 122동 701호(태평동, 버드내마을아파트)'
FROM users u WHERE u.name = '윤현석'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 우진솔
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '941215-2078618',
  '대전광역시 서구 탄방로 50-21, 502호(탄방동, 드림빌라)'
FROM users u WHERE u.name = '우진솔'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 강민석
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '981208-1216119',
  '대전광역시 서구 괴정동 74-10, 304호'
FROM users u WHERE u.name = '강민석'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 도정운
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '910228-2735912',
  '대전광역시 중구 보문산로161번길 55, 101동 508호 (문화동, 주공아파트)'
FROM users u WHERE u.name = '도정운'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- 김성환
INSERT INTO user_accounting (id, user_id, pay_type, ssn, address)
SELECT lower(hex(randomblob(16))), u.id, 'commission', '970316-1852411',
  '울산광역시 북구 양정4길 15, 205동 801호 (양정동, 양정힐스테이트2차아파트)'
FROM users u WHERE u.name = '김성환'
ON CONFLICT(user_id) DO UPDATE SET
  pay_type = 'commission',
  ssn = excluded.ssn, address = excluded.address, updated_at = datetime('now');

-- ═══════════════════════════════════════════════════════════
-- [2] 추가 리스트 (풀) — business_income_pool
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO business_income_pool (id, name, ssn, address) VALUES
  (lower(hex(randomblob(16))), '문인환', '720929-1716518', '경상북도 김천시 혁신5로 11, 110동 502호'),
  (lower(hex(randomblob(16))), '배창수', '650721-1542610', '서울특별시 마포구 월드컵로31길 110-4, 2층 1호 (망원동)'),
  (lower(hex(randomblob(16))), '설길선', '780714-2666023', '서울특별시 광진구 군자동 63 극동하이츠빌라 가동 203호'),
  (lower(hex(randomblob(16))), '변혜림', '721227-2031519', '서울특별시 노원구 한글비석로 91, 107동 306호 (하계동, 하계1차청구아파트)'),
  (lower(hex(randomblob(16))), '오효철', '561210-1162117', '경기 수원시 권선구 칠보로 102, 107동 701호 (한양수자인파크원)'),
  (lower(hex(randomblob(16))), '유은경', '750321-2395212', '충남 서산시 공림4로 20 (예천동)'),
  (lower(hex(randomblob(16))), '이규호', '720707-1690526', '경기 시흥시 인선길 111, 251동 701호 (매꼴마을동양덱스빌)'),
  (lower(hex(randomblob(16))), '이은주', '731225-2247124', '경기도 성남시 분당구 금곡동 210, 코오롱트리펄리스 I B동 1407호'),
  (lower(hex(randomblob(16))), '전상욱', '961109-1860821', '경남 창원시 성산구 가음동 21-20, 212호'),
  (lower(hex(randomblob(16))), '정윤정', '750721-2079937', '경기도 수원시 장안구 송정로 190, 105동 703호'),
  (lower(hex(randomblob(16))), '최용규', '760416-1252225', '대전시 서구 괴정로54번길 32 (괴정동)'),
  (lower(hex(randomblob(16))), '한유정', '800929-2026322', '경기도 의정부시 호암로 256, 105동 302호 (호원동, 신일유토빌아파트)'),
  (lower(hex(randomblob(16))), '최성주', '581125-1047229', '경기도 의정부시 장곡로 240, 113동 603호 (장암동, 장암동아아파트)');

-- 확인
SELECT '비율제 인원' as type, COUNT(*) as cnt FROM user_accounting WHERE pay_type = 'commission' AND ssn != ''
UNION ALL
SELECT '풀 인원', COUNT(*) FROM business_income_pool;
