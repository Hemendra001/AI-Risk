# AI Risk Manager -- Razorpay payment prototype

A working prototype of a **pre-transaction risk scoring system**: before any
payment is allowed to reach Razorpay, 5 independent checks run and produce
an overall risk score (0-100), which decides whether the transaction is
**allowed**, sent to **step-up authentication** (OTP), or **blocked outright**.

```
Online transaction
        |
   -----+-----+-----+-----+-----
   |     |     |     |         |
ML score Velocity Geo/IP Link graph Auth/KYC
   |     |     |     |         |
   -----+-----+-----+-----+-----
        |
 Risk score aggregator (weighted, 0-100)
        |
  ------+------+------
  |            |      |
 Allow     Step-up   Block
(0-30)     (31-70)  (71-100)
```

Only "allow" and "step-up" ever reach the real Razorpay order creation step.
A "block" decision stops the flow before Razorpay is even called -- no
order, no payment possible.

---

## 1. Getting your free Razorpay test API key

Razorpay gives every account **free test-mode keys** -- no KYC, no business
verification, no money involved. This is exactly what you should use for a
prototype/buildathon project.

1. Go to https://dashboard.razorpay.com/signup and create an account.
2. Once logged in, make sure the toggle in the top-left/top-right of the
   dashboard says **"Test Mode"** (not "Live Mode").
3. Go to **Settings -> API Keys** (left sidebar).
4. Click **"Generate Test Key"**.
5. Copy the **Key Id** (starts with `rzp_test_...`) and **Key Secret**.
6. In this project folder, copy `.env.example` to `.env` and paste them in:

```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_here
```

**Never commit `.env` or share your Key Secret with anyone** -- treat it
like a password. `.gitignore` already excludes it.

Test mode uses Razorpay's fake card numbers (e.g. `4111 1111 1111 1111`,
any future expiry, any CVV) -- see Razorpay's test card docs on the
dashboard. No real money ever moves.

---

## 2. Running it

```bash
cd razorpay-ai-risk-manager
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env              # then edit .env with your real keys

uvicorn app.main:app --reload
```

Open **http://127.0.0.1:8000** in your browser. Fill in the form, click
**"Run risk checks"** to see the 5-part checklist and overall score, then
**"Pay with Razorpay"** to open the real (test-mode) Razorpay checkout.

The ML model (`ml/model.pkl`) is already trained on synthetic data and
included in this zip, so it works immediately -- you don't have to train
anything before your first run.

---

## 3. The 5 checks, and what real problem each one solves

| # | Module | File | Problem it solves |
|---|--------|------|--------------------|
| 1 | ML behaviour score | `app/risk_engine/ml_score.py` | Stolen card / account takeover -- transaction doesn't match the user's usual pattern |
| 2 | Velocity check | `app/risk_engine/velocity_check.py` | Bots and "card testing" -- many transactions fired in a short time |
| 3 | Geo & IP check | `app/risk_engine/geo_ip_check.py` | Cross-border fraud, VPN/proxy abuse, billing/IP country mismatch |
| 4 | Link/graph check | `app/risk_engine/link_graph_check.py` | Fraud rings -- one device/IP funding many "different" accounts |
| 5 | Auth & KYC check | `app/risk_engine/auth_kyc_check.py` | False positives -- routes borderline cases to OTP instead of hard-blocking good customers |

Each module returns a `{"score": 0-100, "reason": "..."}` dict.
`app/risk_engine/aggregator.py` combines all 5 into one weighted overall
score and a final decision (`allow` / `step_up` / `block`).

You can call `POST /risk-check` directly (see `app/main.py`) to get just
the checklist without creating a payment -- useful for testing the engine
on its own.

---

## 4. The ML model -- synthetic data now, real data later

**Right now:** `ml/generate_synthetic_data.py` creates 8,000 fake but
realistic-looking transactions with a `is_fraud` label, and
`ml/train_model.py` trains a `RandomForestClassifier` on them. This is
what powers Module 1 (ML behaviour score).

Note: the reported ROC-AUC on the synthetic test set is close to 1.0 --
that's because synthetic fraud patterns are deliberately clean and
separable, not because the model has "solved" fraud. Real transaction
data will be much messier and the model will need real tuning.

**Switching to real data once you have it:**

1. Export your real transaction history into `data/transactions.csv`.
   Each row needs a known fraud/chargeback outcome, using **exactly
   these column names**:

   ```
   amount, user_avg_amount, amount_ratio, hour, is_new_device,
   txns_last_hour, distance_km_from_last_txn, is_vpn,
   shared_device_count, is_fraud
   ```

   - `is_fraud` = 1 if that transaction was later confirmed fraud/charged
     back, 0 otherwise.
   - If you don't have a real value for a column yet (e.g. `is_vpn`),
     it's fine to fill it with 0 -- just don't leave it blank/NaN.

2. Re-run training:
   ```bash
   python ml/train_model.py
   ```
   This overwrites `ml/model.pkl`. Nothing else in the app needs to change
   -- `ml_score.py` always loads whatever's in that file.

3. As you accumulate more real outcomes, re-run step 2 periodically
   (weekly/monthly) so the model keeps improving. This retraining loop is
   normally how production fraud models are kept up to date.

---

## 5. Tuning the decision thresholds

In `app/risk_engine/aggregator.py`:

```python
WEIGHTS = {
    "ml_score": 0.35,
    "velocity_score": 0.20,
    "geo_score": 0.15,
    "graph_score": 0.15,
    "auth_score": 0.15,
}
```

and the score bands (`<=30` allow, `<=70` step_up, else block) are both
plain numbers you can edit directly -- no ML retraining needed to change
how strict the system is.

---

## 6. Folder structure

```
razorpay-ai-risk-manager/
├── app/
│   ├── main.py               FastAPI app + the /risk-check, /create-order,
│   │                         /verify-payment endpoints
│   ├── database.py           SQLite helper (transaction history)
│   ├── schemas.py            Request/response models
│   ├── razorpay_client.py    Razorpay SDK wrapper
│   └── risk_engine/
│       ├── ml_score.py           Module 1
│       ├── velocity_check.py     Module 2
│       ├── geo_ip_check.py       Module 3
│       ├── link_graph_check.py   Module 4
│       ├── auth_kyc_check.py     Module 5
│       └── aggregator.py         Combines all 5 into one score
├── ml/
│   ├── generate_synthetic_data.py
│   ├── train_model.py
│   ├── model.pkl              (pre-trained, included)
│   └── feature_order.json
├── frontend/
│   └── index.html             Checkout page + risk checklist UI
├── data/
│   └── transactions.csv       Synthetic training data (pre-generated)
├── requirements.txt
├── .env.example
└── README.md
```

---

## 7. Honest limitations (worth saying out loud in your buildathon pitch)

- This is a **prototype scoring system**, not a production fraud engine --
  it's meant to demonstrate the architecture and reasoning, not to be
  deployed as-is against real payments.
- The ML model is trained on **synthetic** data. It illustrates the
  approach; a real model needs real, messy, labelled transaction history
  and ongoing retraining.
- The "device fingerprint" in the demo frontend is a simple random ID
  saved in `localStorage` -- a real product would use a proper
  fingerprinting library.
- IP geolocation uses a free, rate-limited public API (`ip-api.com`) --
  fine for a demo, not for production volume.
