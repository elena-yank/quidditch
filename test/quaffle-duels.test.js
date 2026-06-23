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
  findPickupDefender
} = require("../src/game-steps");

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

test("pickup defender selection uses post-move pickup positions and chooses the nearest enemy", () => {
  const picker = p("picker", "A", "chaser1", { planned_action_type: "pickup", planned_action_first: false });
  const enemyNear = p("enemyNear", "B", "keeper", { planned_action_type: "keeper_pickup", planned_action_first: false });
  const enemyFar = p("enemyFar", "B", "chaser2");
  const ally = p("ally", "A", "keeper");

  const positions = new Map([
    ["picker", "D5"],
    ["enemyNear", "A1"],
    ["enemyFar", "D9"],
    ["ally", "D6"]
  ]);
  const moved = new Map([
    ["enemyNear", "D8"]
  ]);

  const defenderId = findPickupDefender({
    participants: [picker, enemyNear, enemyFar, ally],
    moveToByIdBeforeActions: moved,
    pickerId: "picker",
    pickerTeam: "A",
    qCoord: "D7",
    positionsById: positions,
    includePostMovePickup: true
  });

  assert.equal(defenderId, "enemyNear");
});
