import os, hmac, hashlib, json, time
from typing import List, Optional
from urllib.parse import parse_qsl

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from supabase import create_client

load_dotenv()

app = FastAPI()


@app.middleware("http")
async def no_cache(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


# ---------- Telegram security check ----------
def get_user_id(x_telegram_init_data: str = Header(default="")) -> int:
    """Checks the data Telegram sent is genuine and returns the real user id."""
    if not x_telegram_init_data:
        raise HTTPException(status_code=401, detail="Open this app from Telegram")

    data = dict(parse_qsl(x_telegram_init_data, keep_blank_values=True))
    received_hash = data.pop("hash", None)
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()

    if not received_hash or not hmac.compare_digest(expected, received_hash):
        raise HTTPException(status_code=401, detail="Invalid Telegram data")

    # reject data older than 24 hours
    if time.time() - int(data.get("auth_date", 0)) > 86400:
        raise HTTPException(status_code=401, detail="Session expired, reopen the app")

    return int(json.loads(data["user"])["id"])


# ---------- data shapes ----------
class ReportSubmission(BaseModel):
    duty_date: str
    shift: str
    duty_start: str
    duty_end: str
    report_location: str
    service_checks: List[dict] = []
    activities: str
    problems: Optional[str] = None
    pending_tasks: Optional[str] = None
    comments: Optional[str] = None
    activities_checklist: Optional[List[dict]] = []


class ProfileUpdate(BaseModel):
    field: str
    value: str


ALLOWED_PROFILE_FIELDS = {"job_title", "work_location", "office"}


def find_employee(telegram_id: int):
    res = supabase.table("employees").select("*").eq("telegram_id", telegram_id).limit(1).execute()
    return res.data[0] if res.data else None


# ---------- endpoints ----------
@app.get("/api/employee/me")
async def get_employee(telegram_id: int = Depends(get_user_id)):
    emp = find_employee(telegram_id)
    if not emp:
        return {"active": False, "role": "employee", "full_name": "Unknown"}
    return emp


@app.get("/api/reports/me")
async def get_my_reports(telegram_id: int = Depends(get_user_id)):
    emp = find_employee(telegram_id)
    if not emp:
        return []
    reports = (
        supabase.table("daily_reports").select("*")
        .eq("employee_id", emp["id"])
        .order("report_date", desc=True)
        .execute()
    )
    return reports.data or []


@app.get("/api/guidelines")
async def get_guidelines(telegram_id: int = Depends(get_user_id)):
    res = (
        supabase.table("it_guidelines").select("*")
        .eq("is_published", True).eq("is_active", True)
        .execute()
    )
    return res.data or []


@app.post("/api/profile/update")
async def update_profile(data: ProfileUpdate, telegram_id: int = Depends(get_user_id)):
    if data.field not in ALLOWED_PROFILE_FIELDS:
        raise HTTPException(status_code=400, detail="This field cannot be changed")
    emp = find_employee(telegram_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    supabase.table("employees").update({data.field: data.value}).eq("id", emp["id"]).execute()
    return {"status": "success"}


@app.post("/api/reports/submit")
async def submit_report(report: ReportSubmission, telegram_id: int = Depends(get_user_id)):
    emp = find_employee(telegram_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    service_summary = "\n".join(
        f"{item['name']}: {item['status']}" for item in report.service_checks
    ) or "None selected"
    activities_text = (
        f"SHIFT: {report.shift}\n\nSERVICE CHECKLIST:\n{service_summary}"
        f"\n\nACTIVITIES:\n{report.activities}"
    )

    response = supabase.table("daily_reports").insert({
        "report_date": report.duty_date,
        "employee_id": emp["id"],
        "duty_start": report.duty_start,
        "duty_end": report.duty_end,
        "shift": report.shift,
        "report_location": report.report_location,
        "activities": activities_text,
        "problems": report.problems,
        "pending_tasks": report.pending_tasks,
        "comments": report.comments,
        "activities_checklist": report.activities_checklist,
        "review_status": "pending",
    }).execute()

    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to save report")
    return {"status": "success", "report_id": response.data[0]["id"]}


DEFAULT_SERVICES = [
    "POS Terminals", "Fiscal Printers", "Barcode Scanners", "Network & Internet",
    "CCTV System", "VPN Connection", "Backup System", "Inventory System",
    "Email & User Access", "UPS & Power", "Attendance System", "Server & Database",
]
DEFAULT_SHIFTS = [
    {"name": "Morning Shift", "start_time": "06:00", "end_time": "15:00", "enabled": True},
    {"name": "Afternoon Shift", "start_time": "15:00", "end_time": "23:00", "enabled": True},
]


def get_setting(key, default):
    res = supabase.table("bot_settings").select("setting_value").eq("setting_key", key).execute()
    return res.data[0]["setting_value"] if res.data else default


@app.get("/api/config")
async def get_config(telegram_id: int = Depends(get_user_id)):
    shifts = get_setting("duty_shifts", {"items": DEFAULT_SHIFTS}).get("items", [])
    services = get_setting("service_checklist", {"items": [{"name": n} for n in DEFAULT_SERVICES]}).get("items", [])
    return {
        "shifts": [s for s in shifts if s.get("enabled", True) and s.get("name", "").lower() != "night shift"],
        "services": [i["name"] for i in services if i.get("enabled", True)],
    }


# Serve the Mini App files (keep this last)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
