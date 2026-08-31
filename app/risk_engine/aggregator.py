"""
Combines all five module scores into ONE overall risk score (0-100) and
turns that into a decision: allow / step_up / block.

Weights (tune these once you have real outcome data to see which signal
is actually most predictive for your own traffic):
  ML scoring     35%   biggest single fraud signal
  Velocity       20%
  Geo & IP       15%
  Link graph     15%
  Auth & KYC     15%
"""

WEIGHTS = {
    "ml_score": 0.35,
    "velocity_score": 0.20,
    "geo_score": 0.15,
    "graph_score": 0.15,
    "auth_score": 0.15,
}


def combine(scores: dict) -> dict:
    overall = sum(scores[key]["score"] * WEIGHTS[key] for key in WEIGHTS)
    overall = round(overall, 1)

    if overall <= 30:
        decision = "allow"
    elif overall <= 70:
        decision = "step_up"
    else:
        decision = "block"

    reasons = [scores[key]["reason"] for key in WEIGHTS if scores[key]["reason"]]

    return {
        "overall_score": overall,
        "decision": decision,
        "breakdown": {key: scores[key]["score"] for key in WEIGHTS},
        "reasons": reasons,
    }
