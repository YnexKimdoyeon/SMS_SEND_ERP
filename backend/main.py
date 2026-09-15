import secrets
import hashlib
import time
from collections import defaultdict
from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field, field_validator
from datetime import date, datetime, timedelta
from typing import Optional
import requests as http_requests
import os
import io
import re
import jwt
from dotenv import load_dotenv

from database import engine, get_db, Base
from models import User, Payment, SmsLog, Setting

load_dotenv()

Base.metadata.create_all(bind=engine)


# ==========================================
# 보안 설정 검증 - 시작 시 체크
# ==========================================

JWT_SECRET = os.getenv("JWT_SECRET_KEY", "")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 12  # 24h → 12h로 단축
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

if not JWT_SECRET or len(JWT_SECRET) < 32:
    raise RuntimeError(
        "[보안 오류] JWT_SECRET_KEY가 설정되지 않았거나 32자 미만입니다. "
        ".env 파일에 최소 32자 이상의 랜덤 문자열을 설정하세요."
    )

if not ADMIN_PASSWORD or len(ADMIN_PASSWORD) < 10:
    raise RuntimeError(
        "[보안 오류] ADMIN_PASSWORD가 설정되지 않았거나 10자 미만입니다. "
        ".env 파일에 강력한 비밀번호를 설정하세요."
    )

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "https://ynex3.mycafe24.com").split(",")
    if origin.strip()
]


# ==========================================
# FastAPI 앱 생성 (Swagger 문서 비활성화)
# ==========================================

app = FastAPI(
    title="입금 알림 문자 발송 시스템",
    docs_url=None,      # /docs 비활성화
    redoc_url=None,     # /redoc 비활성화
    openapi_url=None,   # /openapi.json 비활성화
)


# ==========================================
# 보안 미들웨어
# ==========================================

# 허용된 호스트만 접근 가능
ALLOWED_HOSTS = [
    h.strip()
    for h in os.getenv("ALLOWED_HOSTS", "ynex3.mycafe24.com,localhost").split(",")
    if h.strip()
]
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

# CORS 최소 권한
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# 보안 헤더 미들웨어
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # 민감한 서버 정보 숨기기
    if "server" in response.headers:
        del response.headers["server"]
    return response


# ==========================================
# 로그인 Rate Limiting (IP 기반)
# ==========================================

class LoginRateLimiter:
    """IP별 로그인 시도 제한 - 5회 실패 시 5분 차단"""

    def __init__(self, max_attempts: int = 5, lockout_seconds: int = 300):
        self.max_attempts = max_attempts
        self.lockout_seconds = lockout_seconds
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._locked_until: dict[str, float] = {}

    def _clean_old(self, ip: str):
        now = time.time()
        self._attempts[ip] = [
            t for t in self._attempts[ip]
            if now - t < self.lockout_seconds
        ]

    def is_locked(self, ip: str) -> bool:
        until = self._locked_until.get(ip, 0)
        if time.time() < until:
            return True
        if until > 0:
            del self._locked_until[ip]
            self._attempts[ip] = []
        return False

    def record_failure(self, ip: str):
        self._clean_old(ip)
        self._attempts[ip].append(time.time())
        if len(self._attempts[ip]) >= self.max_attempts:
            self._locked_until[ip] = time.time() + self.lockout_seconds

    def record_success(self, ip: str):
        self._attempts.pop(ip, None)
        self._locked_until.pop(ip, None)

    def remaining_lockout(self, ip: str) -> int:
        until = self._locked_until.get(ip, 0)
        remaining = until - time.time()
        return max(0, int(remaining))


login_limiter = LoginRateLimiter()


# ==========================================
# Auth
# ==========================================

security = HTTPBearer()


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def create_token() -> str:
    payload = {
        "sub": "admin",
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": datetime.utcnow(),
        "jti": secrets.token_hex(16),  # 토큰 고유 ID
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="토큰이 만료되었습니다. 다시 로그인하세요.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")


def _constant_time_compare(a: str, b: str) -> bool:
    """타이밍 공격 방지용 비교"""
    return secrets.compare_digest(a.encode(), b.encode())


class LoginRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)


@app.post("/api/auth/login")
def login(data: LoginRequest, request: Request):
    ip = _get_client_ip(request)

    if login_limiter.is_locked(ip):
        remaining = login_limiter.remaining_lockout(ip)
        raise HTTPException(
            status_code=429,
            detail=f"너무 많은 로그인 시도입니다. {remaining}초 후에 다시 시도하세요.",
        )

    if not _constant_time_compare(data.password, ADMIN_PASSWORD):
        login_limiter.record_failure(ip)
        # 의도적으로 모호한 에러 메시지
        raise HTTPException(status_code=401, detail="인증에 실패했습니다.")

    login_limiter.record_success(ip)
    token = create_token()
    return {"token": token, "message": "로그인 성공"}


@app.get("/api/auth/verify")
def verify_auth(user: str = Depends(verify_token)):
    return {"valid": True}


# ==========================================
# Schemas (입력 검증 강화)
# ==========================================

PHONE_REGEX = re.compile(r"^01[016789]\d{7,8}$")


class UserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    phone: str = Field(..., min_length=10, max_length=11)

    @field_validator("name")
    @classmethod
    def sanitize_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("이름을 입력하세요")
        # HTML/스크립트 태그 제거
        if re.search(r"[<>&\"']", v):
            raise ValueError("이름에 특수문자를 사용할 수 없습니다")
        return v

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        v = v.strip().replace("-", "").replace(" ", "")
        if not PHONE_REGEX.match(v):
            raise ValueError("올바른 전화번호 형식이 아닙니다 (예: 01012345678)")
        return v


class UserResponse(BaseModel):
    id: int
    name: str
    phone: str
    created_at: datetime

    class Config:
        from_attributes = True


class PaymentCreate(BaseModel):
    user_id: int = Field(..., gt=0)
    due_date: date
    amount: int = Field(..., gt=0, le=100_000_000)  # 최대 1억
    memo: str = Field("", max_length=200)

    @field_validator("memo")
    @classmethod
    def sanitize_memo(cls, v: str) -> str:
        v = v.strip()
        if re.search(r"[<>]", v):
            raise ValueError("메모에 < > 문자를 사용할 수 없습니다")
        return v


class PaymentUpdate(BaseModel):
    is_paid: Optional[bool] = None
    due_date: Optional[date] = None
    amount: Optional[int] = Field(None, gt=0, le=100_000_000)
    memo: Optional[str] = Field(None, max_length=200)


class PaymentResponse(BaseModel):
    id: int
    user_id: int
    due_date: date
    amount: int
    memo: str
    is_paid: bool
    sms_sent: bool
    created_at: datetime
    user: UserResponse

    class Config:
        from_attributes = True


class SMSSend(BaseModel):
    payment_id: int = Field(..., gt=0)
    message: Optional[str] = Field(None, max_length=2000)


# ==========================================
# Helper: SMS 발송 + 로그 기록
# ==========================================

def _send_sms_and_log(payment: Payment, msg: str, db: Session) -> bool:
    """문자 발송 후 로그 기록. 성공 시 True 반환."""
    api_key = os.getenv("ALIGO_API_KEY")
    user_id_env = os.getenv("ALIGO_USER_ID")
    sender = os.getenv("ALIGO_SENDER")

    if not all([api_key, user_id_env, sender]):
        db.add(SmsLog(
            payment_id=payment.id, user_name=payment.user.name,
            phone=payment.user.phone, message=msg,
            status="fail", error="알리고 API 설정 없음",
        ))
        db.commit()
        return False

    try:
        response = http_requests.post(
            "https://apis.aligo.in/send/",
            data={
                "key": api_key,
                "user_id": user_id_env,
                "sender": sender,
                "receiver": payment.user.phone,
                "msg": msg,
                "msg_type": "LMS" if len(msg.encode("utf-8")) > 90 else "SMS",
                "title": "입금 안내" if len(msg.encode("utf-8")) > 90 else "",
            },
            timeout=10,  # 타임아웃 설정
        )
        result = response.json()

        if result.get("result_code") == "1":
            payment.sms_sent = True
            db.add(SmsLog(
                payment_id=payment.id, user_name=payment.user.name,
                phone=payment.user.phone, message=msg, status="success",
            ))
            db.commit()
            return True
        else:
            error_msg = result.get("message", "알 수 없는 오류")
            db.add(SmsLog(
                payment_id=payment.id, user_name=payment.user.name,
                phone=payment.user.phone, message=msg,
                status="fail", error=error_msg,
            ))
            db.commit()
            return False
    except http_requests.RequestException as e:
        db.add(SmsLog(
            payment_id=payment.id, user_name=payment.user.name,
            phone=payment.user.phone, message=msg,
            status="fail", error=str(e),
        ))
        db.commit()
        return False


# ==========================================
# User Endpoints
# ==========================================

@app.get("/api/users", response_model=list[UserResponse])
def get_users(db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    return db.query(User).order_by(User.name).all()


@app.post("/api/users", response_model=UserResponse)
def create_user(user: UserCreate, db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    db_user = User(name=user.name, phone=user.phone)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@app.put("/api/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, user: UserCreate, db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    db_user.name = user.name
    db_user.phone = user.phone
    db.commit()
    db.refresh(db_user)
    return db_user


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    db.delete(db_user)
    db.commit()
    return {"message": "삭제 완료"}


# ==========================================
# Payment Endpoints
# ==========================================

@app.get("/api/payments", response_model=list[PaymentResponse])
def get_payments(
    year: Optional[int] = None,
    month: Optional[int] = None,
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _user: str = Depends(verify_token),
):
    query = db.query(Payment)
    if user_id:
        query = query.filter(Payment.user_id == user_id)
    if year and month:
        if not (2000 <= year <= 2100 and 1 <= month <= 12):
            raise HTTPException(status_code=400, detail="올바른 년/월을 입력하세요")
        start = date(year, month, 1)
        if month == 12:
            end = date(year + 1, 1, 1)
        else:
            end = date(year, month + 1, 1)
        query = query.filter(Payment.due_date >= start, Payment.due_date < end)
    return query.order_by(Payment.due_date).all()


@app.post("/api/payments", response_model=PaymentResponse)
def create_payment(payment: PaymentCreate, db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    user = db.query(User).filter(User.id == payment.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    db_payment = Payment(
        user_id=payment.user_id,
        due_date=payment.due_date,
        amount=payment.amount,
        memo=payment.memo,
    )
    db.add(db_payment)
    db.commit()
    db.refresh(db_payment)
    return db_payment


@app.put("/api/payments/{payment_id}", response_model=PaymentResponse)
def update_payment(payment_id: int, payment: PaymentUpdate, db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    db_payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not db_payment:
        raise HTTPException(status_code=404, detail="입금 정보를 찾을 수 없습니다")
    if payment.is_paid is not None:
        db_payment.is_paid = payment.is_paid
    if payment.due_date is not None:
        db_payment.due_date = payment.due_date
    if payment.amount is not None:
        db_payment.amount = payment.amount
    if payment.memo is not None:
        db_payment.memo = payment.memo
    db.commit()
    db.refresh(db_payment)
    return db_payment


@app.delete("/api/payments/{payment_id}")
def delete_payment(payment_id: int, db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    db_payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not db_payment:
        raise HTTPException(status_code=404, detail="입금 정보를 찾을 수 없습니다")
    db.delete(db_payment)
    db.commit()
    return {"message": "삭제 완료"}


# ==========================================
# SMS Endpoints
# ==========================================

@app.post("/api/sms/send")
def send_sms(data: SMSSend, db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    payment = db.query(Payment).filter(Payment.id == data.payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="입금 정보를 찾을 수 없습니다")

    if not data.message:
        msg = (
            f"[입금 안내] {payment.user.name}님, "
            f"{payment.due_date.strftime('%Y년 %m월 %d일')} "
            f"입금 예정일입니다. 금액: {payment.amount:,}원"
        )
        if payment.memo:
            msg += f" ({payment.memo})"
    else:
        msg = data.message

    success = _send_sms_and_log(payment, msg, db)
    if success:
        return {"message": "문자 발송 완료"}
    else:
        raise HTTPException(status_code=400, detail="문자 발송 실패")


@app.post("/api/sms/send-bulk")
def send_bulk_sms(db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    payments = (
        db.query(Payment)
        .filter(Payment.is_paid == False, Payment.sms_sent == False)
        .all()
    )
    if not payments:
        return {"message": "발송할 대상이 없습니다", "sent": 0}

    sent_count = 0
    for payment in payments:
        msg = (
            f"[입금 안내] {payment.user.name}님, "
            f"{payment.due_date.strftime('%Y년 %m월 %d일')} "
            f"입금 예정일입니다. 금액: {payment.amount:,}원"
        )
        if payment.memo:
            msg += f" ({payment.memo})"
        if _send_sms_and_log(payment, msg, db):
            sent_count += 1

    return {"message": f"{sent_count}건 발송 완료", "sent": sent_count}


# ==========================================
# SMS 발송 이력
# ==========================================

@app.get("/api/sms/logs")
def get_sms_logs(
    page: int = 1,
    size: int = 50,
    db: Session = Depends(get_db),
    _user: str = Depends(verify_token),
):
    if page < 1:
        page = 1
    if size > 100:
        size = 100  # 최대 페이지 크기 제한

    total = db.query(func.count(SmsLog.id)).scalar()
    logs = (
        db.query(SmsLog)
        .order_by(SmsLog.sent_at.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "size": size,
        "logs": [
            {
                "id": log.id,
                "user_name": log.user_name,
                "phone": log.phone,
                "message": log.message,
                "status": log.status,
                "error": log.error,
                "sent_at": log.sent_at.isoformat() if log.sent_at else None,
            }
            for log in logs
        ],
    }


# ==========================================
# 대시보드
# ==========================================

@app.get("/api/dashboard")
def get_dashboard(
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
    _user: str = Depends(verify_token),
):
    if not year or not month:
        today = date.today()
        year, month = today.year, today.month

    if not (2000 <= year <= 2100 and 1 <= month <= 12):
        raise HTTPException(status_code=400, detail="올바른 년/월을 입력하세요")

    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)

    payments = db.query(Payment).filter(
        Payment.due_date >= start, Payment.due_date < end
    ).all()

    total_count = len(payments)
    total_amount = sum(p.amount for p in payments)
    paid_count = sum(1 for p in payments if p.is_paid)
    paid_amount = sum(p.amount for p in payments if p.is_paid)
    unpaid_count = total_count - paid_count
    unpaid_amount = total_amount - paid_amount
    sms_sent_count = sum(1 for p in payments if p.sms_sent)

    today = date.today()
    today_payments = [p for p in payments if p.due_date == today and not p.is_paid]
    today_count = len(today_payments)
    today_amount = sum(p.amount for p in today_payments)

    user_count = db.query(func.count(User.id)).scalar()

    recent_logs = (
        db.query(SmsLog)
        .order_by(SmsLog.sent_at.desc())
        .limit(5)
        .all()
    )

    return {
        "year": year,
        "month": month,
        "total_count": total_count,
        "total_amount": total_amount,
        "paid_count": paid_count,
        "paid_amount": paid_amount,
        "unpaid_count": unpaid_count,
        "unpaid_amount": unpaid_amount,
        "sms_sent_count": sms_sent_count,
        "today_count": today_count,
        "today_amount": today_amount,
        "user_count": user_count,
        "recent_logs": [
            {
                "user_name": log.user_name,
                "status": log.status,
                "sent_at": log.sent_at.isoformat() if log.sent_at else None,
            }
            for log in recent_logs
        ],
    }


# ==========================================
# 엑셀 다운로드 (토큰을 헤더로 검증)
# ==========================================

@app.get("/api/export/excel")
def export_excel(
    year: Optional[int] = None,
    month: Optional[int] = None,
    token: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # 엑셀 다운로드는 <a> 태그로 호출되므로 쿼리 파라미터로 토큰 검증
    if not token:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")

    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    if not year or not month:
        today = date.today()
        year, month = today.year, today.month

    if not (2000 <= year <= 2100 and 1 <= month <= 12):
        raise HTTPException(status_code=400, detail="올바른 년/월을 입력하세요")

    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)

    payments = (
        db.query(Payment)
        .filter(Payment.due_date >= start, Payment.due_date < end)
        .order_by(Payment.due_date)
        .all()
    )

    wb = Workbook()

    # --- 입금 내역 시트 ---
    ws = wb.active
    ws.title = f"{year}년 {month}월 입금내역"

    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    paid_fill = PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid")
    unpaid_fill = PatternFill(start_color="FCE4EC", end_color="FCE4EC", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )

    headers = ["번호", "이름", "전화번호", "입금일", "금액", "메모", "입금여부", "문자발송"]
    col_widths = [6, 12, 16, 14, 14, 20, 10, 10]

    for i, (h, w) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=i, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border
        ws.column_dimensions[chr(64 + i)].width = w

    for idx, p in enumerate(payments, 1):
        row = idx + 1
        values = [
            idx,
            p.user.name,
            p.user.phone,
            p.due_date.strftime("%Y-%m-%d"),
            p.amount,
            p.memo,
            "입금완료" if p.is_paid else "미입금",
            "발송됨" if p.sms_sent else "미발송",
        ]
        fill = paid_fill if p.is_paid else unpaid_fill
        for col, val in enumerate(values, 1):
            cell = ws.cell(row=row, column=col, value=val)
            cell.border = thin_border
            cell.fill = fill
            if col == 5:
                cell.number_format = "#,##0"
                cell.alignment = Alignment(horizontal="right")
            elif col in (1, 7, 8):
                cell.alignment = Alignment(horizontal="center")

    total_row = len(payments) + 2
    ws.cell(row=total_row, column=4, value="합계").font = Font(bold=True)
    ws.cell(row=total_row, column=5, value=sum(p.amount for p in payments)).font = Font(bold=True)
    ws.cell(row=total_row, column=5).number_format = "#,##0"

    paid_total_row = total_row + 1
    ws.cell(row=paid_total_row, column=4, value="입금완료").font = Font(bold=True, color="2E7D32")
    ws.cell(row=paid_total_row, column=5, value=sum(p.amount for p in payments if p.is_paid)).font = Font(bold=True, color="2E7D32")
    ws.cell(row=paid_total_row, column=5).number_format = "#,##0"

    unpaid_total_row = total_row + 2
    ws.cell(row=unpaid_total_row, column=4, value="미입금").font = Font(bold=True, color="C62828")
    ws.cell(row=unpaid_total_row, column=5, value=sum(p.amount for p in payments if not p.is_paid)).font = Font(bold=True, color="C62828")
    ws.cell(row=unpaid_total_row, column=5).number_format = "#,##0"

    # --- 문자 발송 이력 시트 ---
    ws2 = wb.create_sheet(title="문자 발송 이력")
    sms_headers = ["번호", "이름", "전화번호", "발송내용", "상태", "발송시간", "오류"]
    sms_widths = [6, 12, 16, 40, 10, 20, 30]

    for i, (h, w) in enumerate(zip(sms_headers, sms_widths), 1):
        cell = ws2.cell(row=1, column=i, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border
        ws2.column_dimensions[chr(64 + i)].width = w

    logs = db.query(SmsLog).order_by(SmsLog.sent_at.desc()).limit(500).all()
    for idx, log in enumerate(logs, 1):
        row = idx + 1
        values = [
            idx,
            log.user_name,
            log.phone,
            log.message,
            "성공" if log.status == "success" else "실패",
            log.sent_at.strftime("%Y-%m-%d %H:%M") if log.sent_at else "",
            log.error or "",
        ]
        success_fill = PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid")
        fail_fill = PatternFill(start_color="FCE4EC", end_color="FCE4EC", fill_type="solid")
        fill = success_fill if log.status == "success" else fail_fill
        for col, val in enumerate(values, 1):
            cell = ws2.cell(row=row, column=col, value=val)
            cell.border = thin_border
            if col in (1, 5):
                cell.alignment = Alignment(horizontal="center")
            if col == 5:
                cell.fill = fill

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"payment_{year}_{month:02d}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ==========================================
# 설정 API
# ==========================================

@app.get("/api/settings/send-time")
def get_send_time(db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    setting = db.query(Setting).filter(Setting.key == "send_time").first()
    return {"send_time": setting.value if setting else "09:00"}


@app.put("/api/settings/send-time")
def update_send_time(data: dict, db: Session = Depends(get_db), _user: str = Depends(verify_token)):
    time_str = data.get("send_time", "09:00")
    try:
        h, m = map(int, time_str.split(":"))
        if not (0 <= h <= 23 and 0 <= m <= 59):
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=400, detail="올바른 시간 형식이 아닙니다 (HH:MM)")

    setting = db.query(Setting).filter(Setting.key == "send_time").first()
    if setting:
        setting.value = time_str
    else:
        db.add(Setting(key="send_time", value=time_str))
    db.commit()

    reschedule_job(h, m)
    return {"message": f"발송 시간이 {time_str}으로 설정되었습니다", "send_time": time_str}


# ==========================================
# 헬스체크 (인증 불필요 - 모니터링용)
# ==========================================

@app.get("/api/health")
def health_check():
    return {"status": "ok"}


# ==========================================
# 스케줄러
# ==========================================

from apscheduler.schedulers.background import BackgroundScheduler


def auto_send_daily():
    db = next(get_db())
    try:
        today = date.today()
        payments = (
            db.query(Payment)
            .filter(Payment.due_date == today, Payment.is_paid == False, Payment.sms_sent == False)
            .all()
        )
        if not payments:
            return

        for payment in payments:
            msg = (
                f"[입금 안내] {payment.user.name}님, "
                f"오늘({today.strftime('%Y.%m.%d')}) 입금 예정일입니다. "
                f"금액: {payment.amount:,}원"
            )
            if payment.memo:
                msg += f" ({payment.memo})"
            _send_sms_and_log(payment, msg, db)
    finally:
        db.close()


scheduler = BackgroundScheduler()


def reschedule_job(hour: int, minute: int):
    if scheduler.get_job("daily_sms"):
        scheduler.remove_job("daily_sms")
    scheduler.add_job(auto_send_daily, "cron", hour=hour, minute=minute, id="daily_sms")


def init_scheduler():
    db = next(get_db())
    try:
        setting = db.query(Setting).filter(Setting.key == "send_time").first()
        time_str = setting.value if setting else "09:00"
        h, m = map(int, time_str.split(":"))
        reschedule_job(h, m)
    finally:
        db.close()
    scheduler.start()


init_scheduler()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000)
