import test from "node:test";
import assert from "node:assert/strict";
import {
  recommendationEvidenceChannel,
  recommendationMatchesIdea,
  suggestedIdeaTitle,
} from "./recommendationIdeaMatch";

test("recommendation evidence channels follow the exact play mapping", () => {
  assert.equal(
    recommendationEvidenceChannel({
      status: "proposed",
      playType: "Community Engagement",
    }),
    "ugc",
  );
  assert.equal(
    recommendationEvidenceChannel({
      status: "proposed",
      playType: "Listicle & Review Outreach",
    }),
    "review_listicle",
  );
  assert.equal(
    recommendationEvidenceChannel({
      status: "insufficient",
      playType: "Community Engagement",
    }),
    null,
  );
});

test("maps each research play to one exact Ideas-library title", () => {
  assert.equal(
    suggestedIdeaTitle({
      status: "proposed",
      playType: "Community Engagement",
    }),
    "Reddit AMA on your money topics",
  );
});

test("does not map insufficient or unknown recommendations", () => {
  assert.equal(
    suggestedIdeaTitle({
      status: "insufficient",
      playType: "Community Engagement",
    }),
    null,
  );
  assert.equal(
    suggestedIdeaTitle({ status: "proposed", playType: "Unknown play" }),
    null,
  );
});

test("rejects loosely related idea titles", () => {
  const recommendation = {
    status: "proposed",
    playType: "Digital PR",
  };
  assert.equal(
    recommendationMatchesIdea(recommendation, {
      title: "Data PR: exclusive proprietary stats to a tier-1 publication",
    }),
    true,
  );
  assert.equal(
    recommendationMatchesIdea(recommendation, {
      title: "Rapid-response expert quote desk for journalists",
    }),
    false,
  );
});