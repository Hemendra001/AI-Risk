"""
Tiny SQLite helper. Every transaction we see gets stored here, so the
velocity check and link-graph check have history to look at.

No setup needed -- data/app.db is created automatically the first time
you run the app.
"""

import sqlite3
import time
import os

DB_PATH = "data/app.db"


def _connect():
    os.makedirs("data", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            device_id TEXT,
            ip TEXT,
            email TEXT,
            amount REAL,
            country TEXT,
            overall_score REAL,
            decision TEXT,
            created_at REAL
        )
    """)
    return conn


def save_transaction(user_id, device_id, ip, email, amount, country, overall_score, decision):
    conn = _connect()
    conn.execute(
        "INSERT INTO transactions "
        "(user_id, device_id, ip, email, amount, country, overall_score, decision, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, device_id, ip, email, amount, country, overall_score, decision, time.time()),
    )
    conn.commit()
    conn.close()


def count_recent_transactions(user_id, device_id, ip, seconds):
    """How many transactions has this user/device/IP made in the last N seconds?
    Used by the velocity check to catch bots and card-testing attacks."""
    conn = _connect()
    cutoff = time.time() - seconds
    cur = conn.execute(
        "SELECT COUNT(*) FROM transactions "
        "WHERE created_at > ? AND (user_id = ? OR device_id = ? OR ip = ?)",
        (cutoff, user_id, device_id, ip),
    )
    count = cur.fetchone()[0]
    conn.close()
    return count


def distinct_users_sharing(device_id, ip, hours=24):
    """How many DIFFERENT accounts have used this device/IP recently?
    Used by the link-graph check to catch fraud rings (one device/card
    funding many 'different' accounts)."""
    conn = _connect()
    cutoff = time.time() - hours * 3600
    cur = conn.execute(
        "SELECT COUNT(DISTINCT user_id) FROM transactions "
        "WHERE created_at > ? AND (device_id = ? OR ip = ?)",
        (cutoff, device_id, ip),
    )
    count = cur.fetchone()[0]
    conn.close()
    return count


def count_user_transactions(user_id):
    """Total number of previous transactions on record for this user --
    used on the intake page to flag accounts with an unusually large
    transaction history / repeated attempts (multiple-anomaly signal)."""
    conn = _connect()
    cur = conn.execute("SELECT COUNT(*) FROM transactions WHERE user_id = ?", (user_id,))
    count = cur.fetchone()[0]
    conn.close()
    return count


def last_known_location(user_id):
    """Country and IP of this user's most recent transaction (if any) --
    used on the intake page to flag a change in location before the full
    risk engine even runs."""
    conn = _connect()
    cur = conn.execute(
        "SELECT country, ip, created_at FROM transactions "
        "WHERE user_id = ? AND country IS NOT NULL AND country != '' "
        "ORDER BY created_at DESC LIMIT 1",
        (user_id,),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return {"country": row[0], "ip": row[1], "created_at": row[2]}


def user_average_amount(user_id, default=1000.0):
    """This user's average past transaction amount -- used by the ML module
    to judge whether a new transaction looks unusually large for them."""
    conn = _connect()
    cur = conn.execute("SELECT AVG(amount) FROM transactions WHERE user_id = ?", (user_id,))
    row = cur.fetchone()[0]
    conn.close()
    return row if row else default
