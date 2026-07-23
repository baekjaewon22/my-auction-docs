export function confirmedSalesSql(alias = 'sr'): string {
  return `(
    (
      COALESCE(${alias}.direction, 'income') = 'expense'
      AND ${alias}.status IN ('confirmed', 'card_pending')
    ) OR (
      COALESCE(${alias}.direction, 'income') != 'expense'
      AND (
        (
          ${alias}.payment_type = '카드'
          AND ${alias}.status IN ('confirmed', 'card_pending')
          AND TRIM(COALESCE(${alias}.card_deposit_date, '')) != ''
        )
        OR (
          COALESCE(${alias}.payment_type, '') != '카드'
          AND ${alias}.status IN ('confirmed', 'card_pending')
        )
      )
    )
  )`;
}

export function recognizedSalesDateSql(alias = 'sr'): string {
  return `CASE
    WHEN COALESCE(${alias}.direction, 'income') = 'expense'
      THEN COALESCE(NULLIF(TRIM(${alias}.deposit_date), ''), ${alias}.contract_date)
    WHEN ${alias}.payment_type = '카드' THEN NULLIF(TRIM(${alias}.card_deposit_date), '')
    ELSE COALESCE(NULLIF(TRIM(${alias}.deposit_date), ''), ${alias}.contract_date)
  END`;
}

/** 통계 합계용 상태: 카드 정산 전 매출은 일반 대기 금액에 포함한다. */
export function analyticsSalesBucketSql(alias = 'sr'): string {
  return `CASE
    WHEN ${confirmedSalesSql(alias)} THEN 'confirmed'
    WHEN ${alias}.status IN ('pending', 'card_pending') THEN 'pending'
    ELSE ${alias}.status
  END`;
}

export function pendingCardSettlementSql(alias = 'sr'): string {
  return `(
    COALESCE(${alias}.direction, 'income') != 'expense'
    AND ${alias}.status IN ('confirmed', 'card_pending')
    AND ${alias}.payment_type = '카드'
    AND TRIM(COALESCE(${alias}.card_deposit_date, '')) = ''
  )`;
}

export function payrollRecognizedOrRefundedSql(alias = 'sr'): string {
  return `(${confirmedSalesSql(alias)} OR ${alias}.status = 'refunded')`;
}

export function salesPeriodSql(alias = 'sr'): string {
  const confirmed = confirmedSalesSql(alias);
  const recognizedDate = recognizedSalesDateSql(alias);
  return `(
    (${confirmed} AND ${recognizedDate} BETWEEN ? AND ?)
    OR (NOT ${confirmed} AND ${alias}.contract_date BETWEEN ? AND ?)
  )`;
}
