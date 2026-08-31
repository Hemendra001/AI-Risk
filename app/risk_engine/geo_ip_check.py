"""
MODULE 3 of 5 -- Geo & IP check.

Solves: cross-border card fraud and location-mismatch fraud -- e.g. a card
billed in India suddenly being used from another country, or from a known
VPN/proxy/hosting IP.

Primary provider: ipgeolocation.io, using a keyed request (GEO_API_KEY in
.env) for accurate, higher-rate-limit country lookups. ip-api.com (free,
no key) is kept as an automatic fallback if the key is missing/invalid or
the keyed request fails, and is also used as a secondary source for the
proxy/hosting (VPN) signal, which ipgeolocation.io only exposes on paid
plans. Everything else in the app stays the same either way.
"""

import os
import requests

# add ISO country codes you personally consider high-risk for your product
HIGH_RISK_COUNTRIES = set()

GEO_API_KEY = os.getenv("GEO_API_KEY")


def _lookup_ipgeolocation(ip: str) -> str | None:
    """Keyed lookup against ipgeolocation.io. Returns a 2-letter country
    code, or None if the key is missing or the lookup fails for any reason
    (bad key, rate limit, local/dev IP, network error, etc)."""
    if not GEO_API_KEY:
        return None
    try:
        resp = requests.get(
            "https://api.ipgeolocation.io/ipgeo",
            params={"apiKey": GEO_API_KEY, "ip": ip, "fields": "country_code2"},
            timeout=3,
        )
        data = resp.json()
    except Exception:
        return None
    if resp.status_code != 200 or "message" in data:
        # ipgeolocation.io puts a "message" field in error bodies (bad key, no credits, etc)
        return None
    return data.get("country_code2") or None


def _lookup_ip_api(ip: str) -> dict:
    """Free, unkeyed fallback/secondary source -- also the only place we
    get the proxy/hosting (VPN) signal from, since that's a paid feature
    on ipgeolocation.io."""
    try:
        resp = requests.get(
            f"http://ip-api.com/json/{ip}?fields=status,countryCode,proxy,hosting",
            timeout=3,
        )
        data = resp.json()
    except Exception:
        return {}
    if data.get("status") != "success":
        return {}
    return data


def score(ip: str, billing_country: str = "IN") -> dict:
    fallback = _lookup_ip_api(ip)
    ip_country = _lookup_ipgeolocation(ip) or fallback.get("countryCode", "")
    is_hosting_or_proxy = bool(fallback.get("proxy") or fallback.get("hosting"))

    if not ip_country and not fallback:
        # Lookup can fail for local/dev IPs like 127.0.0.1 -- don't punish
        # the user for that, just skip this check with a neutral score.
        return {"score": 0, "reason": "IP lookup unavailable (likely a local/dev IP)"}

    risk_score = 0
    reasons = []

    if ip_country and billing_country and ip_country != billing_country:
        risk_score += 40
        reasons.append(f"IP country ({ip_country}) does not match billing country ({billing_country})")

    if is_hosting_or_proxy:
        risk_score += 40
        reasons.append("IP belongs to a known VPN/proxy/hosting provider")

    if ip_country in HIGH_RISK_COUNTRIES:
        risk_score += 20
        reasons.append("IP originates from a high-risk region")

    return {"score": min(risk_score, 100), "reason": "; ".join(reasons) if reasons else None}
