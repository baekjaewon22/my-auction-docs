import {
  CONTRACT_AWARD_MIN_COUNT,
  CONTRACT_AWARD_MONTHLY_POLICY_FROM,
  getContractAwardPeriod,
  rankContractAwardCandidates,
  type ContractRankingCandidate,
} from '../../shared/contract-award';
import { normalizeBranchName } from './branchAliases';
import { confirmedSalesSql } from './sales-recognition';

export interface CompanyContractRankingRow extends ContractRankingCandidate {
  user_name: string;
  eff_branch: string;
  position: string;
  role: string;
}

export interface ContractAwardResult {
  rank: number | null;
  count: number;
  award: number;
  total_amount: number;
}

const CONTRACT_AWARD_NON_RECIPIENT_ROLES = new Set([
  'ceo',
  'cc_ref',
  'accountant',
  'accountant_asst',
]);

export function isContractAwardRecipient(row: Pick<CompanyContractRankingRow, 'eff_branch' | 'role'>): boolean {
  return normalizeBranchName(row.eff_branch) !== '본사관리'
    && !CONTRACT_AWARD_NON_RECIPIENT_ROLES.has(String(row.role || ''));
}

/** 지사 구분 없이 담당자별 고객 계약건수를 합산한다. */
export async function loadCompanyContractRanking(
  db: D1Database,
  periodStart: string,
  periodEnd: string,
): Promise<CompanyContractRankingRow[]> {
  const result = await db.prepare(`
    SELECT user_id,
      MAX(user_name) AS user_name,
      MAX(user_branch) AS eff_branch,
      MAX(position) AS position,
      MAX(role) AS role,
      SUM(CASE WHEN customer_amount >= 2200000 THEN 2 ELSE 1 END) AS count,
      SUM(customer_amount) AS total_amount
    FROM (
      SELECT sr.user_id,
        u.name AS user_name,
        u.branch AS user_branch,
        u.position_title AS position,
        u.role AS role,
        CASE
          WHEN COALESCE(sr.client_name, '') = '' OR COALESCE(sr.client_phone, '') = '' THEN sr.id
          ELSE LOWER(TRIM(sr.client_name)) || '|' || REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(sr.client_phone, ''), '-', ''), ' ', ''), '(', ''), ')', '')
        END AS customer_key,
        SUM(sr.amount) AS customer_amount
      FROM sales_records sr
      JOIN users u ON u.id = sr.user_id
      WHERE sr.type = '계약' AND ${confirmedSalesSql('sr')}
        AND (sr.exclude_from_count IS NULL OR sr.exclude_from_count = 0)
        AND (
          (sr.payment_type = '카드' AND sr.card_deposit_date >= ? AND sr.card_deposit_date <= ?)
          OR (sr.payment_type != '카드' AND sr.payment_type != '' AND sr.deposit_date >= ? AND sr.deposit_date <= ?)
          OR ((sr.payment_type = '' OR sr.payment_type IS NULL) AND sr.contract_date >= ? AND sr.contract_date <= ?)
        )
      GROUP BY sr.user_id, customer_key
    )
    GROUP BY user_id
    ORDER BY count DESC, total_amount DESC, user_id ASC
  `).bind(
    periodStart,
    periodEnd,
    periodStart,
    periodEnd,
    periodStart,
    periodEnd,
  ).all<CompanyContractRankingRow>();

  return (result.results || []).map((row) => ({
    ...row,
    count: Number(row.count) || 0,
    total_amount: Number(row.total_amount) || 0,
  }));
}

/** 2026-08까지 매출 화면에서 사용하던 귀속지사별 카드 집계를 그대로 유지한다. */
export async function loadLegacyBranchContractRanking(
  db: D1Database,
  periodStart: string,
  periodEnd: string,
): Promise<CompanyContractRankingRow[]> {
  const result = await db.prepare(`
    SELECT user_id, user_name, eff_branch, position, role,
      SUM(CASE WHEN customer_amount >= 2200000 THEN 2 ELSE 1 END) AS count,
      SUM(customer_amount) AS total_amount
    FROM (
      SELECT sr.user_id,
        u.name AS user_name,
        COALESCE(NULLIF(sr.attribution_branch, ''), sr.branch) AS eff_branch,
        u.position_title AS position,
        u.role AS role,
        CASE
          WHEN COALESCE(sr.client_name, '') = '' OR COALESCE(sr.client_phone, '') = '' THEN sr.id
          ELSE LOWER(TRIM(sr.client_name)) || '|' || REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(sr.client_phone, ''), '-', ''), ' ', ''), '(', ''), ')', '')
        END AS customer_key,
        SUM(sr.amount) AS customer_amount
      FROM sales_records sr
      JOIN users u ON u.id = sr.user_id
      WHERE sr.type = '계약' AND ${confirmedSalesSql('sr')}
        AND (sr.exclude_from_count IS NULL OR sr.exclude_from_count = 0)
        AND (
          (sr.payment_type = '카드' AND sr.card_deposit_date >= ? AND sr.card_deposit_date <= ?)
          OR (sr.payment_type != '카드' AND sr.payment_type != '' AND sr.deposit_date >= ? AND sr.deposit_date <= ?)
          OR ((sr.payment_type = '' OR sr.payment_type IS NULL) AND sr.contract_date >= ? AND sr.contract_date <= ?)
        )
      GROUP BY sr.user_id, eff_branch, customer_key
    )
    GROUP BY user_id, user_name, eff_branch, position, role
    ORDER BY count DESC, total_amount DESC, user_id ASC, eff_branch ASC
  `).bind(
    periodStart,
    periodEnd,
    periodStart,
    periodEnd,
    periodStart,
    periodEnd,
  ).all<CompanyContractRankingRow>();

  return (result.results || []).map((row) => ({
    ...row,
    count: Number(row.count) || 0,
    total_amount: Number(row.total_amount) || 0,
  }));
}

export async function calculateContractAwardForUser(
  db: D1Database,
  userId: string,
  payrollMonth: string,
): Promise<ContractAwardResult> {
  const period = getContractAwardPeriod(payrollMonth);
  if (!period.isAwardMonth) return { rank: null, count: 0, award: 0, total_amount: 0 };

  const ranking = rankContractAwardCandidates(
    payrollMonth,
    (await loadCompanyContractRanking(db, period.startDate, period.endDate))
      // The legacy query ranked every seller and only suppressed an HQ target's own payout.
      // Keep that historical behavior frozen through August; the new monthly pool excludes
      // users who cannot receive the award so they cannot consume September+ ranks.
      .filter((row) => payrollMonth < CONTRACT_AWARD_MONTHLY_POLICY_FROM || isContractAwardRecipient(row)),
  );
  const target = ranking.find((row) => (
    row.user_id === userId
    && row.rank <= 3
    && row.count >= CONTRACT_AWARD_MIN_COUNT
  ));
  if (!target) return { rank: null, count: 0, award: 0, total_amount: 0 };
  return {
    rank: target.rank,
    count: target.count,
    award: target.award,
    total_amount: target.total_amount,
  };
}
