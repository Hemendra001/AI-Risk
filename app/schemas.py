"""
Pydantic models describing what the frontend sends us. FastAPI uses these
to validate incoming requests automatically.
"""

from pydantic import BaseModel


class CheckoutRequest(BaseModel):
    user_id: str
    email: str
    contact: str
    amount: float                          # in rupees, e.g. 499.00
    device_id: str
    is_new_device: bool = False
    billing_country: str = "IN"
    distance_km_from_last_txn: float = 0.0
    demo_ip: str | None = None             # DEMO/TESTING ONLY -- see note in main.py


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    user_id: str
    email: str
    device_id: str
    amount: float
    billing_country: str = "IN"
    overall_score: float = 0.0
