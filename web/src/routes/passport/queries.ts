import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { CertificateRow, PassportRef, PublicPassport, TransferRow, TreeRow, UnitEvent, UnitPassport } from '../../api/types';

export const usePassport = (uid: string) =>
  useQuery({ queryKey: ['passport', uid], queryFn: () => api<UnitPassport>(`/units/${uid}`) });

export const useEvents = (unitId: number | undefined) =>
  useQuery({ queryKey: ['events', unitId], enabled: unitId !== undefined,
             queryFn: () => api<UnitEvent[]>(`/units/${String(unitId)}/events`) });

/** `asOf` is an ISO instant, or null for "now". */
export const useTree = (unitId: number | undefined, asOf: string | null) =>
  useQuery({ queryKey: ['tree', unitId, asOf], enabled: unitId !== undefined,
             queryFn: () => api<TreeRow[]>(`/units/${String(unitId)}/tree${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ''}`) });

export const useTransfers = (enabled: boolean) =>
  useQuery({ queryKey: ['transfers'], enabled, queryFn: () => api<TransferRow[]>('/transfers') });

export const useUnitCertificates = (unitId: number | undefined, enabled: boolean) =>
  useQuery({ queryKey: ['certificates', unitId], enabled: enabled && unitId !== undefined,
             queryFn: () => api<CertificateRow[]>(`/certificates?unit_id=${String(unitId)}`) });

export const usePublicPassport = (uid: string) =>
  useQuery({ queryKey: ['public', uid], queryFn: () => api<PublicPassport>(`/public/p/${uid}`, { quiet: true }) });

/** Passport reference for a unit id, used when opening a part from the parts tree. */
export const resolvePassportUid = async (unitId: number): Promise<string | undefined> =>
  (await api<PassportRef[]>(`/reports/passport?unit_id=${String(unitId)}`))[0]?.passport_uid;
