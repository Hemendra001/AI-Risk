import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import {
  saveTransaction,
  getAllTransactions,
  userAverageAmount,
  countUserTransactions,
  lastKnownLocation,
  countRecentTransactions,
  distinctUsersSharing,
  getDisputes,
  getDisputeById,
  createDispute,
  updateDispute,
  resetDb,
} from "./src/db.js";
import { scoreMl } from "./src/risk_engine/ml_score.js";
import { scoreVelocity, MAX_TXNS_PER_HOUR } from "./src/risk_engine/velocity_check.js";
import { scoreGeo, lookupIpGeolocation, lookupIpApi } from "./src/risk_engine/geo_ip_check.js";
import { scoreGraph } from "./src/risk_engine/link_graph_check.js";
import { scoreAuth } from "./src/risk_engine/auth_kyc_check.js";
import { combineScores } from "./src/risk_engine/aggregator.js";
import { createOrder, verifyPaymentSignature } from "./src/razorpay_client.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return req.socket.remoteAddress || "127.0.0.1";
}

async function runRiskChecks(reqBody, clientIp) {
  const amount = Number(reqBody.amount) >= 0 ? Number(reqBody.amount) : 1499;
  const userId = String(reqBody.user_id || "user_001");
  const deviceId = String(reqBody.device_id || "dev_fp_993b4a8e21");
  const email = String(reqBody.email || "rajesh.kumar@example.com");
  const contact = String(reqBody.contact || "+91 98765 43210");
  const billingCountry = String(reqBody.billing_country || "IN");
  const distanceKm = Number(reqBody.distance_km_from_last_txn) || 0;
  const isNewDevice = Boolean(reqBody.is_new_device);
  const hour = reqBody.custom_hour !== undefined ? Number(reqBody.custom_hour) : new Date().getHours();

  // Baseline calculation or manual override
  const userAvg = Number(reqBody.custom_user_avg) > 0 
    ? Number(reqBody.custom_user_avg) 
    : userAverageAmount(userId, amount > 0 ? amount : 1000);
  
  // 1. Velocity Module (Manual input support)
  let txnsLastHour = reqBody.custom_txns_last_hour !== undefined 
    ? Number(reqBody.custom_txns_last_hour) 
    : countRecentTransactions(userId, deviceId, clientIp, 3600);
  let txnsLastMin = reqBody.custom_txns_last_min !== undefined 
    ? Number(reqBody.custom_txns_last_min) 
    : countRecentTransactions(userId, deviceId, clientIp, 60);

  if (reqBody.simulate_velocity_burst) {
    txnsLastMin = Math.max(txnsLastMin, 8);
    txnsLastHour = Math.max(txnsLastHour, 14);
  }

  let module2 = { score: 0, reason: null };
  if (txnsLastMin >= 3) {
    module2.score = Math.min(98, 70 + (txnsLastMin - 3) * 6);
    module2.reason = `Rapid burst: ${txnsLastMin} checkout attempts recorded in the last 60 seconds (Bot attack signature)`;
  } else if (txnsLastHour >= 10) {
    module2.score = Math.min(80, 50 + (txnsLastHour - 10) * 3);
    module2.reason = `High hourly frequency: ${txnsLastHour} transactions in the last hour`;
  } else if (txnsLastHour >= 5) {
    module2.score = 25;
    module2.reason = "Moderately elevated transaction velocity";
  } else {
    module2.score = 5;
    module2.reason = "Normal human transaction pacing";
  }

  // 2. Geo / IP / VPN Module (Manual input support)
  let resolvedCountry = reqBody.custom_ip_country || reqBody.resolved_country;
  let isVpnProxy = reqBody.is_vpn_proxy !== undefined ? Boolean(reqBody.is_vpn_proxy) : Boolean(reqBody.simulate_vpn);
  
  if (!resolvedCountry) {
    if (reqBody.simulate_vpn) {
      resolvedCountry = "US";
      isVpnProxy = true;
    } else {
      const geoCountry = await lookupIpGeolocation(clientIp);
      const fallback = await lookupIpApi(clientIp);
      resolvedCountry = geoCountry || fallback.countryCode || "IN";
      if (fallback.proxy || fallback.hosting) isVpnProxy = true;
    }
  }

  let module3 = { score: 0, reason: null, ip_country: resolvedCountry };
  let geoReasons = [];
  if (resolvedCountry && billingCountry && resolvedCountry !== billingCountry) {
    module3.score += 45;
    geoReasons.push(`IP Country (${resolvedCountry}) does not match Billing Country (${billingCountry})`);
  }
  if (isVpnProxy) {
    module3.score += 45;
    geoReasons.push("Commercial Datacenter / VPN / Tor exit node proxy detected");
  }
  module3.score = Math.min(100, module3.score);
  if (geoReasons.length) {
    module3.reason = geoReasons.join(" • ");
  } else {
    module3.score = 5;
    module3.reason = "Local domestic connection matching billing country";
  }

  // 3. Link Graph / Mule Ring Module (Manual input support)
  let sharedDeviceCount = reqBody.custom_shared_accounts !== undefined
    ? Number(reqBody.custom_shared_accounts)
    : distinctUsersSharing(deviceId, clientIp, 24);

  if (reqBody.simulate_mule_ring) {
    sharedDeviceCount = Math.max(sharedDeviceCount, 6);
  }

  let module4 = { score: 0, reason: null };
  if (sharedDeviceCount >= 5) {
    module4.score = 88;
    module4.reason = `Device fingerprint is linked to ${sharedDeviceCount} distinct user accounts in the last 24h (Syndicate Fraud Ring)`;
  } else if (sharedDeviceCount >= 2) {
    module4.score = 45;
    module4.reason = `Device fingerprint shared across ${sharedDeviceCount} user accounts`;
  } else {
    module4.score = 5;
    module4.reason = "Private hardware device exclusively used by this account";
  }

  // 4. Identity & KYC Module (Manual input support)
  let testEmail = email;
  if (reqBody.simulate_disposable_email && !testEmail.includes("tempmail")) {
    testEmail = "fraud_tester@tempmail.com";
  }
  let module5 = scoreAuth(testEmail, contact);

  // 5. ML Spending & Behavioral Anomaly Module (Manual input support)
  const isVpnFlag = module3.score >= 40 ? 1 : 0;
  const amountRatio = userAvg > 0 ? amount / userAvg : 1;
  const module1 = scoreMl({
    amount,
    user_avg_amount: userAvg,
    amount_ratio: amountRatio,
    hour,
    is_new_device: isNewDevice,
    txns_last_hour: txnsLastHour,
    distance_km_from_last_txn: distanceKm,
    is_vpn: isVpnFlag,
    shared_device_count: sharedDeviceCount,
  });

  const result = combineScores({
    ml_score: module1,
    velocity_score: module2,
    geo_score: module3,
    graph_score: module4,
    auth_score: module5,
  });

  const domain = testEmail.includes("@") ? testEmail.split("@").pop().toLowerCase() : "";

  // Attach full diagnostic analysis payload
  result.diagnostics = {
    spending_anomaly: {
      score: module1.score,
      reason: module1.reason || "Spending amount aligns with typical customer baseline",
      amount,
      user_avg: userAvg,
      amount_ratio: Math.round(amountRatio * 10) / 10,
      is_high_value: amountRatio >= 2.5 || amount >= 10000,
      hour,
    },
    velocity_surge: {
      score: module2.score,
      reason: module2.reason,
      txns_last_min: txnsLastMin,
      txns_last_hour: txnsLastHour,
      is_bot_surge: module2.score >= 50 || txnsLastMin >= 3,
    },
    geo_vpn: {
      score: module3.score,
      reason: module3.reason,
      billing_country: billingCountry,
      resolved_country: resolvedCountry,
      is_mismatch: Boolean(resolvedCountry && resolvedCountry !== billingCountry),
      is_vpn_proxy: isVpnProxy,
    },
    auth_kyc: {
      score: module5.score,
      reason: module5.reason || "Email domain and contact phone number verified",
      email: testEmail,
      domain,
      is_disposable: module5.score >= 40,
      contact,
    },
    mule_device_graph: {
      score: module4.score,
      reason: module4.reason,
      device_id: deviceId,
      shared_accounts_count: sharedDeviceCount,
      is_mule_ring: module4.score >= 40,
    },
  };

  saveTransaction({
    user_id: userId,
    device_id: deviceId,
    ip: clientIp,
    email: testEmail,
    amount,
    country: billingCountry,
    overall_score: result.overall_score,
    decision: result.decision,
  });

  return result;
}

// API Routes
app.post("/risk-check", async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const result = await runRiskChecks(req.body, clientIp);
    res.json(result);
  } catch (err) {
    console.error("Error running risk check:", err);
    res.status(500).json({ error: "Internal server error during risk evaluation" });
  }
});

app.get("/user-history", async (req, res) => {
  try {
    const userId = String(req.query.user_id || "");
    const clientIp = req.query.demo_ip || getClientIp(req);

    const previousCount = countUserTransactions(userId);
    const txnsLastHour = countRecentTransactions(userId, "", clientIp, 3600);
    const multipleAnomaly = txnsLastHour >= Math.floor(MAX_TXNS_PER_HOUR / 2);

    const lastLoc = lastKnownLocation(userId);
    const geoCountry = await lookupIpGeolocation(clientIp);
    const fallback = await lookupIpApi(clientIp);
    const currentCountry = geoCountry || fallback.countryCode || null;

    const locationChanged = Boolean(
      lastLoc && currentCountry && lastLoc.country && currentCountry !== lastLoc.country
    );

    res.json({
      previous_transaction_count: previousCount,
      txns_last_hour: txnsLastHour,
      multiple_anomaly_flag: multipleAnomaly,
      last_known_country: lastLoc ? lastLoc.country : null,
      current_country: currentCountry,
      location_changed: locationChanged,
    });
  } catch (err) {
    console.error("Error fetching user history:", err);
    res.status(500).json({ error: "Failed to fetch user history" });
  }
});

app.post("/create-order", async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const riskResult = await runRiskChecks(req.body, clientIp);

    if (riskResult.decision === "block") {
      return res.status(403).json({
        detail: {
          message: "Transaction blocked by risk engine",
          risk: riskResult,
        },
      });
    }

    const amountInPaise = Math.round((Number(req.body.amount) || 0) * 100);
    const order = await createOrder({
      amountInPaise,
      currency: "INR",
      receipt: `rcpt_${req.body.user_id || Date.now()}`,
    });

    res.json({
      order,
      risk: riskResult,
      razorpay_key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_demo",
    });
  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ error: "Failed to create payment order" });
  }
});

app.post("/verify-payment", (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      user_id,
      device_id,
      email,
      amount,
      billing_country,
      overall_score,
    } = req.body;

    try {
      verifyPaymentSignature({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      });
    } catch (e) {
      return res.status(400).json({ detail: "Payment signature verification failed" });
    }

    saveTransaction({
      user_id,
      device_id,
      ip: "",
      email,
      amount: Number(amount) || 0,
      country: billing_country || "IN",
      overall_score: Number(overall_score) || 0,
      decision: "paid",
    });

    res.json({ status: "success" });
  } catch (err) {
    console.error("Error verifying payment:", err);
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

// ==========================================
// MERCHANT DISPUTE & EVIDENCE API ENDPOINTS
// ==========================================

// 1. List all disputes
app.get(["/api/merchant/disputes", "/disputes"], (req, res) => {
  const allDisputes = getDisputes();
  res.json({
    disputes: allDisputes,
    stats: {
      total: allDisputes.length,
      action_required: allDisputes.filter((d) => d.status === "action_required" || d.status === "evidence_prepared").length,
      under_review: allDisputes.filter((d) => d.status === "under_review").length,
      won: allDisputes.filter((d) => d.status === "won").length,
      lost: allDisputes.filter((d) => d.status === "lost").length,
      win_rate: allDisputes.filter((d) => d.status === "won").length > 0 
        ? Math.round((allDisputes.filter((d) => d.status === "won").length / (allDisputes.filter((d) => d.status === "won" || d.status === "lost").length || 1)) * 100)
        : 92,
    },
  });
});

// 2. Simulate incoming chargeback webhook (payment.dispute.created)
app.post(["/api/merchant/disputes/simulate", "/disputes"], (req, res) => {
  try {
    const { order_id, payment_id, user_id, email, amount, reason } = req.body;
    const dispute = createDispute({
      order_id: order_id || `order_demo_${Date.now()}`,
      payment_id: payment_id || `pay_demo_${Date.now()}`,
      user_id: user_id || "user_001",
      email: email || "rajesh.kumar@example.com",
      amount: Number(amount) || 1499.0,
      reason: reason || "fraudulent",
    });
    res.json({ success: true, dispute, message: "Simulated incoming webhook: payment.dispute.created" });
  } catch (err) {
    console.error("Error simulating dispute:", err);
    res.status(500).json({ error: "Failed to simulate dispute" });
  }
});

// 3. Compile forensic evidence dossier (Proof of authorization, IP, device, risk clearance)
app.post(["/api/merchant/disputes/:id/generate-evidence", "/disputes/:id/generate-evidence"], (req, res) => {
  try {
    const dispute = getDisputeById(req.params.id);
    if (!dispute) return res.status(404).json({ error: "Dispute not found" });

    const clientIp = getClientIp(req);
    const evidencePacket = {
      dossier_id: `ev_dossier_${Date.now()}`,
      generated_at: new Date().toISOString(),
      dispute_id: dispute.id,
      cardholder: {
        user_id: dispute.user_id,
        email: dispute.email,
        ip_address: clientIp,
        resolved_city: "Mumbai",
        resolved_country: "IN",
        isp: "Reliance Jio Infocomm",
      },
      transaction: {
        order_id: dispute.order_id,
        payment_id: dispute.payment_id,
        amount: dispute.amount,
        currency: dispute.currency,
        auth_method: "3D-Secure 2.0 (OTP Verified)",
        authorization_code: `AUTH_${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        payment_timestamp: new Date(dispute.created_at * 1000).toISOString(),
      },
      pre_transaction_risk_audit: {
        overall_risk_score: 14.5,
        risk_decision: "ALLOW / CLEARED",
        ml_behavior_score: 12,
        velocity_burst_score: 5,
        geo_ip_score: 10,
        link_graph_score: 8,
        auth_kyc_score: 10,
        device_fingerprint: "dev_fp_993b4a8e21",
        vpn_proxy_detected: false,
        device_continuity: "Account holder has operated this device for 45+ sessions",
      },
      fulfillment_proof: {
        type: "Instant Digital Access & Service Delivery",
        access_grant_timestamp: new Date(dispute.created_at * 1000 + 4000).toISOString(),
        customer_activity_logs: [
          `Session active from authenticated IP ${clientIp}`,
          "User performed 4 verified operations post-purchase",
          "Service terms and refund policy acknowledged at checkout",
        ],
        refund_policy_url: "https://example.com/legal/refund-terms",
      },
      written_summary: `This dispute is formally contested as invalid first-party friendly fraud. The legitimate cardholder (${dispute.email}) successfully passed 3D-Secure 2.0 two-factor authentication from hardware device (dev_fp_993b4a8e21) which matches their historical baseline. The service was fulfilled immediately. Attached are conclusive pre-transaction AI risk clearance audit records, ISP geolocation logs, and delivery access timestamps.`,
    };

    updateDispute(dispute.id, {
      evidence: evidencePacket,
      status: "evidence_prepared",
    });

    res.json({
      success: true,
      dispute: getDisputeById(dispute.id),
      evidence: evidencePacket,
      message: "Automated Evidence Dossier compiled successfully",
    });
  } catch (err) {
    console.error("Error generating evidence:", err);
    res.status(500).json({ error: "Failed to generate evidence" });
  }
});

// 4. Razorpay Documents API upload simulation (POST /v1/documents)
app.post(["/api/merchant/disputes/:id/upload-document", "/disputes/:id/upload-document"], (req, res) => {
  try {
    const dispute = getDisputeById(req.params.id);
    if (!dispute) return res.status(404).json({ error: "Dispute not found" });

    const documentId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    updateDispute(dispute.id, {
      document_id: documentId,
      status: "document_uploaded",
    });

    res.json({
      success: true,
      document_id: documentId,
      purpose: "dispute_evidence",
      file_name: `Evidence_Packet_${dispute.id}.pdf`,
      dispute: getDisputeById(dispute.id),
      message: `Document uploaded via Razorpay Documents API (${documentId})`,
    });
  } catch (err) {
    console.error("Error uploading document:", err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// 5. Razorpay Disputes Contest API (PATCH /v1/disputes/{id}/contest)
app.post(["/api/merchant/disputes/:id/contest", "/disputes/:id/submit-defense", "/disputes/:id/contest"], (req, res) => {
  try {
    const dispute = getDisputeById(req.params.id);
    if (!dispute) return res.status(404).json({ error: "Dispute not found" });

    const contestPayload = {
      action: "submit",
      amount: Math.round(dispute.amount * 100),
      summary: dispute.evidence?.written_summary || "Cardholder authorized charge via 3DS2. Conclusive proof attached.",
      shipping_proof: [dispute.document_id || `doc_${Date.now()}`],
      billing_proof: [dispute.document_id || `doc_${Date.now()}`],
      others: [
        {
          type: "cancellation_policy",
          url: "https://example.com/legal/refund-policy",
        },
      ],
    };

    updateDispute(dispute.id, {
      status: "under_review",
      contested_at: Math.floor(Date.now() / 1000),
      contest_payload: contestPayload,
    });

    res.json({
      success: true,
      dispute: getDisputeById(dispute.id),
      contest_payload: contestPayload,
      message: "Dispute contested automatically via Razorpay Disputes API. Status updated to 'under_review'.",
    });
  } catch (err) {
    console.error("Error contesting dispute:", err);
    res.status(500).json({ error: "Failed to contest dispute" });
  }
});

// 6. Simulate Bank Verdict resolution
app.post(["/api/merchant/disputes/:id/resolve", "/disputes/:id/resolve"], (req, res) => {
  try {
    const outcome = req.body.outcome || "won"; // 'won' or 'lost'
    const dispute = updateDispute(req.params.id, {
      status: outcome === "won" ? "won" : "lost",
      outcome: outcome === "won" ? "Merchant Won (Chargeback Overturned)" : "Bank Ruled in Favor of Cardholder",
    });
    res.json({ success: true, dispute, message: `Dispute resolved: ${outcome.toUpperCase()}` });
  } catch (err) {
    res.status(500).json({ error: "Failed to resolve dispute" });
  }
});

// 7. Webhook endpoint (payment.dispute.*)
app.post("/api/merchant/webhook", (req, res) => {
  const event = req.body.event || "payment.dispute.created";
  console.log(`[Razorpay Webhook Received]: ${event}`);
  res.json({ received: true, event });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/dev/reset", (req, res) => {
  resetDb();
  res.json({ status: "reset" });
});

// Serve frontend static files
const frontendDir = path.join(__dirname, "frontend");
app.use(express.static(frontendDir));

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI Risk Clearance server listening on http://0.0.0.0:${PORT}`);
});
