const {
  nanoidId,
  TURN_TIMEOUT_MS,
  SNITCH_SPAWNS,
  GOALS_LEFT_SET,
  GOALS_RIGHT_SET,
  ENFORCE_QUAFFLE_STEAL_LOCKS
} = require("./constants");
const {
  normalizeCoord,
  randomChoice,
  isChaserRole,
  isKeeperRole,
  isSeekerRole,
  isBeaterRole,
  chebyshevDistance,
  coordToRC,
  rcToCoord
} = require("./utils");
const {
  ALL_COORDS,
  defaultSpawnCoord,
  canPlannedMove,
  normalizePlannedActionType,
  getPositionForParticipant,
  pickSnitchRespawnCoord,
  findNearestFreeCoord,
  moveBludgers,
  moveSnitchOnce,
  hasAnyLegalMove,
  canChaserPickup,
  canChaserThrow,
  canKeeperThrow
} = require("./game-logic");
const { pool } = require("./db");
const { insertGameEvent } = require("./game-events");
const { insertDuelWithParticipants, addParticipantsToDuel, fillAllDuelScores, resolveDuelIfReady, setMaybeAdvanceStep } = require("./duels");

// Устанавливаем функцию для циклического импорта
setMaybeAdvanceStep(maybeAdvanceStep);

async function ensureTurnState(client, gameId, participantId, stepNo) {
  const res = await client.query(
    "SELECT step_no FROM turn_states WHERE game_id = $1 AND participant_id = $2",
    [gameId, participantId]
  );
  const existing = res.rows[0];
  if (!existing) {
    await client.query(
      `
        INSERT INTO turn_states (
          game_id,
          participant_id,
          step_no,
          moved,
          action_reserved,
          action_done,
          ended,
          stunned,
          planned_to,
          planned_action_first,
          planned_action_type,
          planned_action_to,
          planned_action_bludger
        )
        VALUES ($1, $2, $3, FALSE, FALSE, FALSE, FALSE, FALSE, NULL, FALSE, NULL, NULL, NULL)
      `,
      [gameId, participantId, stepNo]
    );
    return;
  }
  if (Number(existing.step_no) !== Number(stepNo)) {
    await client.query(
      `
        UPDATE turn_states
        SET step_no = $3,
            moved = FALSE,
            action_reserved = FALSE,
            action_done = FALSE,
            ended = FALSE,
            stunned = FALSE,
            planned_to = NULL,
            planned_action_first = FALSE,
            planned_action_type = NULL,
            planned_action_to = NULL,
            planned_action_bludger = NULL,
            updated_at = NOW()
        WHERE game_id = $1 AND participant_id = $2
      `,
      [gameId, participantId, stepNo]
    );
  }
}

async function ensureGameStartedEffective(client, gameId, startedRaw) {
  return Boolean(startedRaw);
}

function collectPickupDefenders({
  participants,
  moveToByIdBeforeActions,
  pickerId,
  pickerTeam,
  qCoord,
  positionsById,
  includePostMovePickup
}) {
  const defenderIds = [];
  if (!pickerTeam) return defenderIds;
  for (const pp of participants || []) {
    if (pp.id === pickerId) continue;
    if (Boolean(pp.stunned)) continue;
    if (pp.team === pickerTeam) continue;
    if (!(pp.role === "keeper" || pp.role === "chaser1" || pp.role === "chaser2")) continue;

    let from2 = positionsById.get(pp.id) || null;
    if (includePostMovePickup) {
      const ppType = normalizePlannedActionType(pp.planned_action_type);
      const isPickup = (ppType === "pickup" && isChaserRole(pp.role)) || (ppType === "keeper_pickup" && isKeeperRole(pp.role));
      if (isPickup && !Boolean(pp.planned_action_first)) {
        from2 = moveToByIdBeforeActions.get(pp.id) || null;
        if (!from2) {
          const plannedTo = normalizeCoord(pp.planned_to);
          if (plannedTo) from2 = plannedTo;
        }
        if (!from2) from2 = positionsById.get(pp.id) || null;
      }
    }
    if (!from2) continue;
    const d2 = chebyshevDistance(from2, qCoord);
    if (d2 == null || d2 > 1) continue;
    defenderIds.push(pp.id);
  }
  return defenderIds;
}

function collectStealCandidatesAgainstHolder({
  participants,
  holder,
  holderId,
  holderPos,
  positionsById,
  actionFirst,
  stepNo,
  stealCooldownStepNo,
  lockHolderId,
  lockStepNo
}) {
  if (!holder || !holderId || !holderPos) return [];
  const stealCandidates = [];
  for (const p of participants || []) {
    if (Boolean(p.stunned)) continue;
    const actionType = normalizePlannedActionType(p.planned_action_type);
    if (actionType !== "steal") continue;
    if (!isChaserRole(p.role) && !isKeeperRole(p.role)) continue;
    if (Boolean(p.planned_action_first) !== Boolean(actionFirst)) continue;
    if (holderId === p.id) continue;
    if (ENFORCE_QUAFFLE_STEAL_LOCKS && stealCooldownStepNo != null && stepNo <= stealCooldownStepNo + 1 && stepNo >= stealCooldownStepNo) continue;
    if (ENFORCE_QUAFFLE_STEAL_LOCKS && lockHolderId && lockStepNo != null && stepNo <= lockStepNo + 1 && stepNo >= lockStepNo && holderId === lockHolderId) continue;
    if (holder.team === p.team) continue;
    const attackerPos = positionsById.get(p.id) || null;
    if (!attackerPos) continue;
    const d = chebyshevDistance(attackerPos, holderPos);
    if (d == null || d > 1) continue;
    stealCandidates.push(p.id);
  }
  return stealCandidates;
}

function collectPickupCandidatesAtCoord({ participants, qCoord, positionsById, actionFirst }) {
  const pickupCandidates = [];
  for (const p of participants || []) {
    if (Boolean(p.stunned)) continue;
    if (Boolean(p.planned_action_first) !== Boolean(actionFirst)) continue;
    const actionType = normalizePlannedActionType(p.planned_action_type);
    const isChaserPickup = actionType === "pickup" && isChaserRole(p.role);
    const isKeeperPickup = actionType === "keeper_pickup" && isKeeperRole(p.role);
    if (!isChaserPickup && !isKeeperPickup) continue;
    const from = positionsById.get(p.id);
    if (!from) continue;
    const d = chebyshevDistance(from, qCoord);
    if (d != null && d <= 1) pickupCandidates.push(p.id);
  }
  return pickupCandidates;
}

function isParticipantStunnedThisStep(participant, hitStunnedIds) {
  if (!participant) return false;
  if (Boolean(participant.stunned)) return true;
  return hitStunnedIds instanceof Set && hitStunnedIds.has(participant.id);
}

/**
 * Разрешает коллизии перемещений: два участника не могут занять одну клетку,
 * и участник не может переместиться на клетку, где стоит не-перемещающийся участник.
 */
function resolveMoveCollisions({ participants, fromById, isStunnedNow, gameForSpawn }) {
  const moveToById = new Map();
  const claimedTargets = new Set();
  for (const p of participants) {
    if (isStunnedNow(p)) continue;
    const from = fromById.get(p.id);
    const to = normalizeCoord(p.planned_to);
    if (!from || !to) continue;
    if (!canPlannedMove({ participant: p, from, to, game: gameForSpawn })) continue;
    if (claimedTargets.has(to)) continue;
    moveToById.set(p.id, to);
    claimedTargets.add(to);
  }

  let changed = true;
  while (changed) {
    changed = false;
    const nonMoverPositions = new Set();
    for (const p of participants) {
      const from = fromById.get(p.id);
      if (!from) continue;
      if (!moveToById.has(p.id)) nonMoverPositions.add(from);
    }
    for (const [pid, to] of moveToById.entries()) {
      if (nonMoverPositions.has(to)) {
        moveToById.delete(pid);
        changed = true;
      }
    }
  }

  return moveToById;
}

/**
 * Единая фаза pickup + steal для pre-move и post-move.
 * Определяет кандидатов на pickup, создаёт дуэли при конфликтах,
 * проверяет steal против (возможно нового) holder'а.
 */
async function processPickupAndStealPhase({
  client, gameId, stepNo, participants,
  qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
  positionsById, moveToById, fromById, actionFirst, includePostMovePickup, phase
}) {
  let anyDuelCreated = false;
  const qCoord = normalizeCoord(qPos) || "D7";
  // В pre-move фазе собираем кандидатов на подбор из ОБЕИХ фаз (actionFirst=true и
  // actionFirst=false), чтобы охотник и вратарь, запланировавшие подбор в разные
  // фазы, всё равно конкурировали за свободный квоффл, а не получали его без дуэли.
  // В post-move фазе собираем только из текущей фазы, т.к. actionFirst=true игроки
  // уже имели возможность подобрать квоффл в pre-move.
  //
  // Для actionFirst=false используем позицию ПОСЛЕ перемещения (moveToById),
  // т.к. эти игроки сначала двигаются, потом подбирают квоффл.
  const positionsAfterMove = new Map(positionsById);
  for (const [pid, to] of moveToById) {
    positionsAfterMove.set(pid, to);
  }
  const pickupCandidates = !qHolderId
    ? (phase === "pre"
        ? [...new Set([
            ...collectPickupCandidatesAtCoord({ participants, qCoord, positionsById, actionFirst: true }),
            ...collectPickupCandidatesAtCoord({ participants, qCoord, positionsById: positionsAfterMove, actionFirst: false })
          ])]
        : collectPickupCandidatesAtCoord({ participants, qCoord, positionsById, actionFirst }))
    : [];

  let effectiveHolderId = qHolderId;
  let effectiveQPos = qPos;
  let effectiveLockHolderId = lockHolderId;
  let effectiveLockStepNo = lockStepNo;
  let effectiveStealCooldownStepNo = stealCooldownStepNo;

  let pickupDuelCreated = false;

  if (pickupCandidates.length >= 2) {
    const duelId = nanoidId();
    const insCount = await insertDuelWithParticipants(client, {
      duelId, gameId,
      attackerId: pickupCandidates[0],
      defenderId: pickupCandidates[1] || pickupCandidates[0],
      participantIds: pickupCandidates,
      kind: "pickup",
      targetPos: qCoord,
      createdStepNo: stepNo
    });
    if (insCount > 0) { pickupDuelCreated = true; }
    if (!pickupDuelCreated) {
      pickupDuelCreated = await addParticipantsToDuel(client, {
        gameId, kind: "pickup", newIds: pickupCandidates
      });
    }
  } else if (pickupCandidates.length === 1) {
    // Один кандидат — просто забирает квоффл без дуэли
    const pickerId = pickupCandidates[0];
    effectiveHolderId = pickerId;
    effectiveQPos = null;
    effectiveLockHolderId = pickerId;
    effectiveLockStepNo = stepNo;
    effectiveStealCooldownStepNo = stepNo;
  }

  // Проверяем steal против (возможно нового) holder'а
  let stealDuelCreated = false;
  if (effectiveHolderId) {
    const holder = participants.find((pp) => pp.id === effectiveHolderId) || null;
    if (holder && (isChaserRole(holder.role) || isKeeperRole(holder.role))) {
      // В post-move фазе используем pre-move позицию holder'а (fromById),
      // чтобы атакующий мог перехватить holder'а, который пытается улететь.
      // В pre-move фазе fromById === positionsById, так что поведение не меняется.
      const holderPos = fromById.get(effectiveHolderId) || positionsById.get(effectiveHolderId) || null;

      if (actionFirst) {
        if (holderPos) {
          // В pre-move фазе собираем steal кандидатов из ОБЕИХ фаз (actionFirst=true и
          // actionFirst=false), чтобы игрок, планирующий переместиться к холдеру и украсть
          // квоффл в post-move фазе, всё равно участвовал в дуэли ДО перемещений.
          // Для actionFirst=false используем их позицию ПОСЛЕ перемещения (moveToById),
          // чтобы определить, будут ли они рядом с холдером.
          const stealCandidatesPre = collectStealCandidatesAgainstHolder({
            participants, holder, holderId: effectiveHolderId, holderPos,
            positionsById, actionFirst: true, stepNo,
            stealCooldownStepNo: effectiveStealCooldownStepNo,
            lockHolderId: effectiveLockHolderId, lockStepNo: effectiveLockStepNo
          });

          // Собираем actionFirst=false кандидатов, используя их позицию после перемещения
          const positionsAfterMove = new Map(positionsById);
          for (const [pid, to] of moveToById) {
            positionsAfterMove.set(pid, to);
          }
          const stealCandidatesPost = collectStealCandidatesAgainstHolder({
            participants, holder, holderId: effectiveHolderId, holderPos,
            positionsById: positionsAfterMove, actionFirst: false, stepNo,
            stealCooldownStepNo: effectiveStealCooldownStepNo,
            lockHolderId: effectiveLockHolderId, lockStepNo: effectiveLockStepNo
          });

          const allStealCandidates = [...new Set([...stealCandidatesPre, ...stealCandidatesPost])];

          if (allStealCandidates.length > 0 && !pickupDuelCreated) {
            const duelId = nanoidId();
            const insCount = await insertDuelWithParticipants(client, {
              duelId, gameId,
              attackerId: allStealCandidates[0],
              defenderId: effectiveHolderId,
              participantIds: [effectiveHolderId, ...allStealCandidates],
              kind: "steal",
              targetPos: null,
              createdStepNo: stepNo
            });
            if (insCount > 0) { stealDuelCreated = true; }
            if (!stealDuelCreated) {
              stealDuelCreated = await addParticipantsToDuel(client, {
                gameId, kind: "steal", newIds: [effectiveHolderId, ...allStealCandidates]
              });
            }
          }
        }
      } else {
        const stealCandidatesPost = holderPos
          ? collectStealCandidatesAgainstHolder({
              participants, holder, holderId: effectiveHolderId, holderPos,
              positionsById, actionFirst: false, stepNo,
              stealCooldownStepNo: effectiveStealCooldownStepNo,
              lockHolderId: effectiveLockHolderId, lockStepNo: effectiveLockStepNo
            })
          : [];

        const stealCandidatesPreMove = (!stealDuelCreated && stealCandidatesPost.length === 0 && holderPos)
          ? collectStealCandidatesAgainstHolder({
              participants, holder, holderId: effectiveHolderId, holderPos,
              positionsById, actionFirst: true, stepNo,
              stealCooldownStepNo: effectiveStealCooldownStepNo,
              lockHolderId: effectiveLockHolderId, lockStepNo: effectiveLockStepNo
            })
          : [];

        const allStealCandidates = stealCandidatesPost.length > 0
          ? stealCandidatesPost
          : stealCandidatesPreMove;

        if (allStealCandidates.length > 0 && !pickupDuelCreated) {
          const duelId = nanoidId();
          const insCount = await insertDuelWithParticipants(client, {
            duelId, gameId,
            attackerId: allStealCandidates[0],
            defenderId: effectiveHolderId,
            participantIds: [effectiveHolderId, ...allStealCandidates],
            kind: "steal",
            targetPos: null,
            createdStepNo: stepNo
          });
          if (insCount > 0) { stealDuelCreated = true; }
          if (!stealDuelCreated) {
            stealDuelCreated = await addParticipantsToDuel(client, {
              gameId, kind: "steal", newIds: [effectiveHolderId, ...allStealCandidates]
            });
          }
        }
      }
    }
  }

  if (pickupDuelCreated || stealDuelCreated) {
    anyDuelCreated = true;
  } else if (effectiveHolderId !== qHolderId && pickupCandidates.length === 1) {
    const pickerId = pickupCandidates[0];
    const prevHolderId = qHolderId;
    qHolderId = pickerId;
    qPos = null;
    if (qHolderId && qHolderId !== prevHolderId) {
      lockHolderId = qHolderId;
      lockStepNo = stepNo;
      stealCooldownStepNo = stepNo;
    }
    await client.query("UPDATE participants SET stat_quaffle_pickups = COALESCE(stat_quaffle_pickups, 0) + 1 WHERE id = $1 AND game_id = $2", [
      pickerId, gameId
    ]);
    await insertGameEvent(client, {
      gameId, stepNo,
      kind: "quaffle_pickup",
      actorId: pickerId,
      targetPos: qCoord,
      meta: { phase, finalHolderId: pickerId, finalPos: null }
    });
  }

  return { anyDuelCreated, qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo };
}

/**
 * Собирает кандидатов на throw_steal дуэль для указанной фазы.
 * Вызывается ДО processPlayerActions, чтобы не было необходимости в ROLLBACK.
 */
function collectThrowStealCandidates({
  participants, holderId, holderPos, positionsById, actionFirst, stepNo,
  stealCooldownStepNo, lockHolderId, lockStepNo
}) {
  if (!holderId || !holderPos) return [];
  const holder = participants.find((pp) => pp.id === holderId) || null;
  if (!holder || (!isChaserRole(holder.role) && !isKeeperRole(holder.role))) return [];

  return collectStealCandidatesAgainstHolder({
    participants, holder, holderId, holderPos,
    positionsById, actionFirst, stepNo,
    stealCooldownStepNo, lockHolderId, lockStepNo
  });
}

/**
 * Собирает кандидатов на hit_bludger дуэль для указанного бладжера и фазы.
 */
function collectHitBludgerContenders({
  participants, targetIdx, b1Pos, b2Pos, positionsById, actionFirst, isStunnedNow, qHolderId, qPos
}) {
  const bludgerFrom = targetIdx === 1 ? b1Pos : b2Pos;
  const contenders = [];
  for (const pp of participants) {
    if (isStunnedNow(pp)) continue;
    if (Boolean(pp.planned_action_first) !== Boolean(actionFirst)) continue;
    const ppType = normalizePlannedActionType(pp.planned_action_type);
    if (ppType !== "hit_bludger") continue;
    if (!isBeaterRole(pp.role) && !isKeeperRole(pp.role)) continue;
    const ppIdx = pp.planned_action_bludger != null ? Number(pp.planned_action_bludger) : null;
    if (ppIdx !== targetIdx) continue;
    const ppFrom = positionsById.get(pp.id);
    if (!ppFrom) continue;
    if (chebyshevDistance(ppFrom, bludgerFrom) !== 1) continue;
    const ppTo = normalizeCoord(pp.planned_action_to);
    if (!ppTo) continue;
    if (!qHolderId) {
      const freeQ = normalizeCoord(qPos) || "D7";
      if (ppTo === freeQ) continue;
    }
    const ppA = coordToRC(bludgerFrom);
    const ppT = coordToRC(ppTo);
    if (!ppA || !ppT) continue;
    const ppDr = ppT.r - ppA.r;
    const ppDc = ppT.c - ppA.c;
    const ppAbsR = Math.abs(ppDr);
    const ppAbsC = Math.abs(ppDc);
    const ppDist = Math.max(ppAbsR, ppAbsC);
    const ppStraightOrDiag =
      ((ppAbsR === 0 && ppAbsC > 0) || (ppAbsC === 0 && ppAbsR > 0) || (ppAbsR === ppAbsC && ppAbsR > 0)) && ppDist >= 1 && ppDist <= 3;
    if (!ppStraightOrDiag) continue;
    contenders.push(pp.id);
  }
  return contenders;
}

/**
 * Обработка действий игроков (keeper_pickup, hit_bludger, pass, throw)
 * для pre-move и post-move фаз.
 *
 * ВАЖНО: Эта функция НЕ создаёт дуэли. Все дуэли (pickup, steal, throw_steal, hit_bludger)
 * должны быть созданы ДО вызова этой функции в предварительном проходе.
 */
async function processPlayerActions({
  client, gameId, stepNo, participants, gameForSpawn,
  qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
  b1Pos, b2Pos, bludgersHitThisStep, hitStunnedIds, isStunnedNow,
  positionsById, occupantChaserByCoord, occupantKeeperByCoord, occupantAnyByCoord,
  actionFirst, phase, bludgerDuelSuffix,
  pendingGoalResolution, scoreA, scoreB
}) {
  for (const p of participants) {
    if (isStunnedNow(p)) continue;
    const actionType = normalizePlannedActionType(p.planned_action_type);
    if (!actionType) continue;
    if (Boolean(p.planned_action_first) !== Boolean(actionFirst)) continue;
    const from = positionsById.get(p.id);
    if (!from) continue;

    if (actionType === "keeper_pickup") {
      if (qHolderId) continue;
      if (!isKeeperRole(p.role)) continue;
      const qCoord = normalizeCoord(qPos) || "D7";
      const d = chebyshevDistance(from, qCoord);
      if (d != null && d <= 1) {
        const prevHolderId = qHolderId;
        qHolderId = p.id;
        qPos = null;
        if (qHolderId && qHolderId !== prevHolderId) {
          lockHolderId = qHolderId;
          lockStepNo = stepNo;
          stealCooldownStepNo = stepNo;
        }
        await client.query("UPDATE participants SET stat_quaffle_pickups = COALESCE(stat_quaffle_pickups, 0) + 1 WHERE id = $1 AND game_id = $2", [
          p.id, gameId
        ]);
      }
      continue;
    }

    if (actionType === "hit_bludger") {
      if (!isBeaterRole(p.role) && !isKeeperRole(p.role)) continue;
      const targetIdx = p.planned_action_bludger != null ? Number(p.planned_action_bludger) : null;
      if (targetIdx !== 1 && targetIdx !== 2) continue;
      const bludgerFrom = targetIdx === 1 ? b1Pos : b2Pos;
      if (chebyshevDistance(from, bludgerFrom) !== 1) continue;

      const to = normalizeCoord(p.planned_action_to);
      if (!to) continue;
      if (!qHolderId) {
        const freeQ = normalizeCoord(qPos) || "D7";
        if (to === freeQ) continue;
      }

      const a = coordToRC(bludgerFrom);
      const t = coordToRC(to);
      if (!a || !t) continue;
      const dr = t.r - a.r;
      const dc = t.c - a.c;
      const absR = Math.abs(dr);
      const absC = Math.abs(dc);
      const dist = Math.max(absR, absC);
      const straightOrDiag =
        ((absR === 0 && absC > 0) || (absC === 0 && absR > 0) || (absR === absC && absR > 0)) && dist >= 1 && dist <= 3;
      if (!straightOrDiag) continue;

      // Дуэли hit_bludger создаются в предварительном проходе (collectHitBludgerContenders),
      // поэтому здесь мы просто проверяем, не было ли уже дуэли для этого бладжера
      const existingDuel = await client.query(
        "SELECT id, winner_id FROM duels WHERE game_id = $1 AND created_step_no = $2 AND kind = $3 AND target_pos = $4 AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1",
        [gameId, stepNo, "hit_bludger", `b${targetIdx}:${bludgerDuelSuffix}`]
      );
      const duel = existingDuel.rows[0] || null;
      if (duel && duel.winner_id && p.id !== duel.winner_id) {
        continue;
      }

      if (bludgersHitThisStep.has(targetIdx)) continue;

      const stepR = dr === 0 ? 0 : Math.sign(dr);
      const stepC = dc === 0 ? 0 : Math.sign(dc);
      let endPos = to;
      let hitSomeone = false;
      for (let i = 1; i <= dist; i += 1) {
        const coord = rcToCoord(a.r + stepR * i, a.c + stepC * i);
        if (!coord) break;
        const hitId = occupantAnyByCoord.get(coord) || null;
        if (hitId) {
          endPos = coord;
          hitSomeone = true;
          hitStunnedIds.add(hitId);
          await client.query(
            "INSERT INTO game_events (id, game_id, step_no, kind, actor_id, bludger_idx, target_pos) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [nanoidId(), gameId, stepNo, "stun_bludger", hitId, targetIdx, endPos]
          );
          break;
        }
      }

      if (targetIdx === 1) b1Pos = endPos;
      else b2Pos = endPos;
      bludgersHitThisStep.add(targetIdx);

      await client.query(
        "UPDATE participants SET stat_bludger_hits = COALESCE(stat_bludger_hits, 0) + 1 WHERE id = $1 AND game_id = $2",
        [p.id, gameId]
      );
      if (hitSomeone) {
        await client.query(
          "UPDATE participants SET stat_bludger_hits_to_players = COALESCE(stat_bludger_hits_to_players, 0) + 1 WHERE id = $1 AND game_id = $2",
          [p.id, gameId]
        );
      }

      await client.query(
        "INSERT INTO game_events (id, game_id, step_no, kind, actor_id, bludger_idx, target_pos) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [nanoidId(), gameId, stepNo, "hit_bludger", p.id, targetIdx, endPos]
      );
      continue;
    }

    if (actionType === "pass") {
      if (!isChaserRole(p.role)) continue;
      if (!qHolderId || qHolderId !== p.id) continue;
      const to = normalizeCoord(p.planned_action_to);
      if (!to) continue;
      const receiverId = occupantChaserByCoord.get(to) || null;
      if (!receiverId || receiverId === p.id) continue;
      const receiver = participants.find((pp) => pp.id === receiverId) || null;
      if (!receiver || receiver.team !== p.team) continue;
      const d = chebyshevDistance(from, to);
      if (d == null || d === 0 || d > 2) continue;

      const prevHolderId = qHolderId;
      qHolderId = receiverId;
      qPos = null;
      if (qHolderId !== prevHolderId) {
        lockHolderId = qHolderId;
        lockStepNo = stepNo;
        stealCooldownStepNo = stepNo;
      }
      await client.query("UPDATE participants SET stat_quaffle_passes = COALESCE(stat_quaffle_passes, 0) + 1 WHERE id = $1 AND game_id = $2", [
        p.id, gameId
      ]);
      await insertGameEvent(client, {
        gameId, stepNo,
        kind: "quaffle_pass",
        actorId: p.id,
        targetPos: to,
        meta: { phase, receiverId, fromPos: from, toPos: to }
      });
      continue;
    }

    if (actionType === "throw") {
      if (!qHolderId || qHolderId !== p.id) continue;
      const to = normalizeCoord(p.planned_action_to);
      if (!to) continue;

      const d = chebyshevDistance(from, to);
      if (d == null) continue;

      let nextHolderId = null;
      let nextPos = to;

      const isTeamA = p.team === gameForSpawn.team_a;
      const isTeamB = p.team === gameForSpawn.team_b;
      if (!isTeamA && !isTeamB) continue;

      // throw_steal дуэли создаются в предварительном проходе,
      // поэтому здесь просто проверяем, не было ли уже дуэли
      const existingThrowSteal = await client.query(
        "SELECT id, winner_id FROM duels WHERE game_id = $1 AND created_step_no = $2 AND kind = 'throw_steal' AND target_pos = $3 AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1",
        [gameId, stepNo, `throw:${phase}:${p.id}`]
      );
      const throwStealDuel = existingThrowSteal.rows[0] || null;
      if (throwStealDuel) {
        // Дуэль throw_steal существует — пропускаем бросок, дуэль разрешится отдельно
        continue;
      }

      if (isKeeperRole(p.role)) {
        if (d === 0 || d > 6) continue;
        const chaserId = occupantChaserByCoord.get(to) || null;
        if (chaserId) {
          const receiver = participants.find((pp) => pp.id === chaserId) || null;
          if (receiver) {
            nextHolderId = chaserId;
            nextPos = null;
            if (receiver.team === p.team) {
              await client.query("UPDATE participants SET stat_quaffle_passes = COALESCE(stat_quaffle_passes, 0) + 1 WHERE id = $1 AND game_id = $2", [
                p.id, gameId
              ]);
            }
          }
        }
      } else if (isChaserRole(p.role)) {
        const opponentGoals = isTeamA ? GOALS_RIGHT_SET : GOALS_LEFT_SET;
        if (!opponentGoals.has(to)) continue;
        if (d !== 2) continue;
        const defenderTeam = isTeamA ? gameForSpawn.team_b : gameForSpawn.team_a;
        const keeperId = defenderTeam ? occupantKeeperByCoord.get(to) || null : null;
        if (keeperId) {
          nextHolderId = keeperId;
          nextPos = null;
          await client.query("UPDATE participants SET stat_goals_saved = COALESCE(stat_goals_saved, 0) + 1 WHERE id = $1 AND game_id = $2", [
            keeperId, gameId
          ]);
        } else if (actionFirst) {
          // Pre-move: откладываем проверку гола (pendingGoalResolution)
          nextHolderId = null;
          nextPos = to;
          const keeper = defenderTeam ? participants.find((pp) => pp.team === defenderTeam && isKeeperRole(pp.role)) : null;
          pendingGoalResolution = {
            actorId: p.id,
            defenderTeam,
            keeperId: keeper?.id || null,
            targetPos: to,
            scoringTeam: p.team
          };
        } else {
          // Post-move: гол засчитывается сразу
          nextHolderId = null;
          nextPos = to;
          if (isTeamA) scoreA += 10;
          else if (isTeamB) scoreB += 10;
          const keeper = defenderTeam ? participants.find((pp) => pp.team === defenderTeam && isKeeperRole(pp.role)) : null;
          if (keeper?.id) {
            await insertGameEvent(client, {
              gameId, stepNo,
              kind: "goal",
              actorId: keeper.id,
              targetPos: to,
              meta: { shooterId: p.id, keeperId: keeper.id }
            });
          }
          await client.query("UPDATE participants SET stat_goals_scored = COALESCE(stat_goals_scored, 0) + 1 WHERE id = $1 AND game_id = $2", [
            p.id, gameId
          ]);
        }
      } else {
        continue;
      }

      const prevHolderId = qHolderId;
      qHolderId = nextHolderId;
      qPos = nextPos;
      if (!qHolderId) {
        lockHolderId = null;
        lockStepNo = null;
      } else if (qHolderId !== prevHolderId) {
        lockHolderId = qHolderId;
        lockStepNo = stepNo;
        stealCooldownStepNo = stepNo;
      }

      let outcome;
      if (actionFirst) {
        outcome =
          pendingGoalResolution && pendingGoalResolution.actorId === p.id ? "pending_goal_resolution" :
          nextHolderId && nextHolderId !== p.id ? "caught_by_player" :
          nextPos ? "landed" : "released";
      } else {
        outcome =
          nextHolderId && nextHolderId !== p.id ? "caught_by_player" :
          nextPos && (!isChaserRole(p.role) || !GOALS_LEFT_SET.has(to) && !GOALS_RIGHT_SET.has(to)) ? "landed" :
          nextPos ? "goal" : "released";
      }

      await insertGameEvent(client, {
        gameId, stepNo,
        kind: "quaffle_throw",
        actorId: p.id,
        targetPos: to,
        meta: {
          phase,
          fromPos: from,
          toPos: to,
          receiverId: nextHolderId,
          finalHolderId: nextHolderId,
          finalPos: nextPos,
          outcome
        }
      });
    }
  }

  return {
    qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
    b1Pos, b2Pos, bludgersHitThisStep, hitStunnedIds,
    pendingGoalResolution, scoreA, scoreB
  };
}

/**
 * Создаёт дуэли hit_bludger для указанной фазы, если несколько игроков
 * бьют по одному бладжеру.
 */
async function createHitBludgerDuels({
  client, gameId, stepNo, participants, b1Pos, b2Pos, positionsById,
  actionFirst, isStunnedNow, qHolderId, qPos, bludgerDuelSuffix
}) {
  let anyCreated = false;
  for (const targetIdx of [1, 2]) {
    const contenders = collectHitBludgerContenders({
      participants, targetIdx, b1Pos, b2Pos, positionsById,
      actionFirst, isStunnedNow, qHolderId, qPos
    });
    if (contenders.length >= 2) {
      const duelTarget = `b${targetIdx}:${bludgerDuelSuffix}`;
      const existing = await client.query(
        "SELECT id FROM duels WHERE game_id = $1 AND created_step_no = $2 AND kind = $3 AND target_pos = $4 AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1",
        [gameId, stepNo, "hit_bludger", duelTarget]
      );
      if (!existing.rows[0]) {
        const duelId = nanoidId();
        const insCount = await insertDuelWithParticipants(client, {
          duelId, gameId,
          attackerId: contenders[0],
          defenderId: contenders[1] || contenders[0],
          participantIds: contenders,
          kind: "hit_bludger",
          targetPos: duelTarget,
          createdStepNo: stepNo
        });
        if (insCount > 0) anyCreated = true;
      } else {
        anyCreated = true;
      }
    }
  }
  return anyCreated;
}

/**
 * Создаёт дуэли throw_steal для указанной фазы.
 */
async function createThrowStealDuels({
  client, gameId, stepNo, participants, qHolderId, qPos, positionsById,
  actionFirst, stealCooldownStepNo, lockHolderId, lockStepNo
}) {
  let anyCreated = false;
  if (!qHolderId) return false;

  for (const p of participants) {
    if (Boolean(p.stunned)) continue;
    const actionType = normalizePlannedActionType(p.planned_action_type);
    if (actionType !== "throw") continue;
    if (Boolean(p.planned_action_first) !== Boolean(actionFirst)) continue;
    if (qHolderId !== p.id) continue;
    if (!isChaserRole(p.role) && !isKeeperRole(p.role)) continue;

    const from = positionsById.get(p.id);
    if (!from) continue;

    const holderPos = from;
    const stealCandidates = collectThrowStealCandidates({
      participants, holderId: qHolderId, holderPos, positionsById,
      actionFirst, stepNo, stealCooldownStepNo, lockHolderId, lockStepNo
    });

    if (stealCandidates.length > 0) {
      const targetPos = `throw:${actionFirst ? "pre" : "post"}:${p.id}`;
      const existing = await client.query(
        "SELECT id FROM duels WHERE game_id = $1 AND created_step_no = $2 AND kind = 'throw_steal' AND target_pos = $3 AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1",
        [gameId, stepNo, targetPos]
      );
      if (!existing.rows[0]) {
        const duelId = nanoidId();
        const insCount = await insertDuelWithParticipants(client, {
          duelId, gameId,
          attackerId: stealCandidates[0],
          defenderId: qHolderId,
          participantIds: [qHolderId, ...stealCandidates],
          kind: "throw_steal",
          targetPos,
          createdStepNo: stepNo
        });
        if (insCount > 0) anyCreated = true;
      } else {
        anyCreated = true;
      }
    }
  }
  return anyCreated;
}

async function expireOldTurns(gameId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const gameRes = await client.query(
      "SELECT id, step_no, step_started_at, started, finished, paused FROM games WHERE id = $1 FOR UPDATE",
      [gameId]
    );
    const game = gameRes.rows[0] || null;
    if (!game) {
      await client.query("COMMIT");
      return { changed: false };
    }
    if (Boolean(game.finished) || Boolean(game.paused)) {
      await client.query("COMMIT");
      return { changed: false };
    }

    const startedEffective = await ensureGameStartedEffective(client, gameId, Boolean(game.started));
    if (!startedEffective) {
      await client.query("COMMIT");
      return { changed: false };
    }

    const stepNo = Number(game.step_no || 1);
    const stepStartedAtMs = game.step_started_at ? new Date(game.step_started_at).getTime() : NaN;
    if (!Number.isFinite(stepStartedAtMs)) {
      await client.query("UPDATE games SET step_started_at = NOW() WHERE id = $1", [gameId]);
      await client.query("COMMIT");
      return { changed: true };
    }
    if (Date.now() - stepStartedAtMs < TURN_TIMEOUT_MS) {
      await client.query("COMMIT");
      return { changed: false };
    }

    const activeRes = await client.query(
      `
        SELECT p.id
        FROM participants p
        WHERE p.game_id = $1 AND p.is_observer = FALSE AND p.role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')
      `,
      [gameId]
    );
    const activeIds = activeRes.rows.map((r) => r.id);
    if (activeIds.length === 0) {
      await client.query("COMMIT");
      return { changed: false };
    }

    for (const pid of activeIds) {
      await ensureTurnState(client, gameId, pid, stepNo);
    }

    const upd = await client.query(
      `
        UPDATE turn_states
        SET ended = TRUE,
            moved = FALSE,
            action_reserved = FALSE,
            action_done = FALSE,
            planned_to = NULL,
            planned_action_first = FALSE,
            planned_action_type = NULL,
            planned_action_to = NULL,
            planned_action_bludger = NULL,
            updated_at = NOW()
        WHERE game_id = $1 AND step_no = $2 AND ended = FALSE
      `,
      [gameId, stepNo]
    );

    await maybeAdvanceStep(client, gameId);
    await client.query("COMMIT");
    return { changed: upd.rowCount > 0 };
  } catch (e) {
    console.error("[expireOldTurns] failed", { gameId, error: e, stack: e?.stack });
    await client.query("ROLLBACK");
    return { changed: false };
  } finally {
    client.release();
  }
}

async function forceExpireTurnsIfTimedOutClient(client, gameRow) {
  if (!gameRow) return { expired: false };
  if (Boolean(gameRow.finished) || Boolean(gameRow.paused)) return { expired: false };
  if (!Boolean(gameRow.started)) return { expired: false };

  const gameId = gameRow.game_id || gameRow.id;
  if (!gameId) return { expired: false };

  const stepNo = Number(gameRow.step_no || 1);
  const stepStartedAtMs = gameRow.step_started_at ? new Date(gameRow.step_started_at).getTime() : NaN;
  if (!Number.isFinite(stepStartedAtMs)) {
    await client.query("UPDATE games SET step_started_at = NOW() WHERE id = $1", [gameId]);
    return { expired: false };
  }
  if (Date.now() - stepStartedAtMs < TURN_TIMEOUT_MS) return { expired: false };

  const activeRes = await client.query(
    `
      SELECT p.id
      FROM participants p
      WHERE p.game_id = $1 AND p.is_observer = FALSE AND p.role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')
    `,
    [gameId]
  );
  const activeIds = activeRes.rows.map((r) => r.id);
  for (const pid of activeIds) {
    await ensureTurnState(client, gameId, pid, stepNo);
  }

  await client.query(
    `
      UPDATE turn_states
      SET ended = TRUE,
          moved = FALSE,
          action_reserved = FALSE,
          action_done = FALSE,
          planned_to = NULL,
          planned_action_first = FALSE,
          planned_action_type = NULL,
          planned_action_to = NULL,
          planned_action_bludger = NULL,
          updated_at = NOW()
      WHERE game_id = $1 AND step_no = $2 AND ended = FALSE
    `,
    [gameId, stepNo]
  );

  try {
    await maybeAdvanceStep(client, gameId);
  } catch (stepError) {
    console.error("[forceExpireTurnsIfTimedOutClient] maybeAdvanceStep failed", { gameId, error: stepError, stack: stepError?.stack });
  }
  return { expired: true };
}

/**
 * Загружает и подготавливает всё состояние для выполнения шага.
 */
async function prepareStepState(client, gameId) {
  const gameRes = await client.query(
    "SELECT step_no, started, finished, winner_team, score_a, score_b, snitch_pos, snitch_revealed, snitch_caught_by_id, snitch_caught_step_no, snitch_reveal_count, snitch_hide_count, quaffle_pos, quaffle_holder_id, quaffle_lock_holder_id, quaffle_lock_step_no, quaffle_steal_cooldown_step_no, bludger1_pos, bludger2_pos, team_a, team_b FROM games WHERE id = $1",
    [gameId]
  );
  const gameRow = gameRes.rows[0];
  const stepNo = Number(gameRow?.step_no || 1);

  const activeRes = await client.query(
    "SELECT p.id FROM participants p WHERE p.game_id = $1 AND p.is_observer = FALSE AND p.role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')",
    [gameId]
  );
  const activeIds = activeRes.rows.map((r) => r.id);

  const participantsRes = await client.query(
    `
      SELECT p.id, p.nickname, p.team, p.role, p.pos, p.is_bot, p.created_at,
             p.snitch_progress,
             ts.planned_to, ts.planned_action_first, ts.planned_action_type, ts.planned_action_to, ts.planned_action_bludger, ts.stunned, ts.moved, ts.action_done
      FROM participants p
      JOIN turn_states ts ON ts.game_id = p.game_id AND ts.participant_id = p.id
      WHERE p.game_id = $1 AND p.id = ANY($2::text[]) AND ts.step_no = $3
      ORDER BY p.created_at ASC
    `,
    [gameId, activeIds, stepNo]
  );
  const participants = participantsRes.rows;
  const gameForSpawn = { id: gameId, team_a: gameRow.team_a, team_b: gameRow.team_b };

  const fromById = new Map();
  for (const p of participants) {
    const from = getPositionForParticipant(p, gameForSpawn);
    if (from) fromById.set(p.id, from);
  }

  const actionPosById = new Map();
  for (const p of participants) {
    const pos = fromById.get(p.id);
    if (!pos) continue;
    actionPosById.set(p.id, pos);
  }

  const occupantChaserByCoord = new Map();
  const occupantKeeperByCoord = new Map();
  const occupantAnyByCoord = new Map();
  for (const p of participants) {
    const pos = actionPosById.get(p.id);
    if (!pos) continue;
    occupantAnyByCoord.set(pos, p.id);
    if (p.role === "chaser1" || p.role === "chaser2") occupantChaserByCoord.set(pos, p.id);
    if (p.role === "keeper") occupantKeeperByCoord.set(pos, p.id);
  }

  return {
    gameRow, stepNo, activeIds, participants, gameForSpawn,
    fromById, actionPosById,
    occupantChaserByCoord, occupantKeeperByCoord, occupantAnyByCoord,
    qHolderId: gameRow?.quaffle_holder_id || null,
    qPos: gameRow?.quaffle_holder_id ? null : (normalizeCoord(gameRow?.quaffle_pos) || "D7"),
    lockHolderId: gameRow?.quaffle_lock_holder_id || null,
    lockStepNo: gameRow?.quaffle_lock_step_no != null ? Number(gameRow.quaffle_lock_step_no) : null,
    stealCooldownStepNo: gameRow?.quaffle_steal_cooldown_step_no != null ? Number(gameRow.quaffle_steal_cooldown_step_no) : null,
    b1Pos: normalizeCoord(gameRow?.bludger1_pos) || "A7",
    b2Pos: normalizeCoord(gameRow?.bludger2_pos) || "G7",
    snitchPos: normalizeCoord(gameRow?.snitch_pos) || randomChoice(SNITCH_SPAWNS) || "A7",
    snitchRevealed: Boolean(gameRow?.snitch_revealed),
    snitchCaughtById: gameRow?.snitch_caught_by_id || null,
    snitchCaughtStepNo: gameRow?.snitch_caught_step_no != null ? Number(gameRow.snitch_caught_step_no) : null,
    snitchRevealCount: gameRow?.snitch_reveal_count != null ? Number(gameRow.snitch_reveal_count) : 0,
    snitchHideCount: gameRow?.snitch_hide_count != null ? Number(gameRow.snitch_hide_count) : 0,
    scoreA: gameRow?.score_a != null ? Number(gameRow.score_a) : 0,
    scoreB: gameRow?.score_b != null ? Number(gameRow.score_b) : 0
  };
}

/**
 * Применяет перемещения участников и возвращает posById и occupied.
 */
async function applyMovement(client, gameId, participants, fromById, isStunnedNow, gameForSpawn, allMoved, stepNo, activeIds) {
  const posById = new Map();
  const occupied = new Set();
  let moveToById;

  if (!allMoved) {
    moveToById = resolveMoveCollisions({ participants, fromById, isStunnedNow, gameForSpawn });

    const movers = [];
    for (const p of participants) {
      const from = fromById.get(p.id);
      const to = moveToById.get(p.id);
      const finalPos = to || from || null;
      if (finalPos) {
        posById.set(p.id, finalPos);
        occupied.add(finalPos);
      }
      if (!from || !to) continue;
      if (to === from) continue;
      movers.push({ id: p.id, to });
    }

    for (const m of movers) {
      await client.query(
        "UPDATE participants SET pos = $2 WHERE id = $1 AND game_id = $3 AND is_observer = FALSE",
        [m.id, `TMP_${m.id}`, gameId]
      );
    }
    for (const m of movers) {
      await client.query(
        "UPDATE participants SET pos = $2 WHERE id = $1 AND game_id = $3 AND is_observer = FALSE",
        [m.id, m.to, gameId]
      );
    }

    await client.query(
      "UPDATE turn_states SET moved = TRUE, updated_at = NOW() WHERE game_id = $1 AND step_no = $2 AND participant_id = ANY($3::text[])",
      [gameId, stepNo, activeIds]
    );
  } else {
    for (const p of participants) {
      const pos = fromById.get(p.id);
      if (!pos) continue;
      posById.set(p.id, pos);
      occupied.add(pos);
    }
  }

  return { posById, occupied, moveToById };
}

/**
 * Обрабатывает pending goal resolution после перемещений.
 */
function resolvePendingGoal(pendingGoalResolution, qHolderId, qPos, occupantKeeperByCoordAfter, gameForSpawn) {
  if (!pendingGoalResolution || qHolderId) return { pendingGoalResolution, qHolderId, qPos, scoreA: 0, scoreB: 0, lockHolderId: null, lockStepNo: null, stealCooldownStepNo: null };

  const targetPos = normalizeCoord(qPos) || pendingGoalResolution.targetPos;
  if (targetPos !== pendingGoalResolution.targetPos) return { pendingGoalResolution, qHolderId, qPos };

  const keeperIdAtTarget = occupantKeeperByCoordAfter.get(targetPos) || null;
  if (keeperIdAtTarget) {
    return {
      pendingGoalResolution: null,
      qHolderId: keeperIdAtTarget,
      qPos: null,
      lockHolderId: keeperIdAtTarget,
      lockStepNo: null, // будет установлено в maybeAdvanceStep
      stealCooldownStepNo: null,
      savedByKeeper: true,
      keeperIdAtTarget,
      actorId: pendingGoalResolution.actorId,
      targetPos
    };
  }

  const scoringTeam = pendingGoalResolution.scoringTeam;
  const scoreDelta = scoringTeam === gameForSpawn.team_a ? 10 : (scoringTeam === gameForSpawn.team_b ? 10 : 0);
  return {
    pendingGoalResolution: null,
    qHolderId: null,
    qPos: targetPos,
    lockHolderId: null,
    lockStepNo: null,
    stealCooldownStepNo: null,
    scored: true,
    scoreDelta,
    actorId: pendingGoalResolution.actorId,
    keeperId: pendingGoalResolution.keeperId,
    targetPos
  };
}

/**
 * Обрабатывает бладжеров: движение, оглушение, выпадение квоффла.
 */
function processBludgersAndStun({
  b1Pos, b2Pos, bludgersHitThisStep, hitStunnedIds, participants, posById, qHolderId, qPos, occupied, lockHolderId, lockStepNo, stealCooldownStepNo, stepNo
}) {
  const freeQuafflePos = qHolderId ? null : (normalizeCoord(qPos) || "D7");
  const restingLockedBludgers = new Set();
  const restingLockedTargets = new Set();
  const stunnedOrHitNow = (p) => Boolean(p.stunned) || hitStunnedIds.has(p.id);
  for (const p of participants) {
    if (!stunnedOrHitNow(p)) continue;
    const pos = posById.get(p.id);
    if (!pos) continue;
    if (pos === b1Pos) {
      restingLockedBludgers.add(1);
      restingLockedTargets.add(`${p.id}:1`);
    }
    if (pos === b2Pos) {
      restingLockedBludgers.add(2);
      restingLockedTargets.add(`${p.id}:2`);
    }
  }

  const nextBludgerLocks = new Set(bludgersHitThisStep);
  for (const idx of restingLockedBludgers) nextBludgerLocks.add(idx);
  const nextBludgers = moveBludgers({
    bludger1Pos: b1Pos,
    bludger2Pos: b2Pos,
    forbidden: freeQuafflePos,
    locked: nextBludgerLocks
  });

  const stunnedSet = new Set(hitStunnedIds);
  for (const p of participants) {
    const pos = posById.get(p.id);
    if (!pos) continue;
    const hit1 = pos === nextBludgers.bludger1Pos;
    const hit2 = pos === nextBludgers.bludger2Pos;
    if (!hit1 && !hit2) continue;
    if ((hit1 && restingLockedTargets.has(`${p.id}:1`)) || (hit2 && restingLockedTargets.has(`${p.id}:2`))) continue;
    if (stunnedSet.has(p.id)) continue;
    stunnedSet.add(p.id);
  }

  let nextQuaffleHolderId = qHolderId || null;
  let nextQuafflePos = nextQuaffleHolderId ? null : (normalizeCoord(qPos) || "D7");
  if (nextQuaffleHolderId && stunnedSet.has(nextQuaffleHolderId)) {
    const holderPos = posById.get(nextQuaffleHolderId);
    const drop = holderPos ? findNearestFreeCoord(holderPos, occupied) : null;
    nextQuaffleHolderId = null;
    nextQuafflePos = drop || "D7";
  }
  let nextLockHolderId = nextQuaffleHolderId ? (lockHolderId || nextQuaffleHolderId) : null;
  let nextLockStepNo = nextQuaffleHolderId ? (lockStepNo != null ? lockStepNo : stepNo) : null;
  let nextStealCooldownStepNo = nextQuaffleHolderId ? (stealCooldownStepNo != null ? stealCooldownStepNo : stepNo) : null;

  return {
    nextBludgers,
    stunnedSet,
    nextQuaffleHolderId,
    nextQuafflePos,
    nextLockHolderId,
    nextLockStepNo,
    nextStealCooldownStepNo,
    restingLockedTargets
  };
}

/**
 * Обрабатывает снитч: движение, видимость, прогресс поимки.
 */
function processSnitchPhase({
  snitchPos, snitchRevealed, snitchCaughtById, snitchCaughtStepNo,
  participants, posById, occupied, stepNo, gameForSpawn, isStunnedNow,
  planned_to_list
}) {
  const snitchForbidden = new Set(occupied);
  for (const reserved of planned_to_list) {
    if (reserved) snitchForbidden.add(reserved);
  }

  let nextSnitchPos = snitchPos;
  let nextSnitchRevealed = snitchRevealed;
  let nextSnitchCaughtById = snitchCaughtById;
  let nextSnitchCaughtStepNo = snitchCaughtStepNo;

  if (snitchCaughtById) {
    nextSnitchRevealed = false;
    const shouldRespawn = snitchCaughtStepNo != null && stepNo >= snitchCaughtStepNo + 3;
    if (shouldRespawn) {
      const seekerPositions = participants
        .filter((p) => isSeekerRole(p.role) && !isStunnedNow(p))
        .map((p) => posById.get(p.id) || getPositionForParticipant(p, gameForSpawn) || null)
        .filter(Boolean);
      const seekerA = seekerPositions[0] || null;
      const seekerB = seekerPositions[1] || null;
      nextSnitchPos = pickSnitchRespawnCoord({ seekerA, seekerB, forbidden: snitchForbidden });
      nextSnitchRevealed = false;
      nextSnitchCaughtById = null;
      nextSnitchCaughtStepNo = null;
    }
  } else {
    nextSnitchPos = moveSnitchOnce(snitchPos, snitchForbidden) || snitchPos;
  }

  nextSnitchPos = normalizeCoord(nextSnitchPos) || nextSnitchPos;
  if (nextSnitchPos && snitchForbidden.has(nextSnitchPos)) {
    const fixed = findNearestFreeCoord(nextSnitchPos, snitchForbidden);
    nextSnitchPos = fixed || pickSnitchRespawnCoord({ seekerA: null, seekerB: null, forbidden: snitchForbidden });
  }

  let snitchDuelCreated = false;
  let snitchCaughtNow = false;
  let snitchCatcherId = null;
  let snitchCatcherTeam = null;
  const seekerUpdates = [];

  if (!nextSnitchCaughtById) {
    const seekerDistances = participants
      .filter((p) => isSeekerRole(p.role) && !isStunnedNow(p))
      .map((p) => {
        const from = posById.get(p.id);
        if (!from) return null;
        const d = chebyshevDistance(from, nextSnitchPos);
        if (d == null) return null;
        return { participant: p, distance: d };
      })
      .filter(Boolean);

    const anyNear = seekerDistances.some(({ distance }) => distance <= 2);
    const allFar = seekerDistances.length === 0 ? true : seekerDistances.every(({ distance }) => distance >= 3);
    if (!snitchRevealed && anyNear) nextSnitchRevealed = true;
    else if (snitchRevealed && allFar) nextSnitchRevealed = false;

    if (nextSnitchRevealed) {
      const reachers = [];

      for (const { participant, distance } of seekerDistances) {
        const delta = distance <= 1 ? 10 : distance <= 2 ? 5 : 0;
        if (delta <= 0) continue;
        const current = participant.snitch_progress != null ? Math.max(0, Number(participant.snitch_progress) || 0) : 0;
        const next = Math.min(100, current + delta);
        if (next !== current) seekerUpdates.push({ id: participant.id, next });
        if (next >= 100) reachers.push({ id: participant.id, team: participant.team });
      }

      if (reachers.length >= 2) {
        snitchDuelCreated = true;
      }

      if (reachers.length === 1) {
        snitchCaughtNow = true;
        snitchCatcherId = reachers[0].id;
        snitchCatcherTeam = reachers[0].team || null;
        nextSnitchCaughtById = snitchCatcherId;
        nextSnitchCaughtStepNo = stepNo;
        nextSnitchRevealed = false;
      }
    }
  }

  return {
    nextSnitchPos,
    nextSnitchRevealed,
    nextSnitchCaughtById,
    nextSnitchCaughtStepNo,
    snitchForbidden,
    snitchDuelCreated,
    snitchCaughtNow,
    snitchCatcherId,
    snitchCatcherTeam,
    seekerUpdates
  };
}

/**
 * Сохраняет финальное состояние шага в БД.
 */
async function finalizeStep({
  client, gameId, stepNo, nextStep, participants, gameForSpawn,
  activeIds, posById, stunnedSet,
  nextQuaffleHolderId, nextQuafflePos,
  nextLockHolderId, nextLockStepNo, nextStealCooldownStepNo,
  nextBludgers,
  nextSnitchPos, nextSnitchRevealed, nextSnitchCaughtById, nextSnitchCaughtStepNo,
  snitchRevealCount, snitchHideCount,
  scoreA, scoreB,
  snitchDuelCreated, snitchCaughtNow, snitchCatcherId, snitchCatcherTeam,
  anyDuelCreated, depth
}) {
  const winA = scoreA >= 100;
  const winB = scoreB >= 100;
  const finishedNow = winA || winB;
  let winnerTeam = null;
  if (finishedNow) {
    if (winA && !winB) winnerTeam = gameForSpawn.team_a;
    else if (winB && !winA) winnerTeam = gameForSpawn.team_b;
    else if (winA && winB) winnerTeam = scoreA === scoreB ? null : (scoreA > scoreB ? gameForSpawn.team_a : gameForSpawn.team_b);
  }

  const snapshotState = {
    stepNo,
    scoreA, scoreB,
    quaffleHolderId: nextQuaffleHolderId,
    quafflePos: nextQuafflePos,
    bludger1Pos: nextBludgers.bludger1Pos,
    bludger2Pos: nextBludgers.bludger2Pos,
    snitchPos: nextSnitchPos,
    snitchRevealed: nextSnitchRevealed,
    snitchCaughtById: nextSnitchCaughtById,
    teamA: gameForSpawn.team_a,
    teamB: gameForSpawn.team_b,
    participants: participants.map(p => ({
      id: p.id,
      nickname: p.nickname,
      team: p.team,
      role: p.role,
      pos: posById.get(p.id) || null,
      isBot: Boolean(p.is_bot),
      stunned: stunnedSet.has(p.id),
      snitchProgress: p.snitch_progress != null ? Math.max(0, Math.min(100, Number(p.snitch_progress) || 0)) : 0
    }))
  };

  await client.query(
    "INSERT INTO game_state_snapshots (id, game_id, step_no, state) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    [nanoidId(), gameId, stepNo, JSON.stringify(snapshotState)]
  );

  await client.query(
    `UPDATE games SET step_no = $2, step_started_at = NOW(), score_a = $3, score_b = $4,
     finished = $5, finished_at = CASE WHEN $5 THEN COALESCE(finished_at, NOW()) ELSE finished_at END,
     winner_team = CASE WHEN $5 THEN $6 ELSE winner_team END,
     snitch_pos = $7, snitch_revealed = $8, snitch_caught_by_id = $9, snitch_caught_step_no = $10,
     bludger1_pos = $11, bludger2_pos = $12,
     quaffle_holder_id = $13, quaffle_pos = $14,
     quaffle_lock_holder_id = $15, quaffle_lock_step_no = $16, quaffle_steal_cooldown_step_no = $17,
     snitch_reveal_count = $18, snitch_hide_count = $19
     WHERE id = $1`,
    [
      gameId, nextStep, scoreA, scoreB,
      finishedNow, winnerTeam,
      nextSnitchPos, nextSnitchRevealed, nextSnitchCaughtById, nextSnitchCaughtStepNo,
      nextBludgers.bludger1Pos, nextBludgers.bludger2Pos,
      nextQuaffleHolderId, nextQuafflePos,
      nextLockHolderId, nextLockStepNo, nextStealCooldownStepNo,
      snitchRevealCount, snitchHideCount
    ]
  );

  await client.query(
    `UPDATE turn_states
     SET step_no = $2, moved = FALSE, action_reserved = FALSE, action_done = FALSE,
         ended = FALSE, stunned = FALSE,
         planned_to = NULL, planned_action_first = FALSE,
         planned_action_type = NULL, planned_action_to = NULL, planned_action_bludger = NULL,
         updated_at = NOW()
     WHERE game_id = $1 AND participant_id = ANY($3::text[])`,
    [gameId, nextStep, activeIds]
  );

  const stunnedIds = Array.from(stunnedSet);
  if (stunnedIds.length > 0) {
    await client.query(
      `UPDATE turn_states
       SET ended = TRUE, stunned = TRUE, updated_at = NOW()
       WHERE game_id = $1 AND step_no = $2 AND participant_id = ANY($3::text[])`,
      [gameId, nextStep, stunnedIds]
    );
  }

  // Если все оглушены — пропускаем шаг
  if (stunnedIds.length === activeIds.length) {
    await maybeAdvanceStep(client, gameId, depth + 1);
  }

  // Если были дуэли — разрешаем их и пробуем продвинуть шаг снова
  if (anyDuelCreated || snitchDuelCreated) {
    const activeDuelsRes = await client.query(
      "SELECT id, game_id, attacker_id, defender_id, participant_ids, kind, target_pos, created_step_no, started_at, attacker_score, defender_score, resolved_at, winner_id FROM duels WHERE game_id = $1 AND resolved_at IS NULL FOR UPDATE",
      [gameId]
    );
    for (const duelRow of activeDuelsRes.rows) {
      await fillAllDuelScores(client, duelRow);
    }
    await maybeAdvanceStep(client, gameId, depth + 1);
  }
}

async function maybeAdvanceStep(client, gameId, depth = 0) {
  if (depth > 6) return;

  // Проверка: все ли завершили ход
  const gameRes = await client.query(
    "SELECT step_no, started, finished FROM games WHERE id = $1",
    [gameId]
  );
  const stepNo = Number(gameRes.rows[0]?.step_no || 1);
  if (Boolean(gameRes.rows[0]?.finished)) return;

  const activeRes = await client.query(
    "SELECT p.id FROM participants p WHERE p.game_id = $1 AND p.is_observer = FALSE AND p.role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')",
    [gameId]
  );
  const activeIds = activeRes.rows.map((r) => r.id);
  if (activeIds.length === 0) return;

  for (const pid of activeIds) {
    await ensureTurnState(client, gameId, pid, stepNo);
  }

  const endedRes = await client.query(
    "SELECT COUNT(*)::int AS ended_count FROM turn_states WHERE game_id = $1 AND step_no = $2 AND ended = TRUE",
    [gameId, stepNo]
  );
  const endedCount = Number(endedRes.rows[0]?.ended_count || 0);
  if (endedCount < activeIds.length) return;

  // Проверка: нет ли активных дуэлей (кроме hit_bludger, которые разрешаются сразу)
  const activeDuelRes = await client.query(
    "SELECT id FROM duels WHERE game_id = $1 AND kind IN ('steal', 'pickup', 'throw_steal', 'snitch') AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1",
    [gameId]
  );
  if (activeDuelRes.rows[0]) return;

  // === ПОДГОТОВКА СОСТОЯНИЯ ===
  const state = await prepareStepState(client, gameId);
  const {
    gameRow, participants, gameForSpawn,
    fromById, actionPosById,
    occupantChaserByCoord, occupantKeeperByCoord, occupantAnyByCoord
  } = state;

  let {
    qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
    b1Pos, b2Pos, snitchPos, snitchRevealed,
    snitchCaughtById, snitchCaughtStepNo,
    snitchRevealCount, snitchHideCount,
    scoreA, scoreB
  } = state;

  const allMoved = participants.every((p) => Boolean(p.moved));
  let hitStunnedIds = new Set();
  const isStunnedNow = (participant) => isParticipantStunnedThisStep(participant, hitStunnedIds);
  const moveToByIdBeforeActions = resolveMoveCollisions({ participants, fromById, isStunnedNow, gameForSpawn });
  let anyDuelCreated = false;
  let pendingGoalResolution = null;
  let bludgersHitThisStep = new Set();

  // === PRE-MOVE ФАЗА: сбор кандидатов на дуэли ===

  // 1. Pickup + Steal (pre-move)
  const prePickupResult = await processPickupAndStealPhase({
    client, gameId, stepNo, participants,
    qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
    positionsById: actionPosById,
    moveToById: moveToByIdBeforeActions,
    fromById,
    actionFirst: true,
    includePostMovePickup: true,
    phase: "pre"
  });
  if (prePickupResult.anyDuelCreated) {
    anyDuelCreated = true;
  }
  qHolderId = prePickupResult.qHolderId;
  qPos = prePickupResult.qPos;
  lockHolderId = prePickupResult.lockHolderId;
  lockStepNo = prePickupResult.lockStepNo;
  stealCooldownStepNo = prePickupResult.stealCooldownStepNo;

  // 2. Throw steal (pre-move)
  if (qHolderId) {
    const throwStealCreated = await createThrowStealDuels({
      client, gameId, stepNo, participants,
      qHolderId, qPos, positionsById: actionPosById,
      actionFirst: true,
      stealCooldownStepNo, lockHolderId, lockStepNo
    });
    if (throwStealCreated) anyDuelCreated = true;
  }

  // 3. Hit bludger (pre-move)
  const hitBludgerCreated = await createHitBludgerDuels({
    client, gameId, stepNo, participants,
    b1Pos, b2Pos, positionsById: actionPosById,
    actionFirst: true, isStunnedNow,
    qHolderId, qPos, bludgerDuelSuffix: "pre"
  });
  if (hitBludgerCreated) anyDuelCreated = true;

  // Если есть дуэли — завершаем pre-move, не применяя действия
  // Дуэли будут разрешены позже, когда игроки отправят свои счета
  if (anyDuelCreated) {
    // Обновляем состояние игры в БД (pickup мог изменить holder'а)
    await client.query(
      `UPDATE games SET quaffle_holder_id = $2, quaffle_pos = $3,
       quaffle_lock_holder_id = $4, quaffle_lock_step_no = $5, quaffle_steal_cooldown_step_no = $6
       WHERE id = $1`,
      [gameId, qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo]
    );
    return;
  }

  // === PRE-MOVE ФАЗА: действия игроков (без дуэлей) ===
  {
    const preActionsResult = await processPlayerActions({
      client, gameId, stepNo, participants, gameForSpawn,
      qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
      b1Pos, b2Pos, bludgersHitThisStep, hitStunnedIds, isStunnedNow,
      positionsById: actionPosById,
      occupantChaserByCoord, occupantKeeperByCoord, occupantAnyByCoord,
      actionFirst: true,
      phase: "pre",
      bludgerDuelSuffix: "pre",
      pendingGoalResolution, scoreA, scoreB
    });
    qHolderId = preActionsResult.qHolderId;
    qPos = preActionsResult.qPos;
    lockHolderId = preActionsResult.lockHolderId;
    lockStepNo = preActionsResult.lockStepNo;
    stealCooldownStepNo = preActionsResult.stealCooldownStepNo;
    b1Pos = preActionsResult.b1Pos;
    b2Pos = preActionsResult.b2Pos;
    bludgersHitThisStep = preActionsResult.bludgersHitThisStep;
    hitStunnedIds = preActionsResult.hitStunnedIds;
    pendingGoalResolution = preActionsResult.pendingGoalResolution;
    scoreA = preActionsResult.scoreA;
    scoreB = preActionsResult.scoreB;
  }

  // === ПЕРЕМЕЩЕНИЯ ===
  const { posById, occupied } = await applyMovement(client, gameId, participants, fromById, isStunnedNow, gameForSpawn, allMoved, stepNo, activeIds);

  // Строим occupant-карты после перемещений
  const occupantChaserByCoordAfter = new Map();
  const occupantKeeperByCoordAfter = new Map();
  const occupantAnyByCoordAfter = new Map();
  for (const p of participants) {
    const pos = posById.get(p.id);
    if (!pos) continue;
    occupantAnyByCoordAfter.set(pos, p.id);
    if (p.role === "chaser1" || p.role === "chaser2") occupantChaserByCoordAfter.set(pos, p.id);
    if (p.role === "keeper") occupantKeeperByCoordAfter.set(pos, p.id);
  }

  // === PENDING GOAL RESOLUTION (до post-move дуэлей, чтобы не потерять при early return) ===
  if (pendingGoalResolution && !qHolderId) {
    const goalResult = resolvePendingGoal(pendingGoalResolution, qHolderId, qPos, occupantKeeperByCoordAfter, gameForSpawn);
    if (goalResult.savedByKeeper) {
      qHolderId = goalResult.qHolderId;
      qPos = goalResult.qPos;
      lockHolderId = goalResult.lockHolderId;
      lockStepNo = stepNo;
      stealCooldownStepNo = stepNo;
      await client.query("UPDATE participants SET stat_goals_saved = COALESCE(stat_goals_saved, 0) + 1 WHERE id = $1 AND game_id = $2", [
        goalResult.keeperIdAtTarget, gameId
      ]);
      await insertGameEvent(client, {
        gameId, stepNo,
        kind: "quaffle_throw_result",
        actorId: goalResult.actorId,
        targetPos: goalResult.targetPos,
        meta: {
          outcome: "saved_by_keeper",
          keeperId: goalResult.keeperIdAtTarget,
          finalHolderId: goalResult.keeperIdAtTarget,
          finalPos: null
        }
      });
    } else if (goalResult.scored) {
      if (goalResult.scoringTeam === gameForSpawn.team_a) scoreA += 10;
      else if (goalResult.scoringTeam === gameForSpawn.team_b) scoreB += 10;
      if (goalResult.keeperId) {
        await insertGameEvent(client, {
          gameId, stepNo,
          kind: "goal",
          actorId: goalResult.keeperId,
          targetPos: goalResult.targetPos,
          meta: { shooterId: goalResult.actorId, keeperId: goalResult.keeperId }
        });
      }
      await client.query("UPDATE participants SET stat_goals_scored = COALESCE(stat_goals_scored, 0) + 1 WHERE id = $1 AND game_id = $2", [
        goalResult.actorId, gameId
      ]);
      await insertGameEvent(client, {
        gameId, stepNo,
        kind: "quaffle_throw_result",
        actorId: goalResult.actorId,
        targetPos: goalResult.targetPos,
        meta: {
          outcome: "goal",
          keeperId: goalResult.keeperId,
          finalHolderId: null,
          finalPos: goalResult.targetPos
        }
      });
    }
    pendingGoalResolution = null;
  }

  // === POST-MOVE ФАЗА: сбор кандидатов на дуэли ===

  // 1. Pickup + Steal (post-move)
  const postPickupResult = await processPickupAndStealPhase({
    client, gameId, stepNo, participants,
    qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
    positionsById: posById,
    moveToById: new Map(),
    fromById,
    actionFirst: false,
    includePostMovePickup: false,
    phase: "post"
  });
  if (postPickupResult.anyDuelCreated) {
    anyDuelCreated = true;
  }
  qHolderId = postPickupResult.qHolderId;
  qPos = postPickupResult.qPos;
  lockHolderId = postPickupResult.lockHolderId;
  lockStepNo = postPickupResult.lockStepNo;
  stealCooldownStepNo = postPickupResult.stealCooldownStepNo;

  // 2. Throw steal (post-move)
  if (qHolderId) {
    const throwStealCreated = await createThrowStealDuels({
      client, gameId, stepNo, participants,
      qHolderId, qPos, positionsById: posById,
      actionFirst: false,
      stealCooldownStepNo, lockHolderId, lockStepNo
    });
    if (throwStealCreated) anyDuelCreated = true;
  }

  // 3. Hit bludger (post-move)
  const hitBludgerCreatedPost = await createHitBludgerDuels({
    client, gameId, stepNo, participants,
    b1Pos, b2Pos, positionsById: posById,
    actionFirst: false, isStunnedNow,
    qHolderId, qPos, bludgerDuelSuffix: "post"
  });
  if (hitBludgerCreatedPost) anyDuelCreated = true;

  // === СНИТЧ (обрабатывается до early return, чтобы дуэли снитча
  // могли создаваться параллельно с дуэлями за квоффл и бладжеры) ===
  const plannedToList = participants.map((p) => normalizeCoord(p.planned_to)).filter(Boolean);
  const snitchResult = processSnitchPhase({
    snitchPos, snitchRevealed, snitchCaughtById, snitchCaughtStepNo,
    participants, posById, occupied, stepNo, gameForSpawn, isStunnedNow,
    planned_to_list: plannedToList
  });

  const {
    nextSnitchPos, nextSnitchRevealed,
    nextSnitchCaughtById: nextSnitchCaughtByIdResult,
    nextSnitchCaughtStepNo: nextSnitchCaughtStepNoResult,
    snitchDuelCreated, snitchCaughtNow, snitchCatcherId, snitchCatcherTeam,
    seekerUpdates
  } = snitchResult;

  // Обновляем snitchRevealCount/snitchHideCount
  if (!snitchRevealed && nextSnitchRevealed) snitchRevealCount += 1;
  else if (snitchRevealed && !nextSnitchRevealed && !nextSnitchCaughtByIdResult) snitchHideCount += 1;

  // Если снитч пойман — обновляем счёт
  if (snitchCaughtNow && snitchCatcherTeam) {
    if (snitchCatcherTeam === gameForSpawn.team_a) scoreA += 30;
    else if (snitchCatcherTeam === gameForSpawn.team_b) scoreB += 30;
  }

  // Сохраняем прогресс поимки снитча для ловцов
  if (seekerUpdates && seekerUpdates.length > 0) {
    for (const upd of seekerUpdates) {
      await client.query(
        "UPDATE participants SET snitch_progress = $1 WHERE id = $2 AND game_id = $3",
        [upd.next, upd.id, gameId]
      );
    }
    // Обновляем in-memory participants для корректного snapshotState
    const updMap = new Map(seekerUpdates.map((u) => [u.id, u.next]));
    for (const p of participants) {
      if (updMap.has(p.id)) {
        p.snitch_progress = updMap.get(p.id);
      }
    }
  }

  // Если снитч респавнится — сбрасываем прогресс
  if (snitchCaughtById && !nextSnitchCaughtByIdResult) {
    await client.query("UPDATE participants SET snitch_progress = 0 WHERE game_id = $1 AND role = 'seeker'", [gameId]);
  }

  // Если снитч пойман — обновляем статистику
  if (snitchCaughtNow && snitchCatcherId) {
    await client.query(
      "UPDATE participants SET stat_snitch_catches = COALESCE(stat_snitch_catches, 0) + 1 WHERE id = $1 AND game_id = $2",
      [snitchCatcherId, gameId]
    );
  }

  // Если дуэль снитча — создаём её
  if (snitchDuelCreated) {
    const reachers = participants
      .filter((p) => isSeekerRole(p.role) && !isStunnedNow(p))
      .filter((p) => {
        const from = posById.get(p.id);
        if (!from) return false;
        const d = chebyshevDistance(from, nextSnitchPos);
        return d != null && d <= 2;
      })
      .filter((p) => {
        const current = p.snitch_progress != null ? Math.max(0, Number(p.snitch_progress) || 0) : 0;
        const from = posById.get(p.id);
        if (!from) return false;
        const d = chebyshevDistance(from, nextSnitchPos);
        const delta = d <= 1 ? 10 : 5;
        return current + delta >= 100;
      });

    if (reachers.length >= 2) {
      const a = reachers[0].id;
      const b = reachers[1].id;
      const duelId = nanoidId();
      const insCount = await insertDuelWithParticipants(client, {
        duelId, gameId,
        attackerId: a,
        defenderId: b,
        participantIds: [a, b],
        kind: "snitch",
        targetPos: nextSnitchPos,
        createdStepNo: stepNo
      });
      if (insCount > 0) {
        await client.query("UPDATE participants SET snitch_progress = 100 WHERE game_id = $1 AND id = ANY($2::text[])", [gameId, [a, b]]);
        anyDuelCreated = true;
      }
    }
  }

  // Если есть дуэли — завершаем post-move, не применяя действия
  // Дуэли будут разрешены позже, когда игроки отправят свои счета
  if (anyDuelCreated) {
    await client.query(
      `UPDATE games SET quaffle_holder_id = $2, quaffle_pos = $3,
       quaffle_lock_holder_id = $4, quaffle_lock_step_no = $5, quaffle_steal_cooldown_step_no = $6,
       snitch_pos = $7, snitch_revealed = $8, snitch_caught_by_id = $9, snitch_caught_step_no = $10,
       snitch_reveal_count = $11, snitch_hide_count = $12
       WHERE id = $1`,
      [gameId, qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
       nextSnitchPos, nextSnitchRevealed, nextSnitchCaughtByIdResult, nextSnitchCaughtStepNoResult,
       snitchRevealCount, snitchHideCount]
    );
    return;
  }

  // === AUTO KEEPER PICKUP ===
  if (!pendingGoalResolution && !qHolderId) {
    const qCoord = normalizeCoord(qPos) || "D7";
    const keeperIdAtQuaffle = occupantKeeperByCoordAfter.get(qCoord) || null;
    if (keeperIdAtQuaffle) {
      const prevHolderId = qHolderId;
      qHolderId = keeperIdAtQuaffle;
      qPos = null;
      if (qHolderId && qHolderId !== prevHolderId) {
        lockHolderId = qHolderId;
        lockStepNo = stepNo;
        stealCooldownStepNo = stepNo;
      }
      await client.query(
        "UPDATE participants SET stat_quaffle_pickups = COALESCE(stat_quaffle_pickups, 0) + 1 WHERE id = $1 AND game_id = $2",
        [keeperIdAtQuaffle, gameId]
      );
      await insertGameEvent(client, {
        gameId, stepNo,
        kind: "quaffle_pickup",
        actorId: keeperIdAtQuaffle,
        targetPos: qCoord,
        meta: { phase: "post_auto_keeper", finalHolderId: keeperIdAtQuaffle, finalPos: null }
      });
    }
  }

  // === POST-MOVE ФАЗА: действия игроков ===
  {
    const postActionsResult = await processPlayerActions({
      client, gameId, stepNo, participants, gameForSpawn,
      qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
      b1Pos, b2Pos, bludgersHitThisStep, hitStunnedIds, isStunnedNow,
      positionsById: posById,
      occupantChaserByCoord: occupantChaserByCoordAfter,
      occupantKeeperByCoord: occupantKeeperByCoordAfter,
      occupantAnyByCoord: occupantAnyByCoordAfter,
      actionFirst: false,
      phase: "post",
      bludgerDuelSuffix: "post",
      pendingGoalResolution, scoreA, scoreB
    });
    qHolderId = postActionsResult.qHolderId;
    qPos = postActionsResult.qPos;
    lockHolderId = postActionsResult.lockHolderId;
    lockStepNo = postActionsResult.lockStepNo;
    stealCooldownStepNo = postActionsResult.stealCooldownStepNo;
    b1Pos = postActionsResult.b1Pos;
    b2Pos = postActionsResult.b2Pos;
    bludgersHitThisStep = postActionsResult.bludgersHitThisStep;
    hitStunnedIds = postActionsResult.hitStunnedIds;
    pendingGoalResolution = postActionsResult.pendingGoalResolution;
    scoreA = postActionsResult.scoreA;
    scoreB = postActionsResult.scoreB;
  }

  // === БЛАДЖЕРЫ ===
  const bludgerResult = processBludgersAndStun({
    b1Pos, b2Pos, bludgersHitThisStep, hitStunnedIds,
    participants, posById, qHolderId, qPos, occupied,
    lockHolderId, lockStepNo, stealCooldownStepNo, stepNo
  });

  const {
    nextBludgers, stunnedSet,
    nextQuaffleHolderId, nextQuafflePos,
    nextLockHolderId, nextLockStepNo, nextStealCooldownStepNo,
    restingLockedTargets
  } = bludgerResult;

  // === ФИНАЛИЗАЦИЯ ===
  const nextStep = stepNo + 1;
  await finalizeStep({
    client, gameId, stepNo, nextStep, participants, gameForSpawn,
    activeIds, posById, stunnedSet,
    nextQuaffleHolderId, nextQuafflePos,
    nextLockHolderId, nextLockStepNo, nextStealCooldownStepNo,
    nextBludgers,
    nextSnitchPos, nextSnitchRevealed,
    nextSnitchCaughtById: nextSnitchCaughtByIdResult,
    nextSnitchCaughtStepNo: nextSnitchCaughtStepNoResult,
    snitchRevealCount, snitchHideCount,
    scoreA, scoreB,
    snitchDuelCreated, snitchCaughtNow, snitchCatcherId, snitchCatcherTeam,
    anyDuelCreated, depth
  });
}

async function canChaserSteal({ client, from, participant, game, tsById }) {
  const holderId = game.quaffle_holder_id;
  if (!holderId) return false;
  if (holderId === participant.id) return false;

  const stealCooldownStepNo =
    game.quaffle_steal_cooldown_step_no != null ? Number(game.quaffle_steal_cooldown_step_no) : null;
  const stepNo = game.step_no != null ? Number(game.step_no) : null;
  if (ENFORCE_QUAFFLE_STEAL_LOCKS && stealCooldownStepNo != null && stepNo != null) {
    if (stepNo >= stealCooldownStepNo && stepNo <= stealCooldownStepNo + 1) return false;
  }

  const lockHolderId = game.quaffle_lock_holder_id || null;
  const lockStepNo = game.quaffle_lock_step_no != null ? Number(game.quaffle_lock_step_no) : null;
  if (ENFORCE_QUAFFLE_STEAL_LOCKS && lockHolderId && lockStepNo != null && stepNo != null) {
    if (holderId === lockHolderId && stepNo >= lockStepNo && stepNo <= lockStepNo + 1) return false;
  }

  const holderRes = await client.query(
    "SELECT id, team, role, pos, is_observer FROM participants WHERE id = $1 AND game_id = $2",
    [holderId, game.id]
  );
  const holder = holderRes.rows[0];
  if (!holder || holder.is_observer) return false;
  if (!isChaserRole(holder.role) && !isKeeperRole(holder.role)) return false;
  if (holder.team === participant.team) return false;

  const holderPos =
    getPositionForParticipant(holder, game) ||
    defaultSpawnCoord({ role: holder.role, team: holder.team, teamA: game.team_a, teamB: game.team_b });
  if (!holderPos) return false;

  const d = chebyshevDistance(from, holderPos);
  if (d == null || d > 1) return false;

  const holderTs = tsById.get(holderId);
  if (!holderTs) return false;
  if (holderTs.ended) return false;
  if (holderTs.action_reserved) return false;

  return true;
}

async function canKeeperSteal({ client, from, participant, game, tsById }) {
  const holderId = game.quaffle_holder_id;
  if (!holderId) return false;
  if (holderId === participant.id) return false;

  const stealCooldownStepNo =
    game.quaffle_steal_cooldown_step_no != null ? Number(game.quaffle_steal_cooldown_step_no) : null;
  const stepNo = game.step_no != null ? Number(game.step_no) : null;
  if (ENFORCE_QUAFFLE_STEAL_LOCKS && stealCooldownStepNo != null && stepNo != null) {
    if (stepNo >= stealCooldownStepNo && stepNo <= stealCooldownStepNo + 1) return false;
  }

  const lockHolderId = game.quaffle_lock_holder_id || null;
  const lockStepNo = game.quaffle_lock_step_no != null ? Number(game.quaffle_lock_step_no) : null;
  if (ENFORCE_QUAFFLE_STEAL_LOCKS && lockHolderId && lockStepNo != null && stepNo != null) {
    if (holderId === lockHolderId && stepNo >= lockStepNo && stepNo <= lockStepNo + 1) return false;
  }

  const holderRes = await client.query(
    "SELECT id, team, role, pos, is_observer FROM participants WHERE id = $1 AND game_id = $2",
    [holderId, game.id]
  );
  const holder = holderRes.rows[0];
  if (!holder || holder.is_observer) return false;
  if (!isChaserRole(holder.role) && !isKeeperRole(holder.role)) return false;
  if (holder.team === participant.team) return false;

  const holderPos =
    getPositionForParticipant(holder, game) ||
    defaultSpawnCoord({ role: holder.role, team: holder.team, teamA: game.team_a, teamB: game.team_b });
  if (!holderPos) return false;

  const d = chebyshevDistance(from, holderPos);
  if (d == null || d > 1) return false;

  const holderTs = tsById.get(holderId);
  if (!holderTs) return false;
  if (holderTs.ended) return false;
  if (holderTs.action_reserved) return false;

  return true;
}

async function autoEndTurnsInGame(client, gameId) {
  const gameRes = await client.query(
    "SELECT id, team_a, team_b, quaffle_pos, quaffle_holder_id, quaffle_lock_holder_id, quaffle_lock_step_no, quaffle_steal_cooldown_step_no, bludger1_pos, bludger2_pos, snitch_pos, snitch_caught_by_id, step_no FROM games WHERE id = $1 FOR UPDATE",
    [gameId]
  );
  const game = gameRes.rows[0];
  if (!game) return;
  const stepNo = Number(game.step_no || 1);

  const participantsRes = await client.query(
    `
      SELECT p.id, p.team, p.role, p.pos, p.is_observer
      FROM participants p
      WHERE p.game_id = $1 AND p.is_observer = FALSE AND p.role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')
    `,
    [gameId]
  );
  const participants = participantsRes.rows;
  if (participants.length === 0) return;

  for (const p of participants) {
    await ensureTurnState(client, gameId, p.id, stepNo);
  }

  const tsRes = await client.query(
    `
      SELECT participant_id, moved, action_reserved, action_done, ended
      FROM turn_states
      WHERE game_id = $1 AND step_no = $2
    `,
    [gameId, stepNo]
  );
  const tsById = new Map(tsRes.rows.map((r) => [r.participant_id, r]));

  const occupied = new Set();
  for (const p of participants) {
    const pos = getPositionForParticipant(p, game);
    if (pos) occupied.add(pos);
  }

  // Добавляем позиции мячей в occupied
  if (!game.quaffle_holder_id) {
    const qPos = normalizeCoord(game.quaffle_pos);
    if (qPos) occupied.add(qPos);
  }
  const b1 = normalizeCoord(game.bludger1_pos);
  const b2 = normalizeCoord(game.bludger2_pos);
  if (b1) occupied.add(b1);
  if (b2) occupied.add(b2);
  if (!game.snitch_caught_by_id) {
    const sPos = normalizeCoord(game.snitch_pos);
    if (sPos) occupied.add(sPos);
  }

  for (const p of participants) {
    const ts = tsById.get(p.id);
    if (!ts || ts.ended) continue;

    if (ts.action_reserved && !ts.action_done) continue;

    const from = getPositionForParticipant(p, game);
    if (!from) continue;

    const occupiedWithoutMe = new Set(occupied);
    occupiedWithoutMe.delete(from);

    const moveRemaining = !ts.moved && hasAnyLegalMove({ participant: p, from, occupied: occupiedWithoutMe, game });

    let actionRemaining = false;
    if (!ts.action_reserved) {
      if (isChaserRole(p.role)) {
        actionRemaining =
          canChaserPickup({ from, game }) ||
          canChaserThrow({ from, participant: p, game }) ||
          (await canChaserSteal({ client, from, participant: p, game, tsById }));
      } else if (isBeaterRole(p.role)) {
        const b1 = normalizeCoord(game.bludger1_pos) || "A7";
        const b2 = normalizeCoord(game.bludger2_pos) || "G7";
        actionRemaining = chebyshevDistance(from, b1) === 1 || chebyshevDistance(from, b2) === 1;
      } else if (isKeeperRole(p.role)) {
        const b1 = normalizeCoord(game.bludger1_pos) || "A7";
        const b2 = normalizeCoord(game.bludger2_pos) || "G7";
        const canHitBludger = chebyshevDistance(from, b1) === 1 || chebyshevDistance(from, b2) === 1;
        actionRemaining =
          canKeeperThrow({ from, participant: p, game }) ||
          canHitBludger ||
          (await canKeeperSteal({ client, from, participant: p, game, tsById }));
      }
    }

    if (!moveRemaining && !actionRemaining) {
      await client.query(
        "UPDATE turn_states SET ended = TRUE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2",
        [gameId, p.id]
      );
    }
  }

  try {
    await maybeAdvanceStep(client, gameId);
  } catch (stepError) {
    console.error("[autoEndTurnsInGame] maybeAdvanceStep failed", { gameId, error: stepError, stack: stepError?.stack });
  }
}

module.exports = {
  maybeAdvanceStep,
  expireOldTurns,
  ensureTurnState,
  ensureGameStartedEffective,
  forceExpireTurnsIfTimedOutClient,
  autoEndTurnsInGame,
  collectPickupDefenders,
  collectStealCandidatesAgainstHolder,
  collectPickupCandidatesAtCoord,
  canChaserSteal,
  canKeeperSteal,
  isParticipantStunnedThisStep
};
