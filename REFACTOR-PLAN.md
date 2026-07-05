# Верификация плана рефакторинга против трёх ситуаций

## Ситуация 1: 4 охотника пытаются подобрать свободный квоффл

### Как работает сейчас (pre-move фаза, строки 519–671):

1. `qHolderId = null`, `qPos = "D7"` (квоффл свободен)
2. `collectPickupCandidatesAtCoord({ actionFirst: true })` — собирает всех охотников (4 шт.), кто заявил `pickup` с `actionFirst=true` и находится рядом с `qPos`
3. `prePickupCandidates.length >= 2` → создаётся **pickup дуэль** со всеми 4 участниками
4. `prePickupDuelCreated = true`
5. Проверка steal: `preEffectiveHolderId = qHolderId = null` → **steal не проверяется** (строка 597: `if (preEffectiveHolderId)`)
6. `anyDuelCreated = true` → `maybeAdvanceStep` завершается, ждёт разрешения дуэли
7. После разрешения дуэли в `resolveDuelIfReady` (duels.js:440) победитель получает квоффл
8. `maybeAdvanceStep` вызывается снова, теперь `qHolderId` установлен

**Важно:** Дуэль за pickup НЕ блокирует остальных игроков — `maybeAdvanceStep` проверяет только `activeDuelRes` (строка 368–372) для дуэлей `steal`, `pickup`, `throw_steal`. Если есть активная pickup дуэль, шаг не продвигается.

### Как изменится после рефакторинга:

- `processPickupAndStealPhase({ actionFirst: true, phase: "pre" })` будет содержать ту же логику
- `collectPickupCandidatesAtCoord` остаётся без изменений
- Создание pickup дуэли с 4+ участниками — без изменений
- **Никакой логической разницы** — код просто вынесен в функцию

### Вердикт: ✅ Безопасно

---

## Ситуация 2: Охотник 1 Гриффиндора с квоффлом, Охотник 2 Пуффендуя хочет украсть

### Как работает сейчас:

**Pre-move фаза (строки 519–671):**
1. `qHolderId = "охотник1_гриф"`, `qPos = null`
2. `prePickupCandidates = []` (квоффл занят)
3. `preEffectiveHolderId = qHolderId = "охотник1_гриф"`
4. Проверка steal: `collectStealCandidatesAgainstHolder({ actionFirst: true })`
   - Охотник 2 Пуффендуя заявил `steal` с `actionFirst=true`
   - Он находится рядом с холдером (после перемещения или до)
   - → создаётся **steal дуэль**
5. `anyDuelCreated = true` → ждём разрешения дуэли

**После разрешения дуэли:**
- В `resolveDuelIfReady` (duels.js:659) победитель получает квоффл
- `maybeAdvanceStep` вызывается снова

**Применение перемещений (строки 990–1064):**
- Все перемещения применяются, включая перемещение Охотника 1 и Охотника 2
- Перемещения НЕ зависят от результата дуэли — они применяются всегда

**Post-move фаза (строки 1093–1290):**
- Проверяет pickup/steal с `actionFirst=false`

### Как изменится после рефакторинга:

1. `processPickupAndStealPhase({ actionFirst: true, phase: "pre" })` — создаёт steal дуэль
2. `processPlayerActions({ actionFirst: true, phase: "pre" })` — ничего (нет pre-move действий у этих игроков)
3. `applyMoves()` — применяет все перемещения
4. `processPickupAndStealPhase({ actionFirst: false, phase: "post" })` — проверяет post-move steal
5. `processPlayerActions({ actionFirst: false, phase: "post" })` — обрабатывает post-move действия

**Ключевой момент:** Перемещения применяются ДО post-move фазы, но ПОСЛЕ создания дуэли. Это полностью соответствует текущей логике — дуэль создаётся в pre-move фазе, а перемещения применяются после.

### Вердикт: ✅ Безопасно

---

## Ситуация 3: Гол, квоффл в воротах, 3 игрока пытаются подобрать

### Как работает сейчас:

**Pre-move фаза:**
1. После гола: `qHolderId = null`, `qPos = "D1"` (ворота Пуффендуя)
2. `collectPickupCandidatesAtCoord({ actionFirst: true })` — собирает тех, кто заявил `pickup` с `actionFirst=true`
3. Если все 3 заявили `actionFirst=true` → создаётся pickup дуэль с 3 участниками
4. Если кто-то заявил `actionFirst=false` → он попадёт в post-move фазу

**Важный нюанс:** Вратарь Пуффендуя использует `keeper_pickup`, а не `pickup`. Это отдельный тип действия, который обрабатывается в блоке `keeper_pickup` (строки 682–701 для pre-move, 1406–1426 для post-move), а НЕ в unified pickup+steal фазе.

**Текущая логика для `keeper_pickup`:**
- Pre-move (строка 682): если вратарь заявил `keeper_pickup` с `actionFirst=true` и находится рядом с `qPos` → забирает квоффл
- Post-move (строка 1406): если вратарь заявил `keeper_pickup` с `actionFirst=false` → забирает квоффл

**НО:** Если вратарь заявил `keeper_pickup`, а охотники заявили `pickup` — они конкурируют за один и тот же квоффл! Сейчас:
- `keeper_pickup` обрабатывается в цикле действий (строки 682–701)
- `pickup` обрабатывается в unified pickup+steal фазе (строки 519–671)
- Они НЕ конкурируют друг с другом — кто первый в цикле, тот и забирает

**Это потенциальная проблема в текущем коде**, но она не относится к рефакторингу.

### Как изменится после рефакторинга:

1. `processPickupAndStealPhase({ actionFirst: true, phase: "pre" })` — создаёт pickup дуэль для охотников
2. `processPlayerActions({ actionFirst: true, phase: "pre" })` — обрабатывает `keeper_pickup` вратаря
3. После перемещений:
4. `processPickupAndStealPhase({ actionFirst: false, phase: "post" })` — проверяет post-move pickup
5. `processPlayerActions({ actionFirst: false, phase: "post" })` — обрабатывает post-move `keeper_pickup`

**Порядок обработки сохраняется:** сначала unified pickup+steal фаза, потом действия (включая `keeper_pickup`).

### Вердикт: ✅ Безопасно (с оговоркой про keeper_pickup vs pickup, но это существующее поведение)

---

## Итоговая таблица проверки

| Ситуация | Аспект | Текущее поведение | После рефакторинга | Статус |
|----------|--------|-------------------|-------------------|--------|
| 1 | 4 охотника пикапят | Pickup дуэль, все участники | Pickup дуэль, все участники | ✅ |
| 1 | Остальные игроки не заблокированы | Шаг ждёт дуэль, но другие могут ходить | То же самое | ✅ |
| 2 | Steal дуэль создаётся в pre-move | Да, через unified pickup+steal фазу | Да, через `processPickupAndStealPhase` | ✅ |
| 2 | Перемещения применяются после дуэли | Да, строки 990–1064 | Да, `applyMoves()` после `processPlayerActions` | ✅ |
| 2 | Перемещения не зависят от результата дуэли | Да, перемещения всегда применяются | Да, перемещения всегда применяются | ✅ |
| 3 | Pickup дуэль для охотников | Unified pickup+steal фаза | `processPickupAndStealPhase` | ✅ |
| 3 | Keeper_pickup обрабатывается отдельно | Цикл действий | `processPlayerActions` | ✅ |
| 3 | Keeper_pickup не конкурирует с pickup | Да, разная обработка | Да, разная обработка | ✅ |

## Критические изменения в плане

В ходе верификации я обнаружил **одно важное уточнение к плану**:

### Пункт 2.4: Убрать `pendingGoalResolution`

**Проблема:** `pendingGoalResolution` используется в pre-move фазе `throw` (строка 942) для отложенной проверки гола. После post-move фазы (строка 1303) проверяется, не стоит ли кипер на клетке гола.

**Почему это существует:** Если кипер переместится на клетку гола между pre-move и post-move фазами, гол отменяется (сейв). Это **осмысленное поведение** — кипер может "добежать" до ворот.

**Решение:** Не убирать `pendingGoalResolution` полностью, а **инкапсулировать его в возвращаемое значение** `processPlayerActions`. Функция будет возвращать `{ pendingGoalResolution, state }`, и `maybeAdvanceStep` будет проверять его после post-move фазы, как и сейчас.

```javascript
const preActionsResult = await processPlayerActions({
  ...,
  actionFirst: true,
  phase: "pre"
});
// preActionsResult.pendingGoalResolution может быть установлен
// Он будет проверен ПОСЛЕ post-move фазы, как и сейчас
```

Это сохраняет текущее поведение, но делает код чище.

### Дополнительное уточнение: `throw` в pre-move проверяет steal с `actionFirst=false`

**Почему это существует в текущем коде (строки 898–907):** Это "упреждающая" проверка — если steal с `actionFirst=false` возможен, то бросок блокируется ещё в pre-move фазе. Это **баг**, а не фича — steal с `actionFirst=false` должен проверяться только в post-move фазе.

**Решение:** Убрать второй вызов `maybeStartStealConflictDuel` с `actionFirst: false` из pre-move фазы. Steal с `actionFirst=false` будет корректно обработан в post-move фазе.

## Окончательный скорректированный план

1. ✅ Выделить `resolveMoveCollisions()` — безопасно, чистое вынесение
2. ✅ Выделить `processPickupAndStealPhase()` — безопасно, чистое вынесение
3. ✅ Выделить `processPlayerActions()` — **возвращает `pendingGoalResolution`** для post-обработки
4. ✅ Исправить: убрать `throw_steal` с `actionFirst=false` из pre-move фазы
5. ✅ Исправить: `collectPickupDefenders` в post-move не использует `moveToByIdBeforeActions`
6. ✅ Исправить: `throw` в pre-move использует `postMoveActionPosById` для принимающего
7. ✅ Переписать `maybeAdvanceStep` с использованием новых функций
8. ✅ Запустить тесты

---

## Ситуация 4: Охотник бросает (pre-move), вратарь перемещается в другую клетку (НЕ угадал)

### Заявки игроков:
- **Охотник 1 Гриффиндора** (с квоффлом): `actionFirst=true`, `actionType="throw"`, `actionTo="D13"` (ворота Пуффендуя)
- **Вратарь Пуффендуя**: `planned_to="D10"` (перемещается в другую клетку, не угадал)

### Как работает сейчас в `maybeAdvanceStep`:

**Pre-move фаза (строки 519–671):**
1. `qHolderId = "охотник1_гриф"` → pickup не проверяется
2. Steal не проверяется (никто не заявил steal)
3. `anyDuelCreated = false`

**Pre-move действия (строки 673–985):**
4. Охотник 1 Гриффиндора: `actionType="throw"`, `actionFirst=true`
5. `maybeStartStealConflictDuel` с `actionFirst=true` — нет кандидатов
6. `maybeStartStealConflictDuel` с `actionFirst=false` — нет кандидатов
7. Бросок: `isChaserRole`, `to="D13"` — это ворота, `d=2` — ок
8. `keeperId = occupantKeeperByCoord.get("D13")` — **Вратарь Пуффендуя НЕ на D13** (он на D1 или другой клетке)
9. `keeperId = null` → **гол!**
10. `pendingGoalResolution = { actorId, defenderTeam, keeperId, targetPos: "D13", scoringTeam }`
11. `qHolderId = null`, `qPos = "D13"`

**Применение перемещений (строки 990–1064):**
12. Вратарь Пуффендуя перемещается с D1 на D10
13. `posById` теперь: вратарь на D10

**Post-move фаза (строки 1093–1290):**
14. `qHolderId = null`, `qPos = "D13"` (квоффл в воротах)
15. `postPickupCandidates` — проверяет, кто заявил `pickup` с `actionFirst=false`
16. Если вратарь заявил `keeper_pickup` с `actionFirst=false` — он может подобрать

**Проверка pendingGoalResolution (строки 1303–1369):**
17. `pendingGoalResolution` !== null
18. `targetPos = "D13"`, `pendingGoalResolution.targetPos = "D13"` — совпадают
19. `keeperIdAtTarget = occupantKeeperByCoordAfter.get("D13")` — **вратарь на D10, не на D13**
20. `keeperIdAtTarget = null` → **ГОЛ!** `scoreA += 10`
21. `pendingGoalResolution = null`

**Результат: ✅ ГОЛ!** Вратарь не угадал, переместился в другую клетку, гол засчитан.

### Как будет после рефакторинга:

1. `processPickupAndStealPhase({ actionFirst: true, phase: "pre" })` — ничего
2. `processPlayerActions({ actionFirst: true, phase: "pre" })` — бросок, `pendingGoalResolution` установлен
3. `applyMoves()` — вратарь перемещается на D10
4. `processPickupAndStealPhase({ actionFirst: false, phase: "post" })` — проверка pickup
5. `processPlayerActions({ actionFirst: false, phase: "post" })` — post-move действия
6. **Проверка `pendingGoalResolution`** — вратарь не на D13 → **ГОЛ!**

**✅ Идентичное поведение**

---

## Ситуация 5: Охотник бросает (pre-move), вратарь перемещается в ту же клетку (угадал)

### Заявки игроков:
- **Охотник 1 Гриффиндора** (с квоффлом): `actionFirst=true`, `actionType="throw"`, `actionTo="D13"`
- **Вратарь Пуффендуя**: `planned_to="D13"` (перемещается в клетку ворот, угадал!)

### Как работает сейчас в `maybeAdvanceStep`:

**Pre-move фаза (строки 519–671):**
1. `qHolderId = "охотник1_гриф"` → pickup не проверяется
2. Steal не проверяется

**Pre-move действия (строки 673–985):**
3. Охотник 1 Гриффиндора: `actionType="throw"`, `actionFirst=true`
4. `maybeStartStealConflictDuel` — нет кандидатов
5. Бросок: `to="D13"`, `d=2`
6. `keeperId = occupantKeeperByCoord.get("D13")` — **вратарь НЕ на D13** (он на D1)
7. `keeperId = null` → `pendingGoalResolution = { ... }`
8. `qHolderId = null`, `qPos = "D13"`

**Применение перемещений (строки 990–1064):**
9. Вратарь Пуффендуя перемещается с D1 на D13
10. `posById` теперь: вратарь на D13

**Проверка pendingGoalResolution (строки 1303–1369):**
11. `pendingGoalResolution` !== null
12. `targetPos = "D13"`, совпадает
13. `keeperIdAtTarget = occupantKeeperByCoordAfter.get("D13")` — **вратарь на D13!**
14. `keeperIdAtTarget !== null` → **СЕЙВ!** Квоффл перехвачен
15. `qHolderId = keeperIdAtTarget` (вратарь), `qPos = null`
16. `lockHolderId = keeperIdAtTarget`, `lockStepNo = stepNo`
17. Статистика сейва обновляется

**Результат: ✅ СЕЙВ!** Вратарь угадал, переместился в клетку ворот, поймал мяч.

### Как будет после рефакторинга:

1. `processPickupAndStealPhase({ actionFirst: true, phase: "pre" })` — ничего
2. `processPlayerActions({ actionFirst: true, phase: "pre" })` — бросок, `pendingGoalResolution` установлен
3. `applyMoves()` — вратарь перемещается на D13
4. **Проверка `pendingGoalResolution`** — вратарь на D13 → **СЕЙВ!**

**✅ Идентичное поведение**

---

## Ключевой вывод: `pendingGoalResolution` критически важен

Эти две ситуации демонстрируют, почему **`pendingGoalResolution` — это не баг, а фича**. Он реализует важную игровую механику:

> **Кипер может "прочитать" бросок и переместиться в клетку ворот, чтобы поймать мяч.**

Если бы гол начислялся сразу в pre-move фазе, то:
- В ситуации 5 вратарь не смог бы спасти, даже угадав клетку
- Механика "угадай клетку ворот" была бы сломана

### Окончательная корректировка плана

`pendingGoalResolution` **ДОЛЖЕН БЫТЬ СОХРАНЁН** в его текущей форме:

1. Pre-move `throw` → если гол → `pendingGoalResolution` устанавливается
2. Перемещения применяются
3. Post-move проверка: если кипер на клетке гола → сейв, иначе → гол

В `processPlayerActions` это будет выглядеть так:

```javascript
async function processPlayerActions({
  ...,
  actionFirst,
  phase,
  pendingGoalResolution: externalPendingGoalResolution
}) {
  let localPendingGoalResolution = externalPendingGoalResolution;
  
  // ... обработка действий ...
  
  if (actionType === "throw" && phase === "pre") {
    // ... проверка броска ...
    if (гол) {
      localPendingGoalResolution = { ... };
    }
  }
  
  return {
    state: { qHolderId, qPos, ... },
    pendingGoalResolution: localPendingGoalResolution
  };
}
```

А в `maybeAdvanceStep`:

```javascript
// Pre-move
const preActionsResult = await processPlayerActions({
  actionFirst: true, phase: "pre",
  pendingGoalResolution: null
});

// Применяем перемещения
applyMoves(...);

// Проверяем pendingGoalResolution ПОСЛЕ перемещений
if (preActionsResult.pendingGoalResolution && !qHolderId) {
  const keeperAtTarget = occupantKeeperByCoordAfter.get(targetPos);
  if (keeperAtTarget) {
    // Сейв!
  } else {
    // Гол!
  }
}

// Post-move
const postActionsResult = await processPlayerActions({
  actionFirst: false, phase: "post",
  pendingGoalResolution: null // уже обработан
});
```

## Итоговая таблица всех проверенных ситуаций

| Ситуация | Описание | Текущее поведение | После рефакторинга | Статус |
|----------|----------|-------------------|-------------------|--------|
| 1 | 4 охотника пикапят свободный квоффл | Pickup дуэль, все участники | Pickup дуэль, все участники | ✅ |
| 2 | Steal против холдера с квоффлом | Steal дуэль, перемещения после | Steal дуэль, перемещения после | ✅ |
| 3 | Гол, 3 игрока пикапят из ворот | Pickup дуэль + keeper_pickup отдельно | Pickup дуэль + keeper_pickup отдельно | ✅ |
| 4 | Бросок, вратарь не угадал клетку | Гол через `pendingGoalResolution` | Гол через `pendingGoalResolution` | ✅ |
| 5 | Бросок, вратарь угадал клетку | Сейв через `pendingGoalResolution` | Сейв через `pendingGoalResolution` | ✅ |

## Финальный скорректированный план рефакторинга

1. ✅ Выделить `resolveMoveCollisions()` — чистое вынесение
2. ✅ Выделить `processPickupAndStealPhase()` — чистое вынесение
3. ✅ Выделить `processPlayerActions()` — **возвращает `pendingGoalResolution`** для post-обработки
4. ✅ Исправить: убрать `throw_steal` с `actionFirst=false` из pre-move фазы (баг)
5. ✅ Исправить: `collectPickupDefenders` в post-move не использует `moveToByIdBeforeActions`
6. ✅ Исправить: `throw` в pre-move использует `postMoveActionPosById` для принимающего
7. ✅ Переписать `maybeAdvanceStep` с использованием новых функций
8. ✅ Запустить тесты