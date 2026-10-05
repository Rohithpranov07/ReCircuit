"""The only way the seed touches the database: the section B.3 routines, CALL for procedures and
SELECT for functions, with parameters bound (never interpolated)."""
from __future__ import annotations

from typing import Any

# routine -> (kind, parameter types in order); mirrors the build playbook B.3 allow-list
ROUTINES: dict[str, tuple[str, list[str]]] = {
    "sp_record_event": ("PROCEDURE", ["bigint", "varchar", "timestamptz", "int", "bigint"]),
    "sp_dismantle": ("PROCEDURE", ["bigint", "jsonb", "timestamptz", "int"]),
    "sp_reinstall": ("PROCEDURE", ["bigint", "bigint", "timestamptz", "int"]),
    "sp_receive_transfer": ("PROCEDURE", ["bigint", "timestamptz", "bigint[]", "bigint[]"]),
    "sp_record_tests": ("PROCEDURE", ["bigint", "timestamptz", "int", "jsonb"]),
    "sp_set_materials": ("PROCEDURE", ["int", "jsonb"]),
    "sp_set_target": ("PROCEDURE", ["varchar", "char(7)", "numeric"]),
    "sp_allocate_certificate": ("PROCEDURE", ["bigint", "int"]),
    "sp_create_unit": ("FUNCTION", ["int", "varchar", "date", "bigint"]),
    "sp_register_model": ("FUNCTION", ["varchar", "varchar", "numeric", "jsonb"]),
    "sp_create_transfer": ("FUNCTION", ["varchar", "int", "timestamptz", "numeric", "jsonb"]),
    "sp_issue_certificate": ("FUNCTION", ["varchar", "varchar", "numeric", "char(7)", "date", "jsonb"]),
    "sp_admin_create_org": ("FUNCTION", ["varchar", "varchar", "varchar", "char(15)"]),
    "sp_admin_create_facility": ("FUNCTION", ["int", "varchar", "char(6)", "numeric"]),
    "sp_admin_create_actor": ("FUNCTION", ["int", "varchar", "varchar", "varchar", "text"]),
}


def call(cur: Any, name: str, *args: Any) -> Any:
    kind, types = ROUTINES[name]          # KeyError for anything outside the allow-list
    placeholders = ", ".join(f"%s::{t}" for t in types[: len(args)])
    if kind == "PROCEDURE":
        cur.execute(f"CALL {name}({placeholders})", args)
        return None
    cur.execute(f"SELECT {name}({placeholders})", args)
    return cur.fetchone()[0]


def set_context(cur: Any, org_id: int, actor_id: int, role: str) -> None:
    """Transaction-local identity read by the routines (the API does the same for each request)."""
    cur.execute("SELECT set_config('rc.org_id', %s, true), set_config('rc.actor_id', %s, true), "
                "set_config('rc.role', %s, true)", (str(org_id), str(actor_id), role))
