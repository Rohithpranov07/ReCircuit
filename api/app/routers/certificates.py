"""EPR certificates and compliance (FR-9). Backing and over-claim rules live in the database; the certificate
is issued at SERIALIZABLE and serialization conflicts are retried by the pipeline."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response

from app.auth import require_roles
from app.db import Claims, Database
from app.errors import ApiException
from app.schemas import AllocateRequest, IssueCertificateRequest, TargetRequest

router = APIRouter(tags=["certificates"])


def _db(request: Request) -> Database:
    db: Database = request.app.state.db
    return db


@router.get("/certificates")
async def list_certificates(request: Request, claims: Claims = Depends(
        require_roles("RECYCLER_OPERATOR", "PRODUCER", "AUDITOR"))) -> list[dict[str, Any]]:
    """Certificates the caller may see (row-level security), with claimed vs backed kg."""
    return await _db(request).query(
        claims,
        """SELECT b.cert_id, b.cert_no, b.recycler_id, r.org_name AS recycler, b.producer_id,
                  p.org_name AS producer, b.category, b.financial_year, b.claimed_kg, b.backed_kg, b.unit_count,
                  c.issued_on
             FROM v_certificate_backing b
             JOIN epr_certificate c ON c.cert_id = b.cert_id
             JOIN organization r ON r.org_id = b.recycler_id
             LEFT JOIN organization p ON p.org_id = b.producer_id
            ORDER BY c.issued_on DESC, b.cert_id DESC LIMIT 500""")


@router.post("/certificates", status_code=201)
async def issue_certificate(body: IssueCertificateRequest, request: Request,
                            claims: Claims = Depends(require_roles("RECYCLER_OPERATOR"))) -> dict[str, int]:
    rows = await _db(request).run(
        claims, "sp_issue_certificate", isolation="serializable", p_cert_no=body.cert_no,
        p_category=body.category, p_quantity_kg=body.quantity_kg, p_fy=body.financial_year,
        p_issued_on=body.issued_on, p_units=[u.model_dump() for u in body.units])
    return {"cert_id": rows[0]["sp_issue_certificate"]}


@router.post("/certificates/{cert_id}/allocate", status_code=204)
async def allocate_certificate(cert_id: int, body: AllocateRequest, request: Request,
                               claims: Claims = Depends(require_roles("RECYCLER_OPERATOR"))) -> Response:
    await _db(request).run(claims, "sp_allocate_certificate", p_cert=cert_id, p_producer=body.producer_id)
    return Response(status_code=204)


def _own_producer(claims: Claims, producer_id: int) -> None:
    if claims.role == "PRODUCER" and claims.org_id != producer_id:
        raise ApiException(403, "FORBIDDEN", "Your role is not allowed to do this")


@router.get("/compliance/{producer_id}")
async def get_compliance(producer_id: int, request: Request,
                         claims: Claims = Depends(require_roles("PRODUCER", "AUDITOR"))) -> list[dict[str, Any]]:
    _own_producer(claims, producer_id)
    return await _db(request).query(
        claims,
        """SELECT producer_id, category, financial_year, target_kg, acquired_kg, pct_of_target
             FROM v_epr_compliance WHERE producer_id = %s ORDER BY financial_year DESC, category""",
        [producer_id])


@router.put("/compliance/{producer_id}", status_code=204)
async def put_target(producer_id: int, body: TargetRequest, request: Request,
                     claims: Claims = Depends(require_roles("PRODUCER"))) -> Response:
    _own_producer(claims, producer_id)
    await _db(request).run(claims, "sp_set_target", p_category=body.category, p_fy=body.financial_year,
                           p_target_kg=body.target_kg)
    return Response(status_code=204)
