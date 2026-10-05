// web/src/api/types.ts — the ONLY place these TS types are defined
export type Category  = 'DEVICE'|'BOARD'|'BATTERY'|'STORAGE'|'MEMORY'|'DISPLAY'|'CHIP'|'OTHER';
export type EventType = 'MANUFACTURED'|'SOLD'|'COLLECTED'|'DIAGNOSED'|'HARVESTED'
                      | 'REFURBISHED'|'REINSTALLED'|'RECYCLED'|'DISPOSED';
export type Role      = 'PRODUCER'|'COLLECTOR'|'TECHNICIAN'|'RECYCLER_OPERATOR'|'AUDITOR'|'ADMIN';
export type OrgType   = 'PRODUCER'|'COLLECTOR'|'DISMANTLER'|'REFURBISHER'|'RECYCLER';
export type TestResult = 'PASS'|'DEGRADED'|'FAIL';
export type Condition  = 'WORKING'|'FAULTY'|'SCRAP';

export interface UnitPassport {
  unit_id: number;
  passport_uid: string;            // UUID
  serial_no: string;
  manufactured_on: string | null;  // ISO date
  model: { model_id: number; model_number: string; category: Category; mass_g: number;
           manufacturer: string; spec: Record<string, unknown>;
           materials: { material_name: string; mass_mg: number; is_critical: boolean }[] };
  current_state: EventType | null;
  state_since: string | null;      // ISO timestamp
  current_holder: { org_id: number; org_name: string } | null;
  current_parent: { unit_id: number; passport_uid: string; model_number: string } | null;
  chain_verified: boolean;         // from sp_verify_chain
}

export interface PublicPassport {
  passport_uid: string;
  model_number: string; category: Category; manufacturer: string;
  manufactured_on: string | null;
  current_state: EventType | null;
  history: { type: EventType; date: string }[];
  latest_health: number | null;
  chain_verified: boolean;
}

export interface IssueCertificateRequest {
  cert_no: string;                 // e.g. "RC-REC-2026-000412"
  category: string;                // e.g. "ITEW2"  (CPCB EEE code; free text in v1.0)
  quantity_kg: number;
  financial_year: string;          // "2026-27"
  issued_on: string;               // ISO date
  units: { unit_id: number; recovered_mass_g: number }[];
}

export interface ApiError {        // PRD §11 error shape
  error: { code: string; constraint: string | null; message: string };
}

// Added by T4.1 for the authentication endpoints (mirrors api/app/schemas.py TokenResponse).
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}
export interface Session {
  actor_id: number;
  org_id: number;
  role: Role;
}
