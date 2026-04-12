import { useEffect, useState } from 'react';
import { api } from '../api';

export function useBranches() {
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.branches.list()
      .then((res) => setBranches(res.branches.map((b) => b.name)))
      .catch(() => setBranches(['의정부', '서초']))
      .finally(() => setLoading(false));
  }, []);

  const reload = () => {
    api.branches.list()
      .then((res) => setBranches(res.branches.map((b) => b.name)))
      .catch(() => {});
  };

  return { branches, loading, reload };
}
