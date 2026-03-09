from sqlalchemy import Column, Integer, String, Boolean, Date, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.now)

    payments = relationship("Payment", back_populates="user", cascade="all, delete-orphan")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    due_date = Column(Date, nullable=False)
    amount = Column(Integer, nullable=False)
    memo = Column(String, default="")
    is_paid = Column(Boolean, default=False)
    sms_sent = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User", back_populates="payments")


class SmsLog(Base):
    __tablename__ = "sms_logs"

    id = Column(Integer, primary_key=True, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id", ondelete="SET NULL"), nullable=True)
    user_name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    message = Column(String, nullable=False)
    status = Column(String, nullable=False)  # "success" or "fail"
    error = Column(String, default="")
    sent_at = Column(DateTime, default=datetime.now)

    payment = relationship("Payment")


class Setting(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False)
    value = Column(String, nullable=False)
