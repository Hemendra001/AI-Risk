/**
 * MODULE 2 of 5 -- Velocity check.
 * Catches bot attacks and rapid card-testing patterns based on burst frequency.
 */

import { countRecentTransactions } from "../db.js";

export const MAX_TXNS_PER_MIN = 3;
export const MAX_TXNS_PER_HOUR = 10;

export function scoreVelocity(userId, deviceId, ip) {
  const txnsLastMin = countRecentTransactions(userId, deviceId, ip, 60);
  const txnsLastHour = countRecentTransactions(userId, deviceId, ip, 3600);

  let riskScore = 0;
  let reason = null;

  if (txnsLastMin >= MAX_TXNS_PER_MIN) {
    riskScore = 90;
    reason = `${txnsLastMin} transactions from this user/device in the last minute`;
  } else if (txnsLastHour >= MAX_TXNS_PER_HOUR) {
    riskScore = 60;
    reason = `${txnsLastHour} transactions from this user/device in the last hour`;
  } else if (txnsLastHour >= Math.floor(MAX_TXNS_PER_HOUR / 2)) {
    riskScore = 25;
    reason = "Higher than usual transaction frequency";
  }

  return { score: riskScore, reason };
}
