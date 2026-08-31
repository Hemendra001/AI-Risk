/**
 * MODULE 1 of 5 -- ML behaviour scoring.
 * Evaluates behavioral anomalies: spending patterns, device consistency, time of day, location deltas.
 */

export function scoreMl(transaction) {
  let anomalyScore = 0;
  const amountRatio = Number(transaction.amount_ratio) || 1.0;
  
  if (amountRatio >= 3.0) {
    anomalyScore += Math.min(45, 25 + (amountRatio - 3.0) * 4);
  } else if (amountRatio >= 1.8) {
    anomalyScore += (amountRatio - 1.8) * 15;
  }

  const hour = transaction.hour !== undefined ? Number(transaction.hour) : new Date().getHours();
  if ([0, 1, 2, 3, 4, 23].includes(hour)) {
    anomalyScore += 12;
  }

  if (transaction.is_new_device) {
    anomalyScore += 10;
  }

  const txnsLastHour = Number(transaction.txns_last_hour) || 0;
  if (txnsLastHour >= 3) {
    anomalyScore += Math.min(25, txnsLastHour * 5);
  }

  const distanceKm = Number(transaction.distance_km_from_last_txn) || 0;
  if (distanceKm > 100) {
    anomalyScore += Math.min(25, (distanceKm / 100) * 5);
  }

  if (transaction.is_vpn) {
    anomalyScore += 20;
  }

  const sharedDeviceCount = Number(transaction.shared_device_count) || 0;
  if (sharedDeviceCount >= 2) {
    anomalyScore += Math.min(30, sharedDeviceCount * 12);
  }

  const riskScore = Math.min(100, Math.round(anomalyScore * 10) / 10);

  let reason = null;
  if (riskScore > 60) {
    reason = "Transaction pattern is very different from this user's usual behaviour";
  } else if (riskScore > 30) {
    reason = "Transaction pattern is somewhat unusual for this user";
  }

  return { score: riskScore, reason };
}
