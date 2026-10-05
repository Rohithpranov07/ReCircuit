import type { Role } from '../api/types';

/** Each role's home screen (PRD §13). */
export const ROLE_HOME: Record<Role, string> = {
  PRODUCER: '/producer',
  COLLECTOR: '/collector',
  TECHNICIAN: '/technician',
  RECYCLER_OPERATOR: '/recycler',
  AUDITOR: '/auditor',
  ADMIN: '/admin',
};

export const ROLE_LABELS: Record<Role, string> = {
  PRODUCER: 'Producer',
  COLLECTOR: 'Collector',
  TECHNICIAN: 'Technician',
  RECYCLER_OPERATOR: 'Recycler',
  AUDITOR: 'Auditor',
  ADMIN: 'Administrator',
};
