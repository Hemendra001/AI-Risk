# AI Risk Manager

## Pre-Transaction Fraud Detection & Merchant Risk Management

AI Risk Manager is a full-stack fraud-risk application that evaluates a
payment **before the payment order is created**.

Instead of depending on one fraud rule, it combines multiple signals:

-   **ML Behaviour** --- checks whether the transaction looks unusual
    for the user.
-   **Velocity** --- checks how many transactions are happening in a
    short period.
-   **Geo & IP** --- checks IP/location consistency and
    proxy/VPN/hosting signals.
-   **Link Graph** --- checks whether the same device or IP is being
    shared by multiple accounts.
-   **Auth & KYC** --- checks basic identity-related risk signals such
    as disposable email and phone validity.
-   **Clearance** --- combines all module scores into one overall risk
    score and returns `allow`, `step_up`, or `block`.

The project also contains a **Merchant Dispute Defense** workflow for
creating a dispute record, generating an evidence dossier, uploading
evidence, contesting the dispute, and simulating a resolution.

> **Note:** The current "ML Behaviour" module is implemented as a
> rule-based anomaly scorer. The project structure is ready for
> replacing it with a trained ML model.

------------------------------------------------------------------------

## 1. Problem Statement

Online payment fraud is difficult to detect using a single signal.

A transaction can look normal by amount but become suspicious when other
information is considered.

For example:

``` text
Normal amount?       Yes
Many recent payments? Yes
New device?           Yes
Unusual IP?            Yes
Shared device?         Yes
Disposable email?      Yes
```

Looking at only the amount may miss the risk.

There is also a second problem: **merchant disputes**. After a
successful payment, a merchant may receive a chargeback/dispute and need
transaction and authorization evidence.

### The problem

A useful risk system should therefore:

1.  Detect suspicious activity before payment.
2.  Combine different risk signals.
3.  Explain why a transaction is risky.
4.  Avoid blocking every unusual transaction.
5.  Give merchants a workflow for handling disputes and evidence.

------------------------------------------------------------------------

## 2. Solution

AI Risk Manager uses a **multi-layer risk engine**.

``` text
Customer Transaction
        |
        v
+---------------------+
|   Risk Assessment   |
+----------+----------+
           |
   +-------+-------+-------+-------+-------+
   |       |       |       |       |       |
   v       v       v       v       v       |
Behaviour Velocity Geo/IP Link   Auth/KYC |
                         Graph             |
   |       |       |       |       |       |
   +-------+-------+-------+-------+-------+
           |
           v
    Risk Aggregator
           |
     +-----+------+
     |            |
   Score       Decision
                 |
       +---------+---------+
       |         |         |
     ALLOW    STEP-UP    BLOCK
```

If the decision is `block`, `/create-order` stops the transaction before
creating the payment order.

If it is allowed to continue, the server creates the payment order
through the payment integration.

------------------------------------------------------------------------

# 3. Risk Modules

## 3.1 ML Behaviour

### Simple meaning

**"Does this transaction look different from the user's normal
behaviour?"**

The current implementation calculates an anomaly score using signals
such as:

-   transaction amount compared with the user's average
-   time of day
-   new device
-   transactions in the last hour
-   distance from the previous transaction
-   VPN-related signal
-   number of users sharing a device/IP

Example:

``` text
User normally spends: ₹1,000

Current transaction: ₹10,000

Amount ratio: 10x
        |
        v
Higher behaviour risk
```

The module returns a score from `0` to `100` and an explanation when the
behaviour is unusual.

### Important

Despite its name, the current `src/risk_engine/ml_score.js` is **not a
trained ML model**. It is a rule-based behavioural anomaly scorer.

A future version can train a model using the transaction data and
replace this scorer.

------------------------------------------------------------------------

## 3.2 Velocity

### Simple meaning

**"Is the user making too many transactions too quickly?"**

The system checks recent transaction activity.

Current thresholds:

-   **3 or more transactions in 1 minute** → high velocity risk
-   **10 or more transactions in 1 hour** → high velocity risk
-   half of the hourly limit → elevated risk

Example:

``` text
10:01  ₹100
10:01  ₹100
10:02  ₹100
10:02  ₹100
10:03  ₹100
```

A sudden burst can indicate:

-   automated activity
-   card testing
-   bots
-   account takeover attempts

------------------------------------------------------------------------

## 3.3 Geo & IP

### Simple meaning

**"Does the transaction's network/location information make sense?"**

The module checks:

-   IP country
-   billing country
-   proxy/VPN/hosting indicators

Example:

``` text
Billing country: India
IP country:      US
Proxy/Hosting:   Yes
```

The system increases the Geo/IP risk score.

The module uses external IP-geolocation services when configured. API
credentials are read from environment variables and are **not stored in
this README**.

------------------------------------------------------------------------

## 3.4 Link Graph

### Simple meaning

**"Is this account connected to many other accounts through the same
device or IP?"**

Example:

``` text
Account A ----+
Account B ----+---- Device X
Account C ----+
Account D ----+
```

If many different accounts use the same device/IP in a short period, the
system can flag it.

Current logic:

-   2+ shared users → elevated risk
-   5+ shared users → high risk

This can help identify patterns associated with:

-   fraud rings
-   mule accounts
-   account farms
-   coordinated activity

The current project implements a lightweight relationship check. A
future version could use a real graph database and graph ML.

------------------------------------------------------------------------

## 3.5 Auth & KYC

### Simple meaning

**"Does the basic customer identity information look reasonable?"**

The current module checks:

-   disposable/temporary email domains
-   basic phone-number validity

For example:

``` text
temporary email → higher risk
invalid phone    → higher risk
```

The current module is intentionally simple. A production implementation
could connect real authentication and KYC services.

------------------------------------------------------------------------

# 4. Clearance

Clearance is the **final decision layer**.

It receives the five module scores and combines them.

### Current weights

  Signal           Weight
  -------------- --------
  ML Behaviour        35%
  Velocity            20%
  Geo & IP            15%
  Link Graph          15%
  Auth & KYC          15%

Conceptually:

``` text
Overall Risk =
Behaviour × 0.35
+ Velocity × 0.20
+ Geo/IP × 0.15
+ Link Graph × 0.15
+ Auth/KYC × 0.15
```

### Decision thresholds

    Overall Score Decision
  --------------- -----------
           `0–30` `allow`
          `31–70` `step_up`
         `71–100` `block`

### Why STEP-UP?

A medium-risk transaction does not always mean fraud.

Instead of immediately rejecting it, the system can send it for
additional verification or review.

This helps balance:

``` text
Fraud prevention
       +
Customer experience
```

------------------------------------------------------------------------

# 5. End-to-End Payment Flow

The main payment flow is:

``` text
1. Customer enters transaction details
             |
             v
2. /risk-check
             |
             v
3. Five risk modules run
             |
             v
4. Risk Aggregator
             |
             v
5. Overall score + decision
             |
       +-----+------+
       |            |
     BLOCK      ALLOW/STEP-UP
       |            |
       X            v
   Stop payment  /create-order
                    |
                    v
              Payment Order
                    |
                    v
             Checkout / Payment
                    |
                    v
              /verify-payment
```

The key security idea is:

> **Risk evaluation happens before the payment order is created.**

------------------------------------------------------------------------

# 6. Merchant Dispute Defense

Fraud prevention does not end when a payment succeeds.

A merchant can later receive a payment dispute.

The project includes a merchant workflow for this situation.

``` text
Dispute Created
      |
      v
Create Dispute Record
      |
      v
Generate Evidence Dossier
      |
      v
Upload Evidence
      |
      v
Contest Dispute
      |
      v
Resolve / Simulate Outcome
```

The evidence dossier can contain information such as:

-   transaction details
-   customer information
-   IP information
-   authentication information
-   risk assessment
-   device continuity
-   customer activity
-   fulfillment/service information

This creates a connection between:

**Pre-payment risk detection**

and

**Post-payment dispute defense**

------------------------------------------------------------------------

# 7. Why This Project Is Different

A basic fraud project often looks like:

``` text
Transaction
     |
     v
One ML model
     |
     v
Fraud / Not Fraud
```

AI Risk Manager uses a broader approach:

``` text
Behaviour
Velocity
Geo/IP
Link Graph
Auth/KYC
    |
    v
Risk Aggregation
    |
    v
ALLOW / STEP-UP / BLOCK
    |
    v
Payment
    |
    v
Dispute Defense
```

### Main differences

**1. Multi-signal detection**

The system does not depend on a single feature.

**2. Pre-transaction decision**

Risk is checked before payment order creation.

**3. Explainable risk**

Each module can provide a score and reason.

**4. Step-up decision**

Borderline transactions can receive additional verification instead of
being automatically blocked.

**5. Relationship analysis**

The Link Graph module considers shared devices/IPs across accounts.

**6. Dispute workflow**

The project also demonstrates merchant evidence handling after a
dispute.

------------------------------------------------------------------------

# 8. Technology Stack

## Backend

-   **Node.js** --- JavaScript runtime
-   **Express.js** --- REST API server
-   **Razorpay Node SDK** --- payment order/signature integration
-   **dotenv** --- environment configuration
-   **CORS** --- cross-origin request handling

## Frontend

-   **HTML**
-   **CSS**
-   **Vanilla JavaScript**
-   **Razorpay Checkout integration**

No React, Angular, or Vue is required.

## Data

-   CSV transaction dataset for development/ML experimentation
-   In-memory transaction/dispute storage in `src/db.js`

------------------------------------------------------------------------

# 9. Project Structure

``` text
airisk-main/
│
├── frontend/
│   ├── index.html
│   └── demoConfig.js
│
├── src/
│   ├── db.js
│   ├── razorpay_client.js
│   │
│   └── risk_engine/
│       ├── aggregator.js
│       ├── auth_kyc_check.js
│       ├── geo_ip_check.js
│       ├── link_graph_check.js
│       ├── ml_score.js
│       └── velocity_check.js
│
├── data/
│   └── transactions.csv
│
├── .env.example
├── .gitignore
├── metadata.json
├── package.json
├── server.js
└── README.md
```

------------------------------------------------------------------------

# 10. Important Files

  ---------------------------------------------------------------------------
  File                                    Purpose
  --------------------------------------- -----------------------------------
  `server.js`                             Main Express server and API routes

  `src/db.js`                             Stores transaction/dispute data in
                                          memory

  `src/razorpay_client.js`                Creates orders and verifies payment
                                          signatures

  `src/risk_engine/ml_score.js`           Behaviour anomaly scoring

  `src/risk_engine/velocity_check.js`     Transaction burst detection

  `src/risk_engine/geo_ip_check.js`       IP and geographic risk

  `src/risk_engine/link_graph_check.js`   Shared device/IP analysis

  `src/risk_engine/auth_kyc_check.js`     Basic Auth/KYC risk checks

  `src/risk_engine/aggregator.js`         Final score and decision

  `frontend/index.html`                   Application interface

  `frontend/demoConfig.js`                Demo configuration/scenarios

  `data/transactions.csv`                 Sample transaction data
  ---------------------------------------------------------------------------

------------------------------------------------------------------------

# 11. API Endpoints

## Risk

### `POST /risk-check`

Runs the risk engine and returns:

-   overall score
-   decision
-   individual module scores
-   reasons

### `GET /user-history`

Returns previous transaction and location-related information for a
user.

### `POST /create-order`

Runs the risk engine first.

If the result is `block`, order creation is stopped.

Otherwise, it attempts to create the payment order.

### `POST /verify-payment`

Verifies the payment signature and records the transaction.

### `GET /health`

Basic server health endpoint.

------------------------------------------------------------------------

# 12. Merchant Dispute Endpoints

``` text
GET  /api/merchant/disputes
POST /api/merchant/disputes/simulate
POST /api/merchant/disputes/:id/generate-evidence
POST /api/merchant/disputes/:id/upload-document
POST /api/merchant/disputes/:id/contest
POST /api/merchant/disputes/:id/resolve
POST /api/merchant/webhook
```

These endpoints support the project's dispute-defense demonstration.

------------------------------------------------------------------------

# 13. Data for Machine Learning

The project includes:

``` text
data/transactions.csv
```

The dataset contains transaction-style features such as:

-   transaction amount
-   average amount
-   amount ratio
-   transaction hour
-   new-device flag
-   transactions in the last hour
-   distance from previous transaction
-   VPN indicator
-   shared-device count
-   fraud label

These features can be used to train a real fraud-classification model.

### Possible ML pipeline

``` text
CSV Data
   |
   v
Clean Data
   |
   v
Feature Engineering
   |
   v
Train/Test Split
   |
   v
Train Model
   |
   v
Evaluate
   |
   v
Save Model
   |
   v
Use Model inside ML Behaviour
```

Suitable models include:

-   Logistic Regression
-   Random Forest
-   XGBoost
-   Gradient Boosting

For fraud data, accuracy alone is not enough. Precision, recall,
F1-score, ROC-AUC/PR-AUC, and false-positive rate should also be
considered.

------------------------------------------------------------------------

# 14. Running the Project

## Requirements

Install:

-   Node.js
-   npm

Check:

``` bash
node --version
npm --version
```

## Install dependencies

``` bash
npm install
```

## Configure environment

Copy `.env.example` to `.env` and add your own local credentials where
required.

``` bash
cp .env.example .env
```

**Never commit `.env` to GitHub.**

The repository's `.gitignore` is intended to keep secrets out of Git.

## Start the server

``` bash
npm start
```

or:

``` bash
npm run dev
```

The application runs on:

``` text
http://localhost:3000
```

------------------------------------------------------------------------

# 15. Example Risk Result

A risk assessment can conceptually look like:

``` json
{
  "overall_score": 76.5,
  "decision": "block",
  "breakdown": {
    "ml_score": 82,
    "velocity_score": 90,
    "geo_score": 40,
    "graph_score": 40,
    "auth_score": 0
  },
  "reasons": [
    "Transaction pattern is very different from this user's usual behaviour",
    "Higher transaction frequency"
  ]
}
```

The important point is that the system gives both:

``` text
Risk score
+
Reason
```

rather than only returning a fraud label.

------------------------------------------------------------------------

# 16. Security: Keep API Keys Private

Do **not** put secret keys inside:

-   `README.md`
-   frontend JavaScript
-   HTML
-   Git commits
-   screenshots
-   public GitHub files

Use `.env` locally.

Example:

``` env
RAZORPAY_KEY_ID=your_key_here
RAZORPAY_KEY_SECRET=your_secret_here
GEO_API_KEY=your_key_here
```

Only the variable names should be documented publicly.

If a real secret has ever been committed to GitHub, revoke/rotate it
before publishing the repository.

------------------------------------------------------------------------

# 17. Current Implementation vs Future ML

The current system is best described as a **risk-engine prototype with a
rule-based behavioural scorer**.

### Current

``` text
Behaviour Rules
+
Velocity Rules
+
Geo/IP Rules
+
Link Rules
+
Auth/KYC Rules
        |
        v
Weighted Risk Score
        |
        v
Decision
```

### Future

``` text
Historical Transactions
        |
        v
Feature Engineering
        |
        v
Trained ML Model
        |
        v
Fraud Probability
        |
        +
Other Risk Signals
        |
        v
Risk Aggregator
        |
        v
Decision
```

This makes the project easy to improve without redesigning the entire
application.

------------------------------------------------------------------------

# 18. Future Improvements

### Real ML model

Replace the current behavioural rules with a trained and validated fraud
model.

### Persistent database

Replace in-memory storage with PostgreSQL, MySQL, MongoDB, or another
appropriate database.

### Real graph analysis

Move from shared-count checks to a graph database and graph-based fraud
detection.

### Real KYC/authentication

Integrate proper authentication and identity-verification services.

### Better feature engineering

Add features such as:

-   account age
-   historical spending patterns
-   failed payment count
-   device age
-   IP history
-   transaction time patterns
-   merchant/customer history

### Model monitoring

Track:

-   fraud rate
-   false positives
-   false negatives
-   model drift
-   approval rate
-   chargeback rate

------------------------------------------------------------------------

# 19. Short Project Explanation

**AI Risk Manager is a pre-transaction fraud detection system that
evaluates a payment using behavioural, velocity, geographic/IP,
relationship, and authentication signals. It combines these signals into
a weighted risk score and makes an ALLOW, STEP-UP, or BLOCK decision
before payment order creation. It also provides a merchant
dispute-defense workflow for organizing evidence after a payment
dispute.**

------------------------------------------------------------------------

## Key Idea

``` text
                 PAYMENT
                    |
                    v
       +------------------------+
       |     RISK ENGINE        |
       +------------------------+
          |    |    |    |    |
          v    v    v    v    v
         ML  Velocity Geo Link Auth
          \    |    /    |    /
           \   |   /     |   /
            +--+--+------+--+
                   |
                   v
             CLEARANCE
                   |
        +----------+----------+
        |          |          |
      ALLOW     STEP-UP     BLOCK
        |
        v
      PAYMENT
        |
        v
 DISPUTE DEFENSE
```

**The core idea is simple: don't judge a payment from one signal. Look
at the complete picture before deciding.**
