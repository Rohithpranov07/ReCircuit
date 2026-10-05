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

// --- read models used by the passport screens (T4.2); they mirror the JSON the API returns ---------------
export interface TreeRow {            // GET /units/{id}/tree
  depth: number; unit_id: number; parent_unit_id: number;
  serial_no: string; model_number: string; category: Category;
}
export interface TestLine {
  test_type: string; result: TestResult; measured_value: number | null; health_score: number | null;
}
export interface UnitEvent {          // GET /units/{id}/events
  event_id: number; event_type: EventType; occurred_at: string; recorded_at: string;
  facility_id: number; facility_name: string; actor_id: number; actor_name: string;
  event_hash: string; corrects_event_id: number | null; tests: TestLine[];
}
export interface TransferRow {        // GET /transfers
  transfer_id: number; manifest_no: string; from_org_id: number; from_org: string;
  to_org_id: number; to_org: string; shipped_at: string; received_at: string | null;
  total_mass_kg: string | null;
  items: { unit_id: number; declared_condition: Condition; serial_no: string; model_number: string }[];
  discrepancies: { unit_id: number; kind: 'MISSING' | 'EXTRA' }[];
}
export interface CertificateRow {     // GET /certificates
  cert_id: number; cert_no: string; recycler_id: number; recycler: string;
  producer_id: number | null; producer: string | null; category: string; financial_year: string;
  claimed_kg: string; backed_kg: string; unit_count: number; issued_on: string;
}
export interface PassportRef {        // GET /reports/passport?unit_id=
  unit_id: number; passport_uid: string;
}

// --- read models used by the workbenches (T4.3) ----------------------------------------------------------
export interface Me {                 // GET /auth/me
  actor_id: number; full_name: string; role: Role; org_id: number; org_name: string; org_type: OrgType;
  facilities: { facility_id: number; facility_name: string }[];
}
export interface OrgRow {             // GET /organizations
  org_id: number; org_name: string; org_type: OrgType;
  facilities: { facility_id: number; facility_name: string; pincode: string }[];
}
export interface ModelRow {           // GET /models
  model_id: number; model_number: string; category: Category; mass_g: string; spec: Record<string, unknown>;
  manufacturer_id: number; manufacturer: string;
}
export interface ReuseRow {           // GET /inventory/reuse
  unit_id: number; passport_uid: string; category: Category; model_number: string;
  latest_health: number | null; test_type: string | null; tested_at: string | null; current_holder_org_id: number | null;
}
export interface EventResult { event_type: EventType; event_hash: string }

// --- recycler screens (T4.4) ---------------------------------------------------------------------------------
export interface UnitStateRow {       // GET /reports/current-state
  unit_id: number; passport_uid: string; current_state: EventType | null; state_since: string | null;
  current_holder_org_id: number | null; serial_no: string; model_number: string; category: Category;
  mass_g: string; certificate_id: number | null;
}

// --- remaining screens (T4.5) ------------------------------------------------------------------------------
export type ReportRow = Record<string, unknown>;
export interface MaterialRow { material_id: number; material_name: string; is_critical: boolean; is_hazardous: boolean }
export interface ComplianceRow {      // GET /compliance/{producer_id}
  producer_id: number; category: string; financial_year: string; target_kg: string; acquired_kg: string; pct_of_target: string;
}
export interface AuditLogRow {        // GET /audit/log
  log_id: number; logged_at: string; actor_id: number; actor_name: string; action: string; entity: string; entity_id: string;
  details: Record<string, unknown> | null;
}
export interface VerifyOne { unit_id: number; verified: boolean; first_broken_event_id: number | null }
export interface VerifyAll { checked: number; verified: boolean; broken: { unit_id: number; first_broken_event_id: number }[] }
export interface ActorRow {           // GET /actors
  actor_id: number; full_name: string; role: Role; email: string; is_active: boolean; facility_id: number; facility_name: string; org_id: number;
}
export interface AdminOrgRow {
  org_id: number; org_name: string; org_type: OrgType; cpcb_reg_no: string | null; gstin: string | null;
  facilities: { facility_id: number; facility_name: string; pincode: string; authorised_capacity_tpa: string | null }[];
}

export interface Dashboard {          // GET /admin/dashboard
  units_by_state: { state: string; units: number }[];
  open_manifests: number; financial_year: string; certificates_this_year: number;
}
