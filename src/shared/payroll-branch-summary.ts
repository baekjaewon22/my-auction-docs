export interface BranchSummaryQueryScope {
  summaryStart: string;
  summaryEnd: string;
  branchWhere: string;
  baseParams: string[];
  contractParams: string[];
  bindings: string[];
}

export function buildBranchSummaryQueryScope(month: string, branch: string): BranchSummaryQueryScope {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('INVALID_PAYROLL_MONTH');
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const summaryStart = `${month}-01`;
  const summaryEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
  const branchWhere = branch ? ' AND sr.branch = ?' : '';
  const baseParams = [summaryStart, summaryEnd, summaryStart, summaryEnd, ...(branch ? [branch] : [])];
  const contractParams = [summaryStart, summaryEnd, ...(branch ? [branch] : [])];
  return {
    summaryStart,
    summaryEnd,
    branchWhere,
    baseParams,
    contractParams,
    bindings: [...baseParams, ...contractParams],
  };
}
