/**
 * Aggregates all five risk scores using calibrated weights into an overall decision.
 */

export const WEIGHTS = {
  ml_score: 0.35,
  velocity_score: 0.20,
  geo_score: 0.15,
  graph_score: 0.15,
  auth_score: 0.15,
};

export function combineScores(scores) {
  let overall = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    overall += (scores[key]?.score || 0) * weight;
  }
  overall = Math.round(overall * 10) / 10;

  let decision = "allow";
  if (overall <= 30) {
    decision = "allow";
  } else if (overall <= 70) {
    decision = "step_up";
  } else {
    decision = "block";
  }

  const reasons = Object.keys(WEIGHTS)
    .map((key) => scores[key]?.reason)
    .filter(Boolean);

  const breakdown = {};
  for (const key of Object.keys(WEIGHTS)) {
    breakdown[key] = scores[key]?.score || 0;
  }

  return {
    overall_score: overall,
    decision,
    breakdown,
    reasons,
  };
}
