"""
Thin wrapper around Razorpay's official Python SDK.

Uses TEST MODE keys, which are free and never move real money -- see
README.md -> "Getting your free Razorpay test API key" for how to get
your own.
"""

import os
import razorpay


def _client():
    key_id = os.getenv("RAZORPAY_KEY_ID")
    key_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if not key_id or not key_secret:
        raise RuntimeError(
            "Missing Razorpay keys. Copy .env.example to .env and fill in "
            "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (see README.md)."
        )
    return razorpay.Client(auth=(key_id, key_secret))


def create_order(amount_in_paise: int, currency: str = "INR", receipt: str = None):
    """Razorpay wants amounts in the smallest currency unit -- paise, not
    rupees. Rs. 499.00 is amount_in_paise=49900."""
    client = _client()
    return client.order.create({
        "amount": amount_in_paise,
        "currency": currency,
        "payment_capture": 1,
        "receipt": receipt,
    })


def verify_payment_signature(params: dict):
    """Confirms the payment response really came from Razorpay and wasn't
    forged/tampered with. Raises an exception if the signature is invalid."""
    client = _client()
    return client.utility.verify_payment_signature(params)
