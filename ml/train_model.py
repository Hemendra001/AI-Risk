"""
Trains the "ML scoring" risk module and saves:
  - ml/model.pkl           the trained model
  - ml/feature_order.json  the exact list/order of features the model expects

Run once before starting the app (from the project's ROOT folder):
    python ml/train_model.py

SWITCHING TO REAL DATA LATER:
  1. Replace data/transactions.csv with your real, labelled transaction
     history. Keep the SAME column names used in generate_synthetic_data.py:
     amount, user_avg_amount, amount_ratio, hour, is_new_device,
     txns_last_hour, distance_km_from_last_txn, is_vpn,
     shared_device_count, is_fraud (0 = legit, 1 = confirmed fraud/chargeback).
  2. Re-run this script. It overwrites ml/model.pkl with a model trained on
     your real data -- the rest of the app doesn't need any changes.
  3. As you collect more real outcomes over time, re-run this script
     periodically (e.g. weekly/monthly) so the model keeps learning.
"""

import pandas as pd
import joblib
import json
import os
import sys
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, classification_report

FEATURES = [
    "amount", "user_avg_amount", "amount_ratio", "hour",
    "is_new_device", "txns_last_hour", "distance_km_from_last_txn",
    "is_vpn", "shared_device_count",
]


def main():
    data_path = "data/transactions.csv"

    if not os.path.exists(data_path):
        print("No dataset found -- generating synthetic data first...")
        sys.path.insert(0, os.path.dirname(__file__))
        from generate_synthetic_data import generate_dataset
        os.makedirs("data", exist_ok=True)
        generate_dataset().to_csv(data_path, index=False)

    df = pd.read_csv(data_path)
    X = df[FEATURES]
    y = df["is_fraud"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # RandomForest is a good default here: handles mixed numeric features
    # well, doesn't need feature scaling, and is easy to reason about.
    # class_weight="balanced" helps since fraud is always a minority class.
    model = RandomForestClassifier(
        n_estimators=200, max_depth=6, random_state=42, class_weight="balanced"
    )
    model.fit(X_train, y_train)

    preds = model.predict_proba(X_test)[:, 1]
    print("ROC-AUC on held-out test set:", round(roc_auc_score(y_test, preds), 3))
    print(classification_report(y_test, model.predict(X_test)))

    os.makedirs("ml", exist_ok=True)
    joblib.dump(model, "ml/model.pkl")
    with open("ml/feature_order.json", "w") as f:
        json.dump(FEATURES, f)

    print("Saved trained model to ml/model.pkl")


if __name__ == "__main__":
    main()
