import { useQuery } from '@tanstack/react-query';
import { api, type Epic, type Outcome, type Sector, type Status, type UserOption } from './api';

export const useStatuses = () => useQuery({ queryKey: ['statuses'], queryFn: () => api.get<Status[]>('/statuses') });
export const useSectors = () => useQuery({ queryKey: ['sectors'], queryFn: () => api.get<Sector[]>('/sectors') });
export const useUserOptions = () =>
  useQuery({ queryKey: ['users', 'options'], queryFn: () => api.get<UserOption[]>('/users/options') });
export const useEpics = (includeInactive = false) =>
  useQuery({
    queryKey: ['epics', { includeInactive }],
    queryFn: () => api.get<Epic[]>(`/epics${includeInactive ? '?include_inactive=true' : ''}`),
  });
export const useOutcomes = (includeInactive = false) =>
  useQuery({
    queryKey: ['outcomes', { includeInactive }],
    queryFn: () => api.get<Outcome[]>(`/outcomes${includeInactive ? '?include_inactive=true' : ''}`),
  });
