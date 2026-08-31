/**
 * MODULE 4 of 5 -- Link / graph check.
 * Identifies shared devices/IPs across distinct accounts (mule networks, fraud rings).
 */

import { distinctUsersSharing } from "../db.js";

export function scoreGraph(deviceId, ip) {
  const sharedUsers = distinctUsersSharing(deviceId, ip, 24);

  let riskScore = 0;
  let reason = null;

  if (sharedUsers >= 5) {
    riskScore = 85;
    reason = `${sharedUsers} different accounts have used this device/IP in the last 24h`;
  } else if (sharedUsers >= 2) {
    riskScore = 40;
    reason = `${sharedUsers} different accounts have used this device/IP in the last 24h`;
  }

  return { score: riskScore, reason };
}
