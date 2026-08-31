"""
Generates a synthetic dataset of online transactions so we have something
to train the "ML scoring" risk module on, before you have real data.

Each row = one transaction. `is_fraud` is the label we train on.

HOW TO SWITCH TO REAL DATA LATER:
  Once you have real, labelled transaction history (a column telling you
  whether each past transaction turned out to be fraud/chargeback or not),
  save it as data/transactions.csv using the EXACT SAME column names used
  below, then just re-run ml/train_model.py. Nothing else needs to change.
"""

import numpy as np
import pandas as pd
import os

np.random.seed(42)
N = 8000  # number of synthetic transactions to generate


def generate_dataset(n=N):
    rows = []
    for _ in range(n):
        # ~12% of synthetic transactions are "fraud" -- roughly realistic
        # for a training set (real-world fraud rates are much lower, but a
        # model needs enough fraud examples to actually learn from).
        is_fraud = np.random.rand() < 0.12

        user_avg_amount = np.random.uniform(200, 5000)     # user's usual spend, in INR
        hour = np.random.randint(0, 24)
        is_new_device = np.random.rand() < 0.15
        txns_last_hour = np.random.poisson(1)
        distance_km_from_last_txn = np.random.exponential(20)
        is_vpn = np.random.rand() < 0.05
        shared_device_count = np.random.poisson(0.3)

        if is_fraud:
            # Fraud is modelled as: odd hour, new device, amount far above
            # the user's usual spend, high velocity, big location jump, VPN use.
            amount = user_avg_amount * np.random.uniform(3, 15)
            hour = np.random.choice([0, 1, 2, 3, 4, 23])
            is_new_device = np.random.rand() < 0.75
            txns_last_hour = np.random.poisson(4)
            distance_km_from_last_txn = np.random.exponential(500)
            is_vpn = np.random.rand() < 0.4
            shared_device_count = np.random.poisson(2)
        else:
            amount = user_avg_amount * np.random.uniform(0.5, 1.8)

        rows.append({
            "amount": round(amount, 2),
            "user_avg_amount": round(user_avg_amount, 2),
            "amount_ratio": round(amount / user_avg_amount, 2),
            "hour": hour,
            "is_new_device": int(is_new_device),
            "txns_last_hour": txns_last_hour,
            "distance_km_from_last_txn": round(distance_km_from_last_txn, 1),
            "is_vpn": int(is_vpn),
            "shared_device_count": shared_device_count,
            "is_fraud": int(is_fraud),
        })
    return pd.DataFrame(rows)


if __name__ == "__main__":
    df = generate_dataset()
    os.makedirs("data", exist_ok=True)
    df.to_csv("data/transactions.csv", index=False)
    print(f"Saved {len(df)} synthetic transactions to data/transactions.csv")
    print(df["is_fraud"].value_counts())
