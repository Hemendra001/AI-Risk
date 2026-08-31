"""
MODULE 4 of 5 -- Link / graph check.

Solves: fraud rings and money-laundering-style abuse, where one stolen
card or one device is used to fund many "different" accounts. Any single
transaction looks fine in isolation -- the fraud only becomes visible when
you look at how many distinct accounts share the same device or IP.

This is a lightweight stand-in for a real graph database (like Neo4j) --
good enough to demonstrate the concept in a prototype.
"""

from app.database import distinct_users_sharing


def score(device_id: str, ip: str) -> dict:
    shared_users = distinct_users_sharing(device_id, ip, hours=24)

    risk_score = 0
    reason = None

    if shared_users >= 5:
        risk_score = 85
        reason = f"{shared_users} different accounts have used this device/IP in the last 24h"
    elif shared_users >= 2:
        risk_score = 40
        reason = f"{shared_users} different accounts have used this device/IP in the last 24h"

    return {"score": risk_score, "reason": reason}
