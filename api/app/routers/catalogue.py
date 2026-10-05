"""Part-model catalogue (FR-3): staff read, producers write. Every write is one routine call."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response

from app.allowlist import ROLE_MAP
from app.auth import require_roles
from app.db import Claims, Database
from app.schemas import Category, MaterialInput, ModelCreate

router = APIRouter(tags=["catalogue"])
STAFF = tuple(ROLE_MAP)


def _db(request: Request) -> Database:
    db: Database = request.app.state.db
    return db


@router.get("/models")
async def list_models(request: Request, category: Category | None = None, manufacturer: str | None = None,
                      q: str | None = Query(default=None, max_length=60), limit: int = Query(100, ge=1, le=500),
                      claims: Claims = Depends(require_roles(*STAFF))) -> list[dict[str, Any]]:
    return await _db(request).query(
        claims,
        """SELECT m.model_id, m.model_number, m.category, m.mass_g, m.spec, m.manufacturer_id,
                  o.org_name AS manufacturer
             FROM part_model m JOIN organization o ON o.org_id = m.manufacturer_id
            WHERE (%(category)s::text IS NULL OR m.category = %(category)s)
              AND (%(manufacturer)s::text IS NULL OR o.org_name ILIKE '%%' || %(manufacturer)s || '%%')
              AND (%(q)s::text IS NULL OR m.model_number ILIKE '%%' || %(q)s || '%%')
            ORDER BY o.org_name, m.model_number LIMIT %(limit)s""",
        {"category": category, "manufacturer": manufacturer, "q": q, "limit": limit})


@router.post("/models", status_code=201)
async def create_model(body: ModelCreate, request: Request,
                       claims: Claims = Depends(require_roles("PRODUCER"))) -> dict[str, int]:
    rows = await _db(request).run(claims, "sp_register_model", p_model_number=body.model_number,
                                  p_category=body.category, p_mass_g=body.mass_g, p_spec=body.spec)
    return {"model_id": rows[0]["sp_register_model"]}


@router.put("/models/{model_id}/materials", status_code=204)
async def set_materials(model_id: int, body: list[MaterialInput], request: Request,
                        claims: Claims = Depends(require_roles("PRODUCER"))) -> Response:
    await _db(request).run(claims, "sp_set_materials", p_model=model_id,
                           p_materials=[m.model_dump() for m in body])
    return Response(status_code=204)


@router.get("/materials")
async def list_materials(request: Request,
                         claims: Claims = Depends(require_roles(*STAFF))) -> list[dict[str, Any]]:
    """The tracked-material catalogue, for the model composition editor."""
    return await _db(request).query(
        claims, "SELECT material_id, material_name, is_critical, is_hazardous FROM material ORDER BY material_name")
