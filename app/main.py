"""
FastAPI app tying everything together.

Flow for a payment:
  1. Frontend calls POST /create-order with the transaction details.
  2. We run all 5 risk modules + the aggregator BEFORE touching Razorpay
     at all.
  3. If the decision is "block", we stop right here -- no Razorpay order
     is ever created, so no money can move.
  4. If the decision is "allow" or "step_up", we create a real Razorpay
     order (test mode) and return it along with the full risk breakdown.
  5. The frontend opens Razorpay Checkout using that order.
  6. On success, the frontend calls POST /verify-payment, we verify the
     signature (proves the payment response really came from Razorpay)
     and save the final record.

Run this from the PROJECT ROOT folder with:
    uvicorn app.main:app --reload
"""

import os
from datetime import datetime

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from app.schemas import CheckoutRequest, VerifyPaymentRequest
from app.risk_engine import ml_score, velocity_check, geo_ip_check, link_graph_check, auth_kyc_check, aggregator
from app.database import (
    save_transaction, user_average_amount, count_user_transactions,
    last_known_location, count_recent_transactions,
)
from app.razorpay_client import create_order, verify_payment_signature

load_dotenv()

app = FastAPI(title="AI Risk Manager -- Razorpay prototype")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def run_risk_checks(req: CheckoutRequest, client_ip: str) -> dict:
    """Runs all 5 modules and returns the combined result. This is the
    single function both /risk-check and /create-order call, so the
    checklist you see in the UI and the decision that actually gates the
    payment are always exactly the same calculation."""

    user_avg = user_average_amount(req.user_id, default=req.amount)

    module_2 = velocity_check.score(req.user_id, req.device_id, client_ip)

    # NOTE on demo_ip: localhost testing has no real public IP, so the geo
    # module can never see a country mismatch or VPN flag during local dev.
    # demo_ip lets you supply a real public IP to test against instead --
    # the lookup itself is still 100% real (hits ip-api.com for real).
    # SECURITY WARNING: this must be removed/ignored in any real deployment
    # -- letting a client claim their own IP would let an attacker simply
    # always claim a clean one. It exists only for local demo purposes.
    ip_for_geo_check = req.demo_ip or client_ip
    module_3 = geo_ip_check.score(ip_for_geo_check, req.billing_country)

    module_4 = link_graph_check.score(req.device_id, client_ip)
    module_5 = auth_kyc_check.score(req.email, req.contact)

    # feed the ML module REAL signals from the other checks instead of
    # hardcoded zeros -- this is what makes it actually reactive
    from app.database import count_recent_transactions, distinct_users_sharing
    txns_last_hour = count_recent_transactions(req.user_id, req.device_id, client_ip, seconds=3600)
    shared_device_count = distinct_users_sharing(req.device_id, client_ip, hours=24)
    is_vpn = 1 if module_3["score"] >= 40 else 0  # geo module already flagged VPN/proxy/mismatch

    module_1 = ml_score.score({
        "amount": req.amount,
        "user_avg_amount": user_avg,
        "amount_ratio": req.amount / user_avg if user_avg else 1,
        "hour": datetime.now().hour,
        "is_new_device": int(req.is_new_device),
        "txns_last_hour": txns_last_hour,
        "distance_km_from_last_txn": req.distance_km_from_last_txn,
        "is_vpn": is_vpn,
        "shared_device_count": shared_device_count,
    })

    result = aggregator.combine({
        "ml_score": module_1,
        "velocity_score": module_2,
        "geo_score": module_3,
        "graph_score": module_4,
        "auth_score": module_5,
    })

    # Log this attempt to history -- BOTH /risk-check previews and real
    # /create-order calls save here. This is what lets velocity and
    # link-graph checks see later attempts, not just completed payments.
    save_transaction(
        user_id=req.user_id, device_id=req.device_id, ip=client_ip, email=req.email,
        amount=req.amount, country=req.billing_country,
        overall_score=result["overall_score"], decision=result["decision"],
    )

    return result


@app.post("/risk-check")
def risk_check(req: CheckoutRequest, request: Request):
    """Runs the 5 checks + overall score WITHOUT creating a payment order.
    Used to show the checklist in the UI before the user hits pay."""
    client_ip = request.client.host
    return run_risk_checks(req, client_ip)


@app.get("/user-history")
def user_history(user_id: str, request: Request, demo_ip: str | None = None):
    """Powers the 'account signals' panel on the very first (intake) page,
    BEFORE the 5-module risk engine runs. Answers two questions at a
    glance:
      1. How many previous transactions does this user_id have on record?
         A large or fast-growing count is itself a soft anomaly signal
         (the same thing the velocity module checks more precisely later).
      2. Has this user's location changed since their last transaction?
         Compares their last stored country to a fresh geo-IP lookup of
         the current request IP.
    This performs a real geo-IP lookup (same module the full risk engine
    uses) but does NOT save a transaction record -- it's a read-only
    preview, so opening the page never affects velocity/history counts.
    """
    client_ip = demo_ip or request.client.host

    previous_count = count_user_transactions(user_id)
    txns_last_hour = count_recent_transactions(user_id, "", client_ip, seconds=3600)
    multiple_anomaly = txns_last_hour >= velocity_check.MAX_TXNS_PER_HOUR // 2

    last_loc = last_known_location(user_id)
    # Same keyed lookup (ipgeolocation.io, falling back to ip-api.com) the
    # full geo_ip_check module uses -- just the raw country code, no scoring.
    current_country = geo_ip_check._lookup_ipgeolocation(client_ip) or \
        geo_ip_check._lookup_ip_api(client_ip).get("countryCode")

    location_changed = bool(
        last_loc and current_country and last_loc["country"] and current_country != last_loc["country"]
    )

    return {
        "previous_transaction_count": previous_count,
        "txns_last_hour": txns_last_hour,
        "multiple_anomaly_flag": multiple_anomaly,
        "last_known_country": last_loc["country"] if last_loc else None,
        "current_country": current_country,
        "location_changed": location_changed,
    }


@app.post("/create-order")
def create_order_endpoint(req: CheckoutRequest, request: Request):
    client_ip = request.client.host
    risk_result = run_risk_checks(req, client_ip)

    if risk_result["decision"] == "block":
        # Hard stop -- we never even call Razorpay, so no order/payment can happen.
        raise HTTPException(status_code=403, detail={
            "message": "Transaction blocked by risk engine",
            "risk": risk_result,
        })

    order = create_order(amount_in_paise=int(req.amount * 100), receipt=f"rcpt_{req.user_id}")

    return {
        "order": order,
        "risk": risk_result,
        "razorpay_key_id": os.getenv("RAZORPAY_KEY_ID"),
    }


@app.post("/verify-payment")
def verify_payment(req: VerifyPaymentRequest):
    params = {
        "razorpay_order_id": req.razorpay_order_id,
        "razorpay_payment_id": req.razorpay_payment_id,
        "razorpay_signature": req.razorpay_signature,
    }
    try:
        verify_payment_signature(params)
    except Exception:
        raise HTTPException(status_code=400, detail="Payment signature verification failed")

    save_transaction(
        user_id=req.user_id, device_id=req.device_id, ip="", email=req.email,
        amount=req.amount, country=req.billing_country,
        overall_score=req.overall_score, decision="paid",
    )
    return {"status": "success"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/dev/reset")
def dev_reset():
    """DEMO/DEV ONLY -- wipes all transaction history so you can start a
    demo from a clean slate (resets velocity + link-graph history).
    Remove this endpoint before any real deployment."""
    import os
    db_path = "data/app.db"
    if os.path.exists(db_path):
        os.remove(db_path)
    return {"status": "reset"}


# Serves frontend/index.html at "/" -- this line must stay LAST so it
# doesn't swallow the API routes above.
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
