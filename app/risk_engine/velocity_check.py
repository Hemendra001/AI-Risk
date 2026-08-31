"""
MODULE 2 of 5 -- Velocity check.

Solves: bot attacks and "card testing" (attackers firing many small
transactions in quick succession to validate stolen card numbers). These
attacks often look harmless amount-wise, but always show up as a spike in
FREQUENCY -- which the ML module alone won't catch.
"""

from app.database import count_recent_transactions

# tune these thresholds to your own risk appetite
MAX_TXNS_PER_MIN = 3
MAX_TXNS_PER_HOUR = 10


def score(user_id: str, device_id: str, ip: str) -> dict:
    txns_last_min = count_recent_transactions(user_id, device_id, ip, seconds=60)
    txns_last_hour = count_recent_transactions(user_id, device_id, ip, seconds=3600)

    risk_score = 0
    reason = None

    if txns_last_min >= MAX_TXNS_PER_MIN:
        risk_score = 90
        reason = f"{txns_last_min} transactions from this user/device in the last minute"
    elif txns_last_hour >= MAX_TXNS_PER_HOUR:
        risk_score = 60
        reason = f"{txns_last_hour} transactions from this user/device in the last hour"
    elif txns_last_hour >= MAX_TXNS_PER_HOUR // 2:
        risk_score = 25
        reason = "Higher than usual transaction frequency"

    return {"score": risk_score, "reason": reason}
