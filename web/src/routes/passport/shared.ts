import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Me, ModelRow, OrgRow } from '../../api/types';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });
export const useOrganizations = () => useQuery({ queryKey: ['organizations'], queryFn: () => api<OrgRow[]>('/organizations') });
export const useModels = (category?: string) =>
  useQuery({ queryKey: ['models', category ?? 'all'],
             queryFn: () => api<ModelRow[]>(`/models?limit=500${category ? `&category=${category}` : ''}`) });
