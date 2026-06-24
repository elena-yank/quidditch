const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

for (const fileName of [".env.voice-host", ".env.voice-host.example", ".env.voice-stack.example", ".env.voice-stack"]) {
  const envPath = path.join(__dirname, "..", fileName);
  if (!fs.existsSync(envPath)) continue;
  dotenv.config({ path: envPath, override: true });
  if (process.env.DATABASE_URL) break;
}

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectStealCandidatesAgainstHolder,
  collectPickupCandidatesAtCoord,
  collectPickupDefenders,
  isParticipantStunnedThisStep
} = require("../src/game-steps");
const { pickDuelWinner } = require("../src/duels");

function p(id, team, role, extra = {}) {
  return {
    id,
    team,
    role,
    stunned: false,
    planned_action_type: null,
    planned_action_first: false,
    ...extra
  };
}

test("pre-move steal against a stationary quaffle holder still creates steal candidates", () => {
  const holder = p("holder", "A", "chaser1");
  const attacker = p("attacker", "B", "chaser2", { planned_action_type: "steal", planned_action_first: true });
  const ally = p("ally", "A", "keeper", { planned_action_type: "steal", planned_action_first: true });
  const far = p("far", "B", "keeper", { planned_action_type: "steal", planned_action_first: true });
  const positions = new Map([
    ["holder", "D7"],
    ["attacker", "D6"],
    ["ally", "D8"],
    ["far", "A1"]
  ]);

  const candidates = collectStealCandidatesAgainstHolder({
    participants: [holder, attacker, ally, far],
    holder,
    holderId: holder.id,
    holderPos: "D7",
    positionsById: positions,
    actionFirst: true,
    stepNo: 5,
    stealCooldownStepNo: null,
    lockHolderId: null,
    lockStepNo: null
  });

  assert.deepEqual(candidates, ["attacker"]);
});

test("throw_steal uses the same adjacency rules before the throw", () => {
  const holder = p("keeperA", "A", "keeper");
  const attacker1 = p("chaserB", "B", "chaser1", { planned_action_type: "steal", planned_action_first: true });
  const attacker2 = p("keeperB", "B", "keeper", { planned_action_type: "steal", planned_action_first: true });
  const positions = new Map([
    ["keeperA", "D7"],
    ["chaserB", "C6"],
    ["keeperB", "E7"]
  ]);

  const candidates = collectStealCandidatesAgainstHolder({
    participants: [holder, attacker1, attacker2],
    holder,
    holderId: holder.id,
    holderPos: "D7",
    positionsById: positions,
    actionFirst: true,
    stepNo: 8,
    stealCooldownStepNo: null,
    lockHolderId: null,
    lockStepNo: null
  });

  assert.deepEqual(candidates, ["chaserB", "keeperB"]);
});

test("post-move steal only sees attackers from the matching action phase", () => {
  const holder = p("holder", "A", "chaser1");
  const pre = p("pre", "B", "chaser2", { planned_action_type: "steal", planned_action_first: true });
  const post = p("post", "B", "keeper", { planned_action_type: "steal", planned_action_first: false });
  const positions = new Map([
    ["holder", "E5"],
    ["pre", "E4"],
    ["post", "D5"]
  ]);

  const candidates = collectStealCandidatesAgainstHolder({
    participants: [holder, pre, post],
    holder,
    holderId: holder.id,
    holderPos: "E5",
    positionsById: positions,
    actionFirst: false,
    stepNo: 11,
    stealCooldownStepNo: null,
    lockHolderId: null,
    lockStepNo: null
  });

  assert.deepEqual(candidates, ["post"]);
});

test("steal candidates ignore same-team and stunned contenders", () => {
  const holder = p("holder", "A", "chaser1");
  const attacker = p("attacker", "B", "chaser2", { planned_action_type: "steal", planned_action_first: true });
  const ally = p("ally", "A", "keeper", { planned_action_type: "steal", planned_action_first: true });
  const stunned = p("stunned", "B", "keeper", { planned_action_type: "steal", planned_action_first: true, stunned: true });
  const positions = new Map([
    ["holder", "D7"],
    ["attacker", "D6"],
    ["ally", "D8"],
    ["stunned", "C7"]
  ]);

  const candidates = collectStealCandidatesAgainstHolder({
    participants: [holder, attacker, ally, stunned],
    holder,
    holderId: holder.id,
    holderPos: "D7",
    positionsById: positions,
    actionFirst: true,
    stepNo: 6,
    stealCooldownStepNo: null,
    lockHolderId: null,
    lockStepNo: null
  });

  assert.deepEqual(candidates, ["attacker"]);
});

test("pickup duel collects all adjacent pre-move contenders around a free quaffle", () => {
  const a = p("a", "A", "chaser1", { planned_action_type: "pickup", planned_action_first: true });
  const b = p("b", "B", "chaser2", { planned_action_type: "pickup", planned_action_first: true });
  const c = p("c", "A", "keeper", { planned_action_type: "keeper_pickup", planned_action_first: true });
  const stunned = p("stunned", "B", "chaser1", { planned_action_type: "pickup", planned_action_first: true, stunned: true });
  const positions = new Map([
    ["a", "D6"],
    ["b", "D8"],
    ["c", "E7"],
    ["stunned", "C7"]
  ]);

  const candidates = collectPickupCandidatesAtCoord({
    participants: [a, b, c, stunned],
    qCoord: "D7",
    positionsById: positions,
    actionFirst: true
  });

  assert.deepEqual(candidates, ["a", "b", "c"]);
});

test("pickup defender selection uses post-move pickup positions and includes every eligible enemy", () => {
  const picker = p("picker", "A", "chaser1", { planned_action_type: "pickup", planned_action_first: false });
  const enemyNear = p("enemyNear", "B", "keeper", { planned_action_type: "keeper_pickup", planned_action_first: false });
  const enemyAlsoNear = p("enemyAlsoNear", "B", "chaser2");
  const enemyFar = p("enemyFar", "B", "chaser2");
  const ally = p("ally", "A", "keeper");

  const positions = new Map([
    ["picker", "D5"],
    ["enemyNear", "A1"],
    ["enemyAlsoNear", "E7"],
    ["enemyFar", "D9"],
    ["ally", "D6"]
  ]);
  const moved = new Map([
    ["enemyNear", "D8"]
  ]);

  const defenderIds = collectPickupDefenders({
    participants: [picker, enemyNear, enemyAlsoNear, enemyFar, ally],
    moveToByIdBeforeActions: moved,
    pickerId: "picker",
    pickerTeam: "A",
    qCoord: "D7",
    positionsById: positions,
    includePostMovePickup: true
  });

  assert.deepEqual(defenderIds, ["enemyNear", "enemyAlsoNear"]);
});

test("fresh bludger stun marks a player inactive for the rest of the current step", () => {
  const participant = p("runner", "A", "chaser1");
  const hitStunnedIds = new Set(["runner"]);

  assert.equal(isParticipantStunnedThisStep(participant, hitStunnedIds), true);
});

test("tie for best steal score keeps quaffle with current holder", () => {
  const scoreById = new Map([
    ["holder", 72],
    ["stealer1", 90],
    ["stealer2", 90]
  ]);

  const outcome = pickDuelWinner({
    kind: "steal",
    participantIds: ["holder", "stealer1", "stealer2"],
    scoreById,
    attackerId: "stealer1",
    defenderId: "holder"
  });

  assert.equal(outcome.winnerId, "holder");
  assert.equal(outcome.topTie, true);
  assert.equal(outcome.tiePolicy, "holder_keeps_control");
});

test("tie for best pickup score leaves free quaffle on the field", () => {
  const scoreById = new Map([
    ["pickerA", 88],
    ["pickerB", 88],
    ["defender", 50]
  ]);

  const outcome = pickDuelWinner({
    kind: "pickup",
    participantIds: ["pickerA", "pickerB", "defender"],
    scoreById,
    attackerId: "pickerA",
    defenderId: "defender"
  });

  assert.equal(outcome.winnerId, null);
  assert.equal(outcome.topTie, true);
  assert.equal(outcome.tiePolicy, "free_quaffle_remains");
});
