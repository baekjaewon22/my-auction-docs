import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canUploadBriefingMaterial,
  canViewBriefingMaterial,
} from '../src/shared/briefing-material-access.ts';
import { JEONG_MINHO_USER_ID } from '../src/shared/eviction-quote-access.ts';

const archivePage = readFileSync(new URL('../src/react-app/pages/Archive.tsx', import.meta.url), 'utf8');
const expenseArchivePage = readFileSync(new URL('../src/react-app/pages/ExpenseReceiptArchive.tsx', import.meta.url), 'utf8');
const adminNotesPage = readFileSync(new URL('../src/react-app/pages/AdminNotes.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');

test('브리핑자료 열람과 등록 권한을 공유 헬퍼가 구분한다', () => {
  for (const role of ['master', 'ceo', 'cc_ref']) {
    assert.equal(canViewBriefingMaterial({ role }), true, `${role} 열람`);
    assert.equal(canUploadBriefingMaterial({ role }), true, `${role} 등록`);
  }

  assert.equal(canViewBriefingMaterial({ id: JEONG_MINHO_USER_ID, role: 'member' }), true);
  assert.equal(canUploadBriefingMaterial({ id: JEONG_MINHO_USER_ID, role: 'member' }), true);

  assert.equal(canViewBriefingMaterial({ role: 'member', department: '명도팀' }), true);
  assert.equal(canViewBriefingMaterial({ role: 'member', team_name: '명도팀' }), true);
  assert.equal(canUploadBriefingMaterial({ role: 'member', department: '명도팀' }), false);
  assert.equal(canUploadBriefingMaterial({ role: 'member', team_name: '명도팀' }), false);

  for (const role of ['admin', 'accountant', 'accountant_asst', 'director', 'manager', 'member', 'support']) {
    assert.equal(canViewBriefingMaterial({ id: `other-${role}`, role }), false, `${role} 열람 차단`);
    assert.equal(canUploadBriefingMaterial({ id: `other-${role}`, role }), false, `${role} 등록 차단`);
  }
  assert.equal(canViewBriefingMaterial({ role: 'member', login_type: 'freelancer' }), false);
});

test('문서보관함은 권한 있는 사용자에게만 브리핑자료 진입 UI를 보인다', () => {
  assert.match(archivePage, /const canViewBriefing = canViewBriefingMaterial\(user\)/);
  assert.match(archivePage, /const showBriefingArchive = archiveCategory === 'briefing' && canViewBriefing/);
  assert.match(archivePage, /\{canViewBriefing && <button type="button" onClick=\{\(\) => setSearchParams\(\{ category: 'briefing' \}\)\}/);
  assert.match(expenseArchivePage, /const canViewBriefing = canViewBriefingMaterial\(user\)/);
  assert.match(expenseArchivePage, /\{canViewBriefing && <button type="button" onClick=\{\(\) => navigate\('\/archive\?category=briefing'\)\}/);
});

test('무권한 briefing 쿼리는 403 화면 대신 기본 문서보관함으로 조용히 폴백한다', () => {
  assert.match(archivePage, /if \(archiveCategory !== 'briefing' \|\| canViewBriefing\) return;/);
  assert.match(archivePage, /next\.delete\('category'\)/);
  assert.match(archivePage, /setSearchParams\(next, \{ replace: true \}\)/);
  assert.match(archivePage, /if \(showBriefingArchive\) return;[\s\S]*?api\.documents\.list\('approved'\)/);
  assert.doesNotMatch(archivePage, /403|AccessDenied|접근\s*불가/);
});

test('프리랜서는 공유 열람 권한이 있을 때만 브리핑 보관함 경로를 사용한다', () => {
  assert.match(app, /function ArchiveRoute[\s\S]*?isBriefingArchive && canViewBriefingMaterial\(user\)/);
  assert.match(app, /path="archive" element=\{<ArchiveRoute><ArchivePage \/><\/ArchiveRoute>\}/);
  assert.match(layout, /\{!isFreelancer && \([\s\S]*?to="\/archive"/);
  assert.match(layout, /\{isFreelancer && canViewBriefingArchive && \([\s\S]*?to="\/archive\?category=briefing"/);
});

test('브리핑자료 제출 UI와 저장 핸들러는 업로드 권한을 공유한다', () => {
  assert.match(adminNotesPage, /const canCreateBriefingSchedule = canUploadBriefingMaterial\(user\)/);
  assert.match(adminNotesPage, /isBriefingSchedule && !canCreateBriefingSchedule/);
  assert.match(adminNotesPage, /communitySection === 'briefing_schedule' && !canCreateBriefingSchedule/);
  assert.doesNotMatch(adminNotesPage, /const canCreateBriefingSchedule = !!user && \['master', 'ceo', 'cc_ref', 'admin'\]/);
});

test('정민호 지사장은 저장된 역할이 바뀌어도 브리핑 제출 라우트와 메뉴에 진입한다', () => {
  assert.match(app, /const canViewExistingBidHistory = [\s\S]*?\['master', 'ceo', 'cc_ref', 'admin'\]\.includes\(user\.role\)/);
  assert.match(app, /!canViewExistingBidHistory && !canUploadBriefingMaterial\(user\)/);
  assert.match(layout, /const canViewBidHistory = \(!isFreelancer && \['master', 'ceo', 'cc_ref', 'admin'\]\.includes\(role\)\)[\s\S]*?\|\| canUploadBriefingMaterial\(user\)/);
  assert.match(layout, /\{canViewBidHistory && \([\s\S]*?to="\/bid-history"/);
});

test('고정 ID로만 진입한 정민호 지사장에게는 브리핑 제출 외 관리 탭을 노출하지 않는다', () => {
  assert.match(adminNotesPage, /const canManageBidHistory = !!user[\s\S]*?\['master', 'ceo', 'cc_ref', 'admin'\]\.includes\(user\.role\)/);
  assert.match(adminNotesPage, /isBidHistoryMode && canManageBidHistory && requestedBidHistorySection === 'bid_analysis'/);
  assert.match(adminNotesPage, /isBidHistoryMode && canManageBidHistory && requestedBidHistorySection === 'bid_match_check'/);
  assert.match(adminNotesPage, /\{canManageBidHistory && <>[\s\S]*?setSearchParams\(\{ section: 'bid_analysis' \}\)[\s\S]*?setSearchParams\(\{ section: 'bid_match_check' \}\)[\s\S]*?<\/>\}/);
  assert.match(adminNotesPage, /isBidHistoryMode && canManageBidHistory && bidHistorySection === 'bid_analysis' \? <BidAnalysis \/>/);
  assert.match(adminNotesPage, /isBidHistoryMode && canManageBidHistory && bidHistorySection === 'bid_match_check' \? <BidMatchCheck \/>/);
});

test('관리 권한 없이 분석 쿼리로 직접 진입하면 브리핑 제출로 조용히 정규화한다', () => {
  assert.match(adminNotesPage, /!\['bid_analysis', 'bid_match_check'\]\.includes\(requestedBidHistorySection \|\| ''\)/);
  assert.match(adminNotesPage, /nextParams\.set\('section', 'briefing_schedule'\)/);
  assert.match(adminNotesPage, /setSearchParams\(nextParams, \{ replace: true \}\)/);
});

test('업무 자동화 전용 라우트와 사이드바는 기존 자동화 권한을 유지한다', () => {
  assert.match(app, /path="briefing-materials"[\s\S]*?<BusinessAutomationRoute>[\s\S]*?<BriefingMaterials \/>/);
  assert.match(layout, /\{canUseDocumentGeneration && \([\s\S]*?to="\/briefing-materials"/);
});
