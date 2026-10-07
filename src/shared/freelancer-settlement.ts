export interface FreelancerSettlementInput {
  /** 기존 프리랜서 정산수익 합계(기존 지급 항목 포함) */
  settlementIncome: number;
  /** 계약 랭킹에 따라 지급하는 계약포상 */
  contractAward?: number;
  /** 영상제작 외주 결과물 확정 금액 */
  videoProductionIncome?: number;
  /** 비율제 추가정산 중 원천세 과세 대상 금액 */
  taxableExtraIncome?: number;
  /** 비율제 추가정산 중 원천세 면제 금액 */
  taxExemptIncome?: number;
  /** 식대 등 소득과 과세표준에서 함께 차감하는 금액 */
  preTaxDeduction?: number;
  /** 원천징수 뒤 차감하는 기타 공제 */
  postTaxDeduction?: number;
}

export interface FreelancerSettlementResult {
  settlementIncome: number;
  contractAward: number;
  videoProductionIncome: number;
  taxableExtraIncome: number;
  taxExemptIncome: number;
  grossIncome: number;
  preTaxDeduction: number;
  taxableIncome: number;
  withholdingTax: number;
  postTaxDeduction: number;
  netPay: number;
}

function finiteMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function nonNegativeMoney(value: unknown): number {
  return Math.max(finiteMoney(value), 0);
}

/**
 * 프리랜서 지급액을 하나의 과세표준으로 계산한다.
 *
 * 기존 정산수익과 계약포상을 먼저 합치고, 면세항목·세전공제를
 * 제외한 금액 전체에 3.3%를 한 번 적용한다. 원천세는 기존 급여 규칙대로
 * 10원 미만을 절사한다.
 */
export function calculateFreelancerSettlement(input: FreelancerSettlementInput): FreelancerSettlementResult {
  const settlementIncome = finiteMoney(input.settlementIncome);
  const contractAward = nonNegativeMoney(input.contractAward);
  const videoProductionIncome = nonNegativeMoney(input.videoProductionIncome);
  const taxableExtraIncome = finiteMoney(input.taxableExtraIncome);
  const taxExemptIncome = finiteMoney(input.taxExemptIncome);
  const preTaxDeduction = nonNegativeMoney(input.preTaxDeduction);
  const postTaxDeduction = nonNegativeMoney(input.postTaxDeduction);
  const grossIncome = settlementIncome + contractAward + videoProductionIncome + taxableExtraIncome + taxExemptIncome;
  const taxableIncome = Math.max(grossIncome - taxExemptIncome - preTaxDeduction, 0);
  const withholdingTax = Math.trunc((taxableIncome * 0.033) / 10) * 10;
  const netPay = grossIncome - preTaxDeduction - withholdingTax - postTaxDeduction;

  return {
    settlementIncome,
    contractAward,
    videoProductionIncome,
    taxableExtraIncome,
    taxExemptIncome,
    grossIncome,
    preTaxDeduction,
    taxableIncome,
    withholdingTax,
    postTaxDeduction,
    netPay,
  };
}

function truncMoney(value: number): number {
  return Math.trunc((Number(value) || 0) / 10) * 10;
}

function payrollMoney(value: number, month: string): number {
  return /^\d{4}-\d{2}$/.test(month) && month >= '2026-06'
    ? truncMoney(value)
    : Math.round(Number(value) || 0);
}

function vatSupplyAmount(value: unknown, month: string): number {
  return payrollMoney((Number(value) || 0) * 10 / 11, month);
}

function parseManualMoney(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return Number(String(value || '').replace(/[^0-9]/g, '')) || 0;
}

export function calculateFreelancerSalesIncome(
  records: readonly Record<string, any>[],
  rate: number,
  month: string,
): {
  normalSupply: number;
  normalRefundSupply: number;
  commissionIncome: number;
  proxyIncome: number;
  totalIncome: number;
} {
  const normalRecords = records.filter((record: any) => record?.type !== '매수신청대리');
  const normalSupply = normalRecords.reduce(
    (sum: number, record: any) => sum + (Number(record?.supply_amount) || vatSupplyAmount(record?.amount, month)),
    0,
  );
  const normalRefundSupply = normalRecords.reduce(
    (sum: number, record: any) => sum + vatSupplyAmount(Number(record?.refund_amount) || 0, month),
    0,
  );
  const commissionIncome = truncMoney((normalSupply - normalRefundSupply) * rate / 100);
  const proxyIncome = records
    .filter((record: any) => record?.type === '매수신청대리')
    .reduce((sum: number, record: any) => {
      const supplied = Number(record?.supply_amount);
      if (Number.isFinite(supplied)) return sum + Math.max(supplied, 0);
      const remainingAmount = Math.max(
        (Number(record?.amount) || 0) - (Number(record?.refund_amount) || 0),
        0,
      );
      return sum + Math.max(
        vatSupplyAmount(remainingAmount, month) - (Number(record?.proxy_cost) || 0),
        0,
      );
    }, 0);
  return {
    normalSupply,
    normalRefundSupply,
    commissionIncome,
    proxyIncome,
    totalIncome: commissionIncome + proxyIncome,
  };
}

/**
 * 저장 요청에 담긴 정산 응답과 수동 입력을 서버에서도 동일하게 계산한다.
 * 구·신 안건수당은 기존 별도 정책을 유지하므로 여기에서 새로 합산하지 않는다.
 */
export function calculateFreelancerSavedSettlement(
  response: Record<string, any>,
  saveData: Record<string, any>,
  month: string,
): FreelancerSettlementResult {
  const rate = Number(response?.accounting?.commission_rate) || 0;
  const records = Array.isArray(response?.records) ? response.records : [];
  const salesIncome = calculateFreelancerSalesIncome(records, rate, month);
  const positionAllowance = month >= '2026-08'
    ? Number(response?.summary?.position_allowance || response?.accounting?.position_allowance) || 0
    : 0;
  const extraItems = Array.isArray(saveData?.commExtras) ? saveData.commExtras : [];
  const extraDetails = extraItems.map((item: any) => {
    const raw = parseManualMoney(item?.amount);
    return {
      amount: item?.skipRate ? raw : truncMoney(raw * rate / 100),
      taxExempt: !!item?.skipTax,
    };
  });
  const deductionItems = Array.isArray(saveData?.commDeductions) ? saveData.commDeductions : [];
  const preTaxDeduction = deductionItems
    .filter((item: any) => item?.isFood || item?.skipTax)
    .reduce((sum: number, item: any) => sum + parseManualMoney(item?.amount), 0);
  const postTaxDeduction = deductionItems
    .filter((item: any) => !item?.isFood && !item?.skipTax)
    .reduce((sum: number, item: any) => sum + parseManualMoney(item?.amount), 0);
  const isContractAwardMonth = response?.is_contract_award_month ?? response?.is_payout_month;
  const contractAward = isContractAwardMonth && response?.contract_award?.rank
    ? Number(response.contract_award.award) || 0
    : 0;
  const videoProductionIncome = Number(response?.video_production?.total_amount) || 0;

  return calculateFreelancerSettlement({
    settlementIncome: salesIncome.totalIncome + positionAllowance,
    contractAward,
    videoProductionIncome,
    taxableExtraIncome: extraDetails
      .filter((item) => !item.taxExempt)
      .reduce((sum, item) => sum + item.amount, 0),
    taxExemptIncome: extraDetails
      .filter((item) => item.taxExempt)
      .reduce((sum, item) => sum + item.amount, 0),
    preTaxDeduction,
    postTaxDeduction,
  });
}

/** 저장·잠금·이월이 모두 같은 최종 지급액을 읽도록 canonical 값을 함께 기록한다. */
export function applyFreelancerSettlementToSaveData(
  saveData: Record<string, any>,
  settlement: FreelancerSettlementResult,
): Record<string, any> {
  const snapshot = saveData.payroll_snapshot;
  return {
    ...saveData,
    net_pay: settlement.netPay,
    freelancer_settlement: settlement,
    payroll_snapshot: snapshot ? {
      ...snapshot,
      manual: {
        ...(snapshot.manual || {}),
        net_pay: settlement.netPay,
        freelancer_settlement: settlement,
      },
    } : null,
  };
}
