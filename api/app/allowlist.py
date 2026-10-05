"""The only database routines the API may call (build playbook B.3). Each entry records the routine's kind
(PROCEDURE -> CALL, FUNCTION -> SELECT, erratum E1) and its parameter names with their SQL types, in order."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Routine:
    kind: Literal["PROCEDURE", "FUNCTION"]
    params: tuple[tuple[str, str], ...]   # (parameter name, SQL type)


def _r(kind: Literal["PROCEDURE", "FUNCTION"], *params: tuple[str, str]) -> Routine:
    return Routine(kind, params)


ROUTINES: dict[str, Routine] = {
    "sp_record_event": _r("PROCEDURE", ("p_unit", "bigint"), ("p_type", "varchar"), ("p_at", "timestamptz"),
                          ("p_facility", "int"), ("p_corrects", "bigint")),
    "sp_harvest": _r("PROCEDURE", ("p_unit", "bigint"), ("p_at", "timestamptz"), ("p_facility", "int")),
    "sp_dismantle": _r("PROCEDURE", ("p_device", "bigint"), ("p_parts", "jsonb"), ("p_at", "timestamptz"),
                       ("p_facility", "int")),
    "sp_reinstall": _r("PROCEDURE", ("p_unit", "bigint"), ("p_new_parent", "bigint"), ("p_at", "timestamptz"),
                       ("p_facility", "int")),
    "sp_receive_transfer": _r("PROCEDURE", ("p_transfer", "bigint"), ("p_at", "timestamptz"),
                              ("p_missing", "bigint[]"), ("p_extra", "bigint[]")),
    "sp_record_tests": _r("PROCEDURE", ("p_unit", "bigint"), ("p_at", "timestamptz"), ("p_facility", "int"),
                          ("p_tests", "jsonb")),
    "sp_set_materials": _r("PROCEDURE", ("p_model", "int"), ("p_materials", "jsonb")),
    "sp_set_target": _r("PROCEDURE", ("p_category", "varchar"), ("p_fy", "char(7)"), ("p_target_kg", "numeric")),
    "sp_allocate_certificate": _r("PROCEDURE", ("p_cert", "bigint"), ("p_producer", "int")),
    "sp_admin_set_actor_active": _r("PROCEDURE", ("p_actor", "int"), ("p_active", "boolean")),
    "sp_refresh_material_recovery": _r("PROCEDURE"),
    "sp_create_unit": _r("FUNCTION", ("p_model", "int"), ("p_serial", "varchar"), ("p_manufactured_on", "date"),
                         ("p_parent", "bigint")),
    "sp_bulk_create_units": _r("FUNCTION", ("p_units", "jsonb")),
    "sp_register_model": _r("FUNCTION", ("p_model_number", "varchar"), ("p_category", "varchar"),
                            ("p_mass_g", "numeric"), ("p_spec", "jsonb")),
    "sp_create_transfer": _r("FUNCTION", ("p_manifest_no", "varchar"), ("p_to_org", "int"),
                             ("p_shipped_at", "timestamptz"), ("p_total_mass_kg", "numeric"), ("p_items", "jsonb")),
    "sp_issue_certificate": _r("FUNCTION", ("p_cert_no", "varchar"), ("p_category", "varchar"),
                               ("p_quantity_kg", "numeric"), ("p_fy", "char(7)"), ("p_issued_on", "date"),
                               ("p_units", "jsonb")),
    "sp_admin_create_org": _r("FUNCTION", ("p_name", "varchar"), ("p_type", "varchar"), ("p_cpcb", "varchar"),
                              ("p_gstin", "char(15)")),
    "sp_admin_create_facility": _r("FUNCTION", ("p_org", "int"), ("p_name", "varchar"), ("p_pincode", "char(6)"),
                                   ("p_capacity", "numeric")),
    "sp_admin_create_actor": _r("FUNCTION", ("p_facility", "int"), ("p_name", "varchar"), ("p_role", "varchar"),
                                ("p_email", "varchar"), ("p_password_hash", "text")),
    "fn_auth_lookup": _r("FUNCTION", ("p_email", "varchar")),
    "sp_verify_chain": _r("FUNCTION", ("p_unit", "bigint")),
    "fn_part_tree": _r("FUNCTION", ("p_root", "bigint"), ("p_as_of", "timestamptz")),
    "fn_latest_health": _r("FUNCTION", ("p_unit", "bigint")),
}

# application role -> PostgreSQL role (fixed map, build playbook B.3)
ROLE_MAP: dict[str, str] = {
    "PRODUCER": "rc_producer", "COLLECTOR": "rc_collector", "TECHNICIAN": "rc_technician",
    "RECYCLER_OPERATOR": "rc_recycler", "AUDITOR": "rc_auditor", "ADMIN": "rc_admin",
}
LOGIN_DB_ROLE = "rc_auth"
PUBLIC_DB_ROLE = "public_reader"
ALLOWED_DB_ROLES = frozenset({*ROLE_MAP.values(), LOGIN_DB_ROLE, PUBLIC_DB_ROLE})
