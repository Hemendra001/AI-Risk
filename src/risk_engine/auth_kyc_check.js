/**
 * MODULE 5 of 5 -- Auth & KYC check.
 * Flags disposable emails and invalid phone numbers to distinguish risky attempts from honest users.
 */

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "tempmail.com",
  "10minutemail.com",
  "guerrillamail.com",
]);

export function scoreAuth(email = "", contact = "") {
  let riskScore = 0;
  const reasons = [];

  const domain = email.includes("@") ? email.split("@").pop().toLowerCase() : "";
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    riskScore += 50;
    reasons.push("Email uses a disposable/temporary email domain");
  }

  const digitsOnly = String(contact || "").replace(/\D/g, "");
  if (digitsOnly.length < 10) {
    riskScore += 20;
    reasons.push("Phone number looks incomplete or invalid");
  }

  return {
    score: Math.min(riskScore, 100),
    reason: reasons.length ? reasons.join("; ") : null,
  };
}
