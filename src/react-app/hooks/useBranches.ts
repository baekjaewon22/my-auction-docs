import { useEffect, useState } from 'react';
import { api } from '../api';
import { CANONICAL_BRANCHES, normalizeBranchName } from '../lib/branchAliases';

export function useBranches() {
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.branches.list()
      .then((res) => setBranches(Array.from(new Set(res.branches.map((b) => normalizeBranchName(b.name) || b.name)))))
      .catch(() => setBranches([...CANONICAL_BRANCHES]))
      .finally(() => setLoading(false));
  }, []);

  const reload = () => {
    api.branches.list()
      .then((res) => setBranches(Array.from(new Set(res.branches.map((b) => normalizeBranchName(b.name) || b.name)))))
      .catch(() => {});
  };

  return { branches, loading, reload };
}
