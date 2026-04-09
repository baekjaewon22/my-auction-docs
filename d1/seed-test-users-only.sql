INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mem-01', 'member01@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '이상담', '010-2222-0001', 'member', '의정부', '경매사업부1팀', '대리', 1);

INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mem-02', 'member02@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '최컨설', '010-2222-0002', 'member', '의정부', '경매사업부2팀', '주임', 1);

INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mem-05', 'member05@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '강입찰', '010-2222-0005', 'member', '의정부', '경매사업부3팀', '주임', 1);

INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mgr-01', 'manager01@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '오팀장', '010-3333-0001', 'manager', '의정부', '경매사업부1팀', '팀장', 1);
