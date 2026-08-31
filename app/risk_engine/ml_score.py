"""
MODULE 1 of 5 -- ML behaviour scoring.

Solves: stolen-card / account-takeover fraud -- transactions that don't
look like how this person normally behaves.

Loads the model trained by ml/train_model.py and scores one transaction.
Returns a 0-100 risk score (higher = riskier) plus a plain-English reason.
"""

import joblib
import json
import pandas as pd

_MODEL = None
_FEATURES = None


def _load():
    """Load the model once and reuse it (loading from disk on every
    request would be slow)."""
    global _MODEL, _FEATURES
    if _MODEL is None:
        _MODEL = joblib.load("ml/model.pkl")
        with open("ml/feature_order.json") as f:
            _FEATURES = json.load(f)
    return _MODEL, _FEATURES


def score(transaction: dict) -> dict:
    model, features = _load()
    # build the feature row as a labelled DataFrame, in the exact column
    # order the model was trained on
    row = pd.DataFrame([[transaction.get(f, 0) for f in features]], columns=features)

    fraud_probability = float(model.predict_proba(row)[0][1])  # P(class == "fraud")
    # cast to plain Python float above -- sklearn returns numpy floats,
    # which FastAPI's default JSON encoder can't serialize on its own
    risk_score = round(fraud_probability * 100, 1)

    reason = None
    if risk_score > 60:
        reason = "Transaction pattern is very different from this user's usual behaviour"
    elif risk_score > 30:
        reason = "Transaction pattern is somewhat unusual for this user"

    return {"score": risk_score, "reason": reason}
