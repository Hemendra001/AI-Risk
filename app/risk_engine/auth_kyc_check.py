"""
MODULE 5 of 5 -- Auth & KYC check.

Solves the "false positive" problem: legitimate customers getting hard
declined. This is the module that keeps borderline cases in "step-up
auth" (send an OTP) territory instead of an outright block, and it's
where basic identity-quality signals live.
"""

DISPOSABLE_EMAIL_DOMAINS = {
    "mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com",
}


def score(email: str, contact: str) -> dict:
    risk_score = 0
    reasons = []

    domain = email.split("@")[-1].lower() if "@" in email else ""
    if domain in DISPOSABLE_EMAIL_DOMAINS:
        risk_score += 50
        reasons.append("Email uses a disposable/temporary email domain")

    digits_only = "".join(ch for ch in contact if ch.isdigit())
    if len(digits_only) < 10:
        risk_score += 20
        reasons.append("Phone number looks incomplete or invalid")

    return {"score": min(risk_score, 100), "reason": "; ".join(reasons) if reasons else None}
