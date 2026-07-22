export function confirmedSalesSql(alias = 'sr'): string {
  return `(
    (
      ${alias}.payment_type = '카드'
      AND ${alias}.status IN ('confirmed', 'card_pending')
      AND TRIM(COALESCE(${alias}.card_deposit_date, '')) != ''
    )
    OR (
      COALESCE(${alias}.payment_type, '') != '카드'
      AND ${alias}.status IN ('confirmed', 'card_pending')
    )
  )`;
}

export function recognizedSalesDateSql(alias = 'sr'): string {
  return `CASE
    WHEN ${alias}.payment_type = '카드' THEN NULLIF(TRIM(${alias}.card_deposit_date), '')
    ELSE COALESCE(NULLIF(TRIM(${alias}.deposit_date), ''), ${alias}.contract_date)
  END`;
}

export function salesPeriodSql(alias = 'sr'): string {
  const confirmed = confirmedSalesSql(alias);
  const recognizedDate = recognizedSalesDateSql(alias);
  return `(
    (${confirmed} AND ${recognizedDate} BETWEEN ? AND ?)
    OR (NOT ${confirmed} AND ${alias}.contract_date BETWEEN ? AND ?)
  )`;
}
