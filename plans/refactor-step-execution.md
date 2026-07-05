# План рефакторинга: Упрощение `maybeAdvanceStep`

## Текущие проблемы

### 1. Дублирование pickup/steal логики
Функция `processPickupAndStealPhase` (строка 253) написана, но **не используется**. Вместо неё pickup размазан по 3 местам в `maybeAdvanceStep`:
- Pre-move pickup: строки 1100-1156
- Post-move pickup: строки 1262-1287
- Post-move steal: строки 1290-1327

### 2. SAVEPOINT rollback — опасный паттерн
`ROLLBACK TO SAVEPOINT step_apply` используется в 4+ местах. После rollback'а JS-переменные (`qHolderId`, `qPos`) рассинхронизируются с БД, приходится перечитывать состояние игры (строки 1245-1260). Это хрупко: легко забыть перечитать.

### 3. Pending goal resolution — излишне сложен
Гол откладывается в pre-move, проверяется в post-move (строки 1340-1406). Вместо этого можно обрабатывать throw только в post-move фазе, если бросающий перемещается.

### 4. Раздутая `maybeAdvanceStep`
Функция ~820 строк. Смешаны: подготовка, pre-move, перемещения, post-move, снитч, бладжеры, сохранение.

## План рефакторинга

### Шаг 1: Выделить `prepareStepState`
**Что:** Вынести загрузку и инициализацию состояния из `maybeAdvanceStep` (строки 956-1098) в отдельную функцию.

**Зачем:** Уменьшает `maybeAdvanceStep` на ~140 строк. Делает подготовку переиспользуемой и тестируемой.

**Сигнатура:**
```js
async function prepareStepState(client, gameId) {
  // Загрузка game, participants, turn_states
  // Построение fromById, actionPosById, occupant-карт
  // Инициализация qHolderId, qPos, b1Pos, b2Pos, snitchPos и т.д.
  // Возвращает единый объект state
}
```

### Шаг 2: Использовать `processPickupAndStealPhase` вместо дублирования
**Что:** Удалить дублирующийся код (строки 1100-1156, 1262-1327) и вызывать готовую `processPickupAndStealPhase`.

**Зачем:** Устраняет ~200 строк дублирования. Единая точка обработки pickup/steal.

**Изменения:**
```js
// Было: 3 блока кода
// Стало:
const prePickupResult = await processPickupAndStealPhase({
  ..., actionFirst: true, includePostMovePickup: true, phase: "pre"
});
const postPickupResult = await processPickupAndStealPhase({
  ..., actionFirst: false, includePostMovePickup: false, phase: "post"
});
```

### Шаг 3: Убрать SAVEPOINT rollback
**Что:** Вместо создания дуэлей внутри `processPlayerActions` (с rollback'ом), собирать всех кандидатов на дуэли **до** применения действий.

**Зачем:** Устраняет главный источник хрупкости. После этого шага JS-переменные всегда синхронизированы с БД.

**Новый подход:**
1. Собрать всех кандидатов на все дуэли (pickup, steal, throw_steal, hit_bludger) в предварительном проходе
2. Создать все дуэли разом
3. Если дуэли есть — завершить шаг, не применяя действия
4. Если дуэлей нет — применить все действия

**Конкретные изменения в `processPlayerActions`:**
- Убрать `maybeStartStealConflictDuel` (который делает ROLLBACK)
- Вместо него — предварительный сбор кандидатов на throw_steal до цикла действий
- Создать дуэли throw_steal до вызова `processPlayerActions`

### Шаг 4: Упростить pending goal resolution
**Что:** Убрать механизм отложенных голов.

**Зачем:** Упрощает логику throw. Убирает ~70 строк кода.

**Вариант А (рекомендуемый):**
- Chaser с `actionFirst=true` и бросок по воротам без вратаря → гол засчитывается сразу (как в post-move)
- Если вратарь хочет защитить ворота — он должен планировать `actionFirst=true` (встать на клетку ворот до броска)

**Вариант Б (консервативный):**
- Chaser с `actionFirst=true` и бросок по воротам без вратаря → бросок не разрешается (переносим на post-move)
- Chaser должен использовать `actionFirst=false` для броска, если хочет сначала переместиться

### Шаг 5: Выделить `processBludgers` и `processSnitch`
**Что:** Вынести логику бладжеров (строки 1466-1511) и снитча (строки 1526-1653) в отдельные функции.

**Зачем:** Уменьшает `maybeAdvanceStep`. Делает логику изолированной и тестируемой.

### Шаг 6: Выделить `finalizeStep`
**Что:** Вынести финализацию шага (строки 1655-1769) в отдельную функцию.

**Зачем:** Завершающая функция, которая сохраняет состояние и запускает дуэли.

## Итоговая структура `maybeAdvanceStep`

```js
async function maybeAdvanceStep(client, gameId, depth = 0) {
  if (depth > 6) return;
  
  // 1. Проверка: все ли завершили ход, нет ли активных дуэлей
  if (!allPlayersEnded(client, gameId)) return;
  if (hasActiveDuels(client, gameId)) return;
  
  await client.query("SAVEPOINT step_apply");
  
  // 2. Подготовка состояния
  const state = await prepareStepState(client, gameId);
  
  // 3. Pre-move фаза
  const preResult = await processPreMovePhase(client, state);
  if (preResult.anyDuelCreated) {
    await finalizeWithDuels(client, gameId, depth);
    return;
  }
  
  // 4. Перемещения
  const moveResult = await applyMovement(client, state);
  
  // 5. Post-move фаза
  const postResult = await processPostMovePhase(client, state, moveResult);
  if (postResult.anyDuelCreated) {
    await finalizeWithDuels(client, gameId, depth);
    return;
  }
  
  // 6. Бладжеры + снитч
  const bludgerResult = processBludgers(state, moveResult);
  const snitchResult = processSnitch(state, bludgerResult);
  
  // 7. Финализация
  await finalizeStep(client, gameId, state, moveResult, bludgerResult, snitchResult);
}
```

## Что НЕ меняется
- `processPlayerActions` — остаётся как есть (кроме удаления `maybeStartStealConflictDuel`)
- `processPickupAndStealPhase` — просто начинаем использовать
- `resolveMoveCollisions` — без изменений
- Все helper-функции (`collectPickupDefenders`, `collectStealCandidatesAgainstHolder`, и т.д.)
- Вся логика дуэлей в `duels.js`
- `bot-logic.js`
- API и клиентский код

## Порядок выполнения

1. **Шаг 3** (убрать SAVEPOINT rollback) — самый критичный, делать первым
2. **Шаг 1** (prepareStepState) — механическое выделение
3. **Шаг 2** (использовать processPickupAndStealPhase) — после шагов 1 и 3
4. **Шаг 4** (упростить pending goal) — после шага 3
5. **Шаг 5** (processBludgers + processSnitch) — механическое выделение
6. **Шаг 6** (finalizeStep) — механическое выделение

## Тестирование
- После каждого шага прогонять существующие тесты
- `test/quaffle-duels.test.js`
- `test/quaffle-duel-bot.e2e.test.js`
- Ручное тестирование: создать игру, походить ботами, проверить что счёт меняется