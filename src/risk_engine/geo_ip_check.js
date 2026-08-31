/**
 * MODULE 3 of 5 -- Geo & IP check.
 * Checks for VPN/proxy usage and country mismatches against billing location.
 */

const HIGH_RISK_COUNTRIES = new Set();

export async function lookupIpGeolocation(ip) {
  const apiKey = process.env.GEO_API_KEY;
  if (!apiKey || !ip || ip === "127.0.0.1" || ip === "localhost" || ip === "::1") {
    return null;
  }
  try {
    const res = await fetch(
      `https://api.ipgeolocation.io/ipgeo?apiKey=${encodeURIComponent(apiKey)}&ip=${encodeURIComponent(ip)}&fields=country_code2`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.message) return null;
    return data.country_code2 || null;
  } catch (e) {
    return null;
  }
}

export async function lookupIpApi(ip) {
  if (!ip || ip === "127.0.0.1" || ip === "localhost" || ip === "::1") {
    return {};
  }
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,proxy,hosting`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) return {};
    const data = await res.json();
    if (data.status !== "success") return {};
    return data;
  } catch (e) {
    return {};
  }
}

export async function scoreGeo(ip, billingCountry = "IN") {
  const fallback = await lookupIpApi(ip);
  const geoCountry = await lookupIpGeolocation(ip);
  const ipCountry = geoCountry || fallback.countryCode || "";
  const isHostingOrProxy = Boolean(fallback.proxy || fallback.hosting);

  if (!ipCountry && !fallback.status) {
    return { score: 0, reason: "IP lookup unavailable (likely a local/dev IP)" };
  }

  let riskScore = 0;
  const reasons = [];

  if (ipCountry && billingCountry && ipCountry !== billingCountry) {
    riskScore += 40;
    reasons.push(`IP country (${ipCountry}) does not match billing country (${billingCountry})`);
  }

  if (isHostingOrProxy) {
    riskScore += 40;
    reasons.push("IP belongs to a known VPN/proxy/hosting provider");
  }

  if (HIGH_RISK_COUNTRIES.has(ipCountry)) {
    riskScore += 20;
    reasons.push("IP originates from a high-risk region");
  }

  return {
    score: Math.min(riskScore, 100),
    reason: reasons.length ? reasons.join("; ") : null,
    ip_country: ipCountry,
  };
}
