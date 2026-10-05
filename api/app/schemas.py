"""Pydantic models; they mirror build playbook B.2 field for field. Sections are added task by task."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, Field


# --- authentication (T3.3) ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int        # seconds


# --- domain types (build playbook B.2) ----------------------------------------------------------------------
Category = Literal["DEVICE", "BOARD", "BATTERY", "STORAGE", "MEMORY", "DISPLAY", "CHIP", "OTHER"]
EventType = Literal["MANUFACTURED", "SOLD", "COLLECTED", "DIAGNOSED", "HARVESTED", "REFURBISHED",
                    "REINSTALLED", "RECYCLED", "DISPOSED"]
Role = Literal["PRODUCER", "COLLECTOR", "TECHNICIAN", "RECYCLER_OPERATOR", "AUDITOR", "ADMIN"]
OrgType = Literal["PRODUCER", "COLLECTOR", "DISMANTLER", "REFURBISHER", "RECYCLER"]
TestResult = Literal["PASS", "DEGRADED", "FAIL"]
Condition = Literal["WORKING", "FAULTY", "SCRAP"]


class MaterialLine(BaseModel):
    material_name: str
    mass_mg: float
    is_critical: bool


class ModelInfo(BaseModel):
    model_id: int
    model_number: str
    category: Category
    mass_g: float
    manufacturer: str
    spec: dict[str, Any]
    materials: list[MaterialLine]


class HolderRef(BaseModel):
    org_id: int
    org_name: str


class ParentRef(BaseModel):
    unit_id: int
    passport_uid: str
    model_number: str


class UnitPassport(BaseModel):
    unit_id: int
    passport_uid: str
    serial_no: str
    manufactured_on: date | None
    model: ModelInfo
    current_state: EventType | None
    state_since: datetime | None
    current_holder: HolderRef | None
    current_parent: ParentRef | None
    chain_verified: bool


# --- requests (T3.4) ----------------------------------------------------------------------------------------
class ModelCreate(BaseModel):
    model_number: str = Field(min_length=1, max_length=60)
    category: Category
    mass_g: float = Field(gt=0)
    spec: dict[str, Any] = Field(default_factory=dict)


class MaterialInput(BaseModel):
    material_id: int
    mass_mg: float = Field(gt=0)


class UnitCreate(BaseModel):
    model_id: int
    serial_no: str = Field(min_length=1, max_length=60)
    manufactured_on: date | None = None
    parent_unit_id: int | None = None


class BulkUnits(BaseModel):
    units: list[UnitCreate] = Field(min_length=1, max_length=5000)


class PartInput(BaseModel):
    model_id: int
    serial_no: str = Field(min_length=1, max_length=60)


class DismantleRequest(BaseModel):
    parts: list[PartInput] = Field(min_length=1)
    occurred_at: AwareDatetime
    facility_id: int


class HarvestRequest(BaseModel):
    occurred_at: AwareDatetime
    facility_id: int


class ReinstallRequest(BaseModel):
    new_parent_unit_id: int
    occurred_at: AwareDatetime
    facility_id: int


class EventCreate(BaseModel):
    event_type: EventType
    occurred_at: AwareDatetime
    facility_id: int
    corrects_event_id: int | None = None


class TestInput(BaseModel):
    test_type: str = Field(min_length=1, max_length=40)
    result: TestResult
    measured_value: float | None = None
    health_score: int | None = Field(default=None, ge=0, le=100)


class TestsRequest(BaseModel):
    occurred_at: AwareDatetime
    facility_id: int
    tests: list[TestInput] = Field(min_length=1)


# --- custody, EPR (T3.5) ------------------------------------------------------------------------------------
class IssueCertificateUnit(BaseModel):
    unit_id: int
    recovered_mass_g: float = Field(gt=0)


class IssueCertificateRequest(BaseModel):
    cert_no: str = Field(min_length=1, max_length=40)       # e.g. "RC-REC-2026-000412"
    category: str = Field(min_length=1, max_length=20)      # CPCB EEE code, free text in v1.0
    quantity_kg: float = Field(gt=0)
    financial_year: str = Field(pattern=r"^[0-9]{4}-[0-9]{2}$")   # "2026-27"
    issued_on: date
    units: list[IssueCertificateUnit]


class TransferItemInput(BaseModel):
    unit_id: int
    declared_condition: Condition


class TransferCreate(BaseModel):
    manifest_no: str = Field(min_length=1, max_length=30)
    to_org_id: int
    shipped_at: AwareDatetime
    total_mass_kg: float = Field(gt=0)
    items: list[TransferItemInput] = Field(min_length=1)


class ReceiveRequest(BaseModel):
    received_at: AwareDatetime
    missing_unit_ids: list[int] = Field(default_factory=list)
    extra_unit_ids: list[int] = Field(default_factory=list)


class AllocateRequest(BaseModel):
    producer_id: int


class TargetRequest(BaseModel):
    category: str = Field(min_length=1, max_length=20)
    financial_year: str = Field(pattern=r"^[0-9]{4}-[0-9]{2}$")
    target_kg: float = Field(gt=0)
