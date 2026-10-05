"""The only way the API touches PostgreSQL: one transaction per request, SET LOCAL ROLE, rc.* settings,
allow-listed routines, bound parameters (TRD section 2.1, erratum E1)."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, LiteralString

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.allowlist import ALLOWED_DB_ROLES, ROLE_MAP, ROUTINES
from app.errors import ApiException, map_db_error


@dataclass(frozen=True)
class Claims:
    actor_id: int
    org_id: int
    role: str          # one of ROLE_MAP's keys

    @property
    def db_role(self) -> str:
        return ROLE_MAP[self.role]


def build_statement(routine: str, given: Mapping[str, Any]) -> tuple[sql.Composed, list[Any]]:
    """CALL for procedures, SELECT * FROM for functions; parameters passed by name and bound, never interpolated."""
    spec = ROUTINES[routine]                       # KeyError: anything outside the allow-list is not callable
    types = dict(spec.params)
    unknown = set(given) - set(types)
    if unknown:
        raise TypeError(f"{routine}: unknown parameter(s) {sorted(unknown)}")
    args: list[sql.Composable] = []
    values: list[Any] = []
    for name, sql_type in spec.params:
        if name not in given:
            continue                               # omitted: the routine's default applies
        value = given[name]
        if sql_type == "jsonb" and value is not None:
            value = Jsonb(value)
        args.append(sql.SQL("{} => %s::").format(sql.Identifier(name)) + sql.SQL(sql_type))
        values.append(value)
    call = sql.SQL(", ").join(args)
    if spec.kind == "PROCEDURE":
        return sql.SQL("CALL {}({})").format(sql.Identifier(routine), call), values
    return sql.SQL("SELECT * FROM {}({})").format(sql.Identifier(routine), call), values


class Database:
    def __init__(self, dsn: str, serializable_retries: int = 3) -> None:
        self.pool = AsyncConnectionPool(dsn, min_size=1, max_size=10, open=False,
                                        kwargs={"row_factory": dict_row})
        self.retries = serializable_retries

    async def open(self) -> None:
        await self.pool.open()

    async def close(self) -> None:
        await self.pool.close()

    async def _within(self, claims: Claims | None, db_role: str | None, isolation: str | None,
                      work: Any) -> Any:
        role = claims.db_role if claims else db_role
        if role is None or role not in ALLOWED_DB_ROLES:
            raise ValueError("a request needs claims or one of the fixed database roles")
        attempts = self.retries if isolation == "serializable" else 1
        for attempt in range(1, attempts + 1):
            try:
                async with self.pool.connection() as conn, conn.transaction():
                    if isolation == "serializable":
                        await conn.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
                    await conn.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(role)))
                    if claims:
                        await conn.execute(
                            "SELECT set_config('rc.actor_id', %s, true), set_config('rc.org_id', %s, true), "
                            "set_config('rc.role', %s, true)",
                            [str(claims.actor_id), str(claims.org_id), claims.role])
                    return await work(conn)
            except psycopg.errors.SerializationFailure as exc:
                if attempt == attempts:
                    raise map_db_error(exc) from exc
            except psycopg.Error as exc:
                raise map_db_error(exc) from exc
        raise ApiException(409, "CONFLICT_RETRY", "The request conflicted with another one; please retry")

    async def run(self, claims: Claims | None, routine: str, *, db_role: str | None = None,
                  isolation: Literal["serializable"] | None = None, **params: Any) -> list[dict[str, Any]]:
        """Call one allow-listed routine inside one transaction. Returns the rows (empty for procedures)."""
        statement, values = build_statement(routine, params)
        is_call = ROUTINES[routine].kind == "PROCEDURE"

        async def work(conn: psycopg.AsyncConnection[dict[str, Any]]) -> list[dict[str, Any]]:
            cur = await conn.execute(statement, values)
            return [] if is_call else await cur.fetchall()

        result: list[dict[str, Any]] = await self._within(claims, db_role, isolation, work)
        return result

    async def query(self, claims: Claims | None, query: LiteralString, params: list[Any] | None = None, *,
                    db_role: str | None = None) -> list[dict[str, Any]]:
        """Read through a view in one transaction under the caller's role. `query` must be a literal."""
        async def work(conn: psycopg.AsyncConnection[dict[str, Any]]) -> list[dict[str, Any]]:
            cur = await conn.execute(query, params)
            return await cur.fetchall()

        result: list[dict[str, Any]] = await self._within(claims, db_role, None, work)
        return result
