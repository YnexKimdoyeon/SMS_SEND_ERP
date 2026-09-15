"""블로그 스크린샷용 더미데이터 생성 스크립트.

실행: python seed_dummy.py
기존 데이터를 모두 지우고 풍성한 샘플 데이터를 채웁니다.
실제 문자는 전혀 발송하지 않습니다 (DB에 기록만 남김).
"""
import random
from datetime import date, datetime, timedelta

from database import engine, SessionLocal, Base
from models import User, Payment, SmsLog, Setting

# 결과 재현성을 위해 시드 고정
random.seed(20260617)

TODAY = date(2026, 6, 17)

# ---- 한국식 이름 풀 ----
SURNAMES = list("김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하")
GIVEN1 = list("민서지예준현우도하시은수영진성호태경동광철주윤재")
GIVEN2 = list("준서연우현진호아윤지율민호석현빈정수아람희찬husband"[:0]) or list("준서연우현진호아윤지율민석빈수람희찬")

MEMOS = [
    "6월 회비", "정기 결제", "월 이용료", "수강료", "관리비",
    "렌탈료", "보증금 잔금", "후원금", "분할 1회차", "분할 2회차",
    "추가 결제", "연회비", "재등록", "정기후원", "월 납입금",
    "", "", "", "",  # 빈 메모도 섞기
]


def random_name(used: set) -> str:
    for _ in range(100):
        name = random.choice(SURNAMES) + random.choice(GIVEN1) + random.choice(GIVEN2)
        if name not in used:
            used.add(name)
            return name
    return random.choice(SURNAMES) + random.choice(GIVEN1) + random.choice(GIVEN2)


def random_phone(used: set) -> str:
    for _ in range(1000):
        phone = "010" + "".join(str(random.randint(0, 9)) for _ in range(8))
        if phone not in used:
            used.add(phone)
            return phone
    return "010" + "".join(str(random.randint(0, 9)) for _ in range(8))


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # 기존 데이터 초기화
    db.query(SmsLog).delete()
    db.query(Payment).delete()
    db.query(User).delete()
    db.commit()

    used_names: set = set()
    used_phones: set = set()

    # ---- 사용자 48명 ----
    users = []
    for _ in range(48):
        created = datetime(2026, 1, 1) + timedelta(days=random.randint(0, 160),
                                                   hours=random.randint(8, 20),
                                                   minutes=random.randint(0, 59))
        u = User(name=random_name(used_names), phone=random_phone(used_phones), created_at=created)
        db.add(u)
        users.append(u)
    db.commit()
    for u in users:
        db.refresh(u)

    amounts = [30000, 50000, 80000, 99000, 100000, 120000, 150000,
               180000, 200000, 250000, 300000, 350000, 450000, 500000]

    # ---- 입금 내역: 4~7월에 걸쳐 생성 (이번 달 6월에 집중) ----
    payments = []

    def add_payments_for_month(year, month, count):
        # 그 달의 일수 계산
        if month == 12:
            next_first = date(year + 1, 1, 1)
        else:
            next_first = date(year, month + 1, 1)
        days_in_month = (next_first - date(year, month, 1)).days
        for _ in range(count):
            day = random.randint(1, days_in_month)
            due = date(year, month, day)
            user = random.choice(users)
            amount = random.choice(amounts)
            memo = random.choice(MEMOS)

            if due < TODAY:
                # 지난 날짜: 대부분 입금 완료
                is_paid = random.random() < 0.85
                sms_sent = True if random.random() < 0.9 else False
            elif due == TODAY:
                is_paid = random.random() < 0.3
                sms_sent = random.random() < 0.7
            else:
                # 미래: 거의 미입금, 일부만 미리 발송
                is_paid = random.random() < 0.1
                sms_sent = random.random() < 0.3

            created = datetime.combine(due, datetime.min.time()) - timedelta(
                days=random.randint(3, 20), hours=-random.randint(8, 18))
            p = Payment(
                user_id=user.id, due_date=due, amount=amount, memo=memo,
                is_paid=is_paid, sms_sent=sms_sent, created_at=created,
            )
            db.add(p)
            payments.append(p)

    add_payments_for_month(2026, 4, 22)
    add_payments_for_month(2026, 5, 30)
    add_payments_for_month(2026, 6, 55)   # 이번 달 풍성하게
    add_payments_for_month(2026, 7, 18)
    db.commit()
    for p in payments:
        db.refresh(p)

    # ---- 문자 발송 이력: sms_sent 된 건들에 대해 로그 생성 ----
    sent_payments = [p for p in payments if p.sms_sent]
    logs = []
    for p in sent_payments:
        user = next(u for u in users if u.id == p.user_id)
        due_str = p.due_date.strftime("%Y년 %m월 %d일")
        msg = f"[입금 안내] {user.name}님, {due_str} 입금 예정일입니다. 금액: {p.amount:,}원"
        if p.memo:
            msg += f" ({p.memo})"

        # 발송 시간: 입금일 며칠 전 오전 9시경
        sent_at = datetime.combine(
            p.due_date - timedelta(days=random.randint(0, 5)),
            datetime.min.time(),
        ) + timedelta(hours=9, minutes=random.randint(0, 5))

        # 95% 성공, 5% 실패
        if random.random() < 0.95:
            status, error = "success", ""
        else:
            status = "fail"
            error = random.choice([
                "수신거부 번호", "잘못된 전화번호 형식", "잔액 부족", "일시적 통신 오류",
            ])

        logs.append(SmsLog(
            payment_id=p.id, user_name=user.name, phone=user.phone,
            message=msg, status=status, error=error, sent_at=sent_at,
        ))

    # 추가로 과거 발송 이력 몇 건 더 (분량 늘리기)
    for _ in range(40):
        u = random.choice(users)
        d = TODAY - timedelta(days=random.randint(1, 90))
        msg = f"[입금 안내] {u.name}님, {d.strftime('%Y년 %m월 %d일')} 입금 예정일입니다. 금액: {random.choice(amounts):,}원"
        sent_at = datetime.combine(d, datetime.min.time()) + timedelta(hours=9, minutes=random.randint(0, 10))
        if random.random() < 0.93:
            status, error = "success", ""
        else:
            status, error = "fail", random.choice(["수신거부 번호", "일시적 통신 오류"])
        logs.append(SmsLog(
            payment_id=None, user_name=u.name, phone=u.phone,
            message=msg, status=status, error=error, sent_at=sent_at,
        ))

    db.add_all(logs)

    # 설정값
    if not db.query(Setting).filter(Setting.key == "send_time").first():
        db.add(Setting(key="send_time", value="09:00"))

    db.commit()

    # ---- 요약 출력 ----
    print("=== 더미데이터 생성 완료 ===")
    print(f"사용자        : {db.query(User).count()}명")
    print(f"입금 내역     : {db.query(Payment).count()}건")
    print(f"  - 입금완료  : {db.query(Payment).filter(Payment.is_paid == True).count()}건")
    print(f"  - 미입금    : {db.query(Payment).filter(Payment.is_paid == False).count()}건")
    print(f"문자 발송이력 : {db.query(SmsLog).count()}건")
    print(f"  - 성공      : {db.query(SmsLog).filter(SmsLog.status == 'success').count()}건")
    print(f"  - 실패      : {db.query(SmsLog).filter(SmsLog.status == 'fail').count()}건")
    db.close()


if __name__ == "__main__":
    main()
