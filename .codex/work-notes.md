# Work Notes

- 2026-05-21: User requested bid analysis data, including freelancer/manual/synced rows, to feed Statistics for personnel evaluation. Also requested admin manual input and edit capability for bid analysis rows, including synced rows.
- 2026-05-21: User requested freelancer-only 마이페이지 > 입찰 내역. Freelancers do not use consultant journals, so their bid form should mirror journal "입찰" fields except 업무시간 and 대리입찰, then sync automatically into 관리 > 입찰내역 > 입찰분석.
- 2026-05-21: User requested backfilling old consultant journal "브리핑자료제출" logs into 관리 > 입찰내역 > 브리핑자료 제출 so old logs populate the current submission list and match-check baseline.
- 2026-05-21: User requested moving "브리핑자료 일정 등록" out of 사내 커뮤니티 and into 좌측 사이드바 관리 > 입찰내역, with the current content grouped under "브리핑자료 제출". Keep using the existing briefing_schedule/admin_notes data unless future bid workflow requires a dedicated table.
- 2026-05-21: User redefined 관리 > 입찰내역 as having two subcategories: 브리핑자료제출 and new 입찰분석. 입찰분석 should be a 20-row paginated list with period filtering and Excel upload for historical journal data.
- 2026-05-21: User clarified 입찰분석 should ignore 감정가, distinguish 낙찰유무 as 실패/낙찰/취소, sync consultant journal 입찰 entries into the list, and handle duplicates between Excel uploads and journal records.
- 2026-05-21: User requested 입찰분석 UI polish, 1~10 page buttons with > more paging, and branch/assignee filters.
- 2026-05-21: User requested new 관리 > 입찰내역 > 자료.입찰 확인 subcategory to compare 브리핑자료 제출 and 입찰분석 case numbers and list unmatched records.
- 2026-05-21: User requested local-only update workflow.
- Do not deploy unless the user explicitly orders deployment.
- Keep notes of upcoming requested updates while working.
- 2026-05-21: User asked to report current priority order of dashboard 내 알림 before making changes.
- 2026-05-21: User requested 공지사항 as a 커뮤니티 subcategory beside 브리핑자료 일정등록. Authoring allowed for admin+ roles, cc_ref, accountant/accountant_asst; reading all staff. Dashboard should show latest notice one-line and link directly to the note.
- 2026-05-21: User requested branch-based workflow going forward. Current local work moved from main to feature/local-dashboard-notice-leave-updates. Do not deploy without explicit order.
- 2026-05-21: User requested 사내 커뮤니티 > 법률지원 subdivision into 경매/소송/법률용어/보수계산. Existing 문의상담 should become 소송, 게시글 분류 이동 should be possible, 경매/소송 question form should include "소송비용도 궁금합니다.", and 법률용어 should be read-only/no-answer except authored by 법률지원팀/admin+.
- 2026-05-21: User requested replacing Dashboard 내 알림 panel with "오늘의 한줄 법률상식". Source is 법률지원 > 법률용어, showing one item for 3 days, then the next item, looping after the last. Clicking opens the source legal_terms note detail.
