import { useEffect, useState } from 'react';
import { api } from '../api';

export function useDepartments() {
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.departments.list()
      .then((res) => setDepartments(res.departments.map((d) => d.name)))
      .catch(() => setDepartments(['경매사업부1팀', '경매사업부2팀', '경매사업부3팀'])) // fallback
      .finally(() => setLoading(false));
  }, []);

  return { departments, loading };
}
