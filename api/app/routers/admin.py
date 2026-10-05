"""Administration (FR-2): organisations, facilities and staff. Admin only; every write is an sp_admin_* call."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response

from app.auth import AuthState, auth_state, require_roles
from app.db import Claims, Database
from app.schemas import ActorCreate, ActorPatch, FacilityCreate, OrganizationCreate

router = APIRouter(tags=["admin"])
ADMIN = require_roles("ADMIN")


def _db(request: Request) -> Database:
    db: Database = request.app.state.db
    return db


@router.get("/organizations")
async def list_organizations(request: Request, claims: Claims = Depends(ADMIN)) -> list[dict[str, Any]]:
    return await _db(request).query(
        claims,
        """SELECT o.org_id, o.org_name, o.org_type, o.cpcb_reg_no, o.gstin,
                  COALESCE((SELECT jsonb_agg(jsonb_build_object('facility_id', f.facility_id,
                                   'facility_name', f.facility_name, 'pincode', f.pincode,
                                   'authorised_capacity_tpa', f.authorised_capacity_tpa) ORDER BY f.facility_id)
                              FROM facility f WHERE f.org_id = o.org_id), '[]'::jsonb) AS facilities
             FROM organization o ORDER BY o.org_id""")


@router.post("/organizations", status_code=201)
async def create_organization(body: OrganizationCreate, request: Request,
                              claims: Claims = Depends(ADMIN)) -> dict[str, int]:
    rows = await _db(request).run(claims, "sp_admin_create_org", p_name=body.org_name, p_type=body.org_type,
                                  p_cpcb=body.cpcb_reg_no, p_gstin=body.gstin)
    return {"org_id": rows[0]["sp_admin_create_org"]}


@router.post("/organizations/{org_id}/facilities", status_code=201)
async def create_facility(org_id: int, body: FacilityCreate, request: Request,
                          claims: Claims = Depends(ADMIN)) -> dict[str, int]:
    rows = await _db(request).run(claims, "sp_admin_create_facility", p_org=org_id, p_name=body.facility_name,
                                  p_pincode=body.pincode, p_capacity=body.authorised_capacity_tpa)
    return {"facility_id": rows[0]["sp_admin_create_facility"]}


@router.get("/actors")
async def list_actors(request: Request, claims: Claims = Depends(ADMIN)) -> list[dict[str, Any]]:
    return await _db(request).query(
        claims,
        """SELECT a.actor_id, a.full_name, a.role, a.email, a.is_active, a.facility_id, f.facility_name, f.org_id
             FROM actor a JOIN facility f ON f.facility_id = a.facility_id ORDER BY a.actor_id""")


@router.post("/actors", status_code=201)
async def create_actor(body: ActorCreate, request: Request, claims: Claims = Depends(ADMIN),
                       state: AuthState = Depends(auth_state)) -> dict[str, int]:
    rows = await _db(request).run(claims, "sp_admin_create_actor", p_facility=body.facility_id,
                                  p_name=body.full_name, p_role=body.role, p_email=body.email,
                                  p_password_hash=state.hash_password(body.password))   # the password stays here
    return {"actor_id": rows[0]["sp_admin_create_actor"]}


@router.patch("/actors/{actor_id}", status_code=204)
async def patch_actor(actor_id: int, body: ActorPatch, request: Request,
                      claims: Claims = Depends(ADMIN)) -> Response:
    await _db(request).run(claims, "sp_admin_set_actor_active", p_actor=actor_id, p_active=body.is_active)
    return Response(status_code=204)
