/**
 * In-memory transaction store with history querying capabilities
 * Used by velocity, link-graph, and behavioral checks.
 */

const transactions = [];
const disputes = [
  {
    id: "disp_demo_98234",
    order_id: "order_demo_1001",
    payment_id: "pay_demo_7721",
    user_id: "user_001",
    email: "rajesh.kumar@example.com",
    amount: 1499.0,
    currency: "INR",
    reason: "fraudulent",
    reason_label: "Cardholder claims unauthorized transaction (Friendly Fraud)",
    status: "action_required",
    phase: "chargeback",
    respond_by: Math.floor(Date.now() / 1000) + 86400 * 5, // 5 days from now
    created_at: Math.floor(Date.now() / 1000) - 3600 * 4,
    evidence: null,
    document_id: null,
    contested_at: null,
    outcome: null,
  },
];

export function saveTransaction({
  user_id,
  device_id,
  ip,
  email,
  amount,
  country,
  overall_score,
  decision,
}) {
  const txn = {
    id: transactions.length + 1,
    user_id: user_id || "",
    device_id: device_id || "",
    ip: ip || "",
    email: email || "",
    amount: Number(amount) || 0,
    country: country || "",
    overall_score: Number(overall_score) || 0,
    decision: decision || "",
    created_at: Date.now() / 1000,
  };
  transactions.push(txn);
  return txn;
}

export function getAllTransactions() {
  return [...transactions].reverse();
}

export function getDisputes() {
  return [...disputes].reverse();
}

export function getDisputeById(id) {
  return disputes.find((d) => d.id === id);
}

export function createDispute({ order_id, payment_id, user_id, email, amount, reason }) {
  const newDispute = {
    id: `disp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    order_id: order_id || `order_demo_${Date.now()}`,
    payment_id: payment_id || `pay_demo_${Date.now()}`,
    user_id: user_id || "user_001",
    email: email || "customer@example.com",
    amount: Number(amount) || 1499.0,
    currency: "INR",
    reason: reason || "fraudulent",
    reason_label:
      reason === "product_not_received"
        ? "Customer alleges product/service was not delivered"
        : "Cardholder claims unauthorized transaction (First-Party / Friendly Fraud)",
    status: "action_required",
    phase: "chargeback",
    respond_by: Math.floor(Date.now() / 1000) + 86400 * 4,
    created_at: Math.floor(Date.now() / 1000),
    evidence: null,
    document_id: null,
    contested_at: null,
    outcome: null,
  };
  disputes.push(newDispute);
  return newDispute;
}

export function updateDispute(id, updates) {
  const disp = disputes.find((d) => d.id === id);
  if (!disp) return null;
  Object.assign(disp, updates);
  return disp;
}

export function countRecentTransactions(user_id, device_id, ip, seconds) {
  const cutoff = Date.now() / 1000 - seconds;
  return transactions.filter(
    (t) =>
      t.created_at > cutoff &&
      ((user_id && t.user_id === user_id) ||
        (device_id && t.device_id === device_id) ||
        (ip && t.ip === ip))
  ).length;
}

export function distinctUsersSharing(device_id, ip, hours = 24) {
  const cutoff = Date.now() / 1000 - hours * 3600;
  const matching = transactions.filter(
    (t) =>
      t.created_at > cutoff &&
      ((device_id && t.device_id === device_id) || (ip && t.ip === ip))
  );
  const users = new Set(matching.map((t) => t.user_id).filter(Boolean));
  return users.size;
}

export function countUserTransactions(user_id) {
  return transactions.filter((t) => t.user_id === user_id).length;
}

export function lastKnownLocation(user_id) {
  const userTxns = transactions
    .filter((t) => t.user_id === user_id && t.country)
    .sort((a, b) => b.created_at - a.created_at);
  if (userTxns.length === 0) return null;
  return {
    country: userTxns[0].country,
    ip: userTxns[0].ip,
    created_at: userTxns[0].created_at,
  };
}

export function userAverageAmount(user_id, defaultValue = 1000.0) {
  const userTxns = transactions.filter((t) => t.user_id === user_id && t.amount > 0);
  if (userTxns.length === 0) return defaultValue;
  const sum = userTxns.reduce((acc, t) => acc + t.amount, 0);
  return sum / userTxns.length;
}

export function resetDb() {
  transactions.length = 0;
}
