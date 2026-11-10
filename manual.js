// 배포 매뉴얼: 매뉴얼(탭)마다 큰 단계와 세부단계를 목록으로 두고, 배포할 때마다 체크한 뒤 초기화한다.
// app.js 다음에 불러오며 client, element, button, showToast, createFolderInput 등을 함께 쓴다.
// 단계는 manual_steps 한 테이블에 두고, parent_id가 없으면 큰 단계, 있으면 그 큰 단계의 세부단계다.

const MANUAL_STORAGE_KEY = "qa-tool.manual";
const MANUAL_COLLAPSED_STORAGE_KEY = "qa-tool.manual-collapsed";
const MANUAL_COLUMNS = "id, name";
const MANUAL_STEP_COLUMNS = "id, manual_id, parent_id, text, checked, sort_order";
const STAGE_MAX_LENGTH = 200;
const SUB_MAX_LENGTH = 500;

const manualTabs = document.getElementById("manual-tabs");
const manualTools = document.getElementById("manual-tools");
const manualResetButton = document.getElementById("manual-reset");
const manualEditButton = document.getElementById("manual-edit");
const manualProgress = document.getElementById("manual-progress");
const manualBanner = document.getElementById("manual-banner");
const manualMessage = document.getElementById("manual-message");
const manualStages = document.getElementById("manual-stages");
const manualAddStage = document.getElementById("manual-add-stage");
const manualDeleteOverlay = document.getElementById("manual-delete-overlay");
const manualDeleteHeading = document.getElementById("manual-delete-heading");
const manualDeleteBody = document.getElementById("manual-delete-body");
const manualDeleteMessage = document.getElementById("manual-delete-message");
const manualDeleteConfirm = document.getElementById("manual-delete-confirm");
const manualDeleteCancel = document.getElementById("manual-delete-cancel");

const manual = {
  manuals: [],
  // sort_order 순으로 정렬해 둔다.
  steps: [],
  currentManual: null,
  status: "loading",
  addingFolder: false,
  renamingFolderId: null,
  editing: false,
  // 삭제 버튼을 한 번 눌러 확인을 기다리는 큰 단계
  confirmDeleteId: null,
  confirmReset: false,
  adding: false,
};
let manualDeleting = null;
let manualLastTabClick = { id: null, time: 0 };
// 끄는 중인 단계 { id, parentId, index }
let manualDrag = null;
// 접어 둔 큰 단계 id. 이 브라우저에만 기억한다.
let manualCollapsed = readCollapsedStages();

/* ---------- Supabase ---------- */

async function fetchManuals() {
  const { data, error } = await client.from("manuals").select(MANUAL_COLUMNS).order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  return data;
}

async function fetchManualSteps() {
  const { data, error } = await client
    .from("manual_steps")
    .select(MANUAL_STEP_COLUMNS)
    .order("sort_order")
    .order("created_at");
  if (error) {
    throw error;
  }
  return data;
}

async function insertManual(name) {
  const { data, error } = await client.from("manuals").insert({ name }).select(MANUAL_COLUMNS).single();
  return error ? null : data;
}

// 성공하면 "ok", 같은 이름이 있으면 "duplicate", 그 밖의 실패는 "error"를 돌려준다.
async function renameManualRow(id, name) {
  const { data, error } = await client.from("manuals").update({ name }).eq("id", id).select("id");
  if (error) {
    return error.code === "23505" ? "duplicate" : "error";
  }
  return data.length ? "ok" : "error";
}

// 매뉴얼을 지우면 DB에서 그 안의 단계도 함께 지워진다.
async function deleteManualRow(id) {
  const { data, error } = await client.from("manuals").delete().eq("id", id).select("id");
  return !error && data.length > 0;
}

async function insertManualStep(row) {
  const { data, error } = await client.from("manual_steps").insert(row).select(MANUAL_STEP_COLUMNS).single();
  return error ? null : data;
}

async function updateManualStep(id, changes) {
  const { data, error } = await client.from("manual_steps").update(changes).eq("id", id).select("id");
  return !error && data.length > 0;
}

// 큰 단계와 그 안의 세부단계를 한 번에 체크하거나 푼다.
async function updateStageChecked(stageId, checked) {
  const { data, error } = await client
    .from("manual_steps")
    .update({ checked })
    .or(`id.eq.${stageId},parent_id.eq.${stageId}`)
    .select("id");
  return !error && data.length > 0;
}

async function resetManualChecks(manualId) {
  const { error } = await client.from("manual_steps").update({ checked: false }).eq("manual_id", manualId).eq("checked", true);
  return !error;
}

// 큰 단계를 지우면 DB에서 그 안의 세부단계도 함께 지워진다.
async function deleteManualStep(id) {
  const { data, error } = await client.from("manual_steps").delete().eq("id", id).select("id");
  return !error && data.length > 0;
}

/* ---------- 도우미 ---------- */

function stagesOf(manualId) {
  return manual.steps.filter((step) => step.manual_id === manualId && !step.parent_id);
}

function subsOf(stageId) {
  return manual.steps.filter((step) => step.parent_id === stageId);
}

function findStep(id) {
  return manual.steps.find((step) => step.id === id);
}

function patchSteps(ids, changes) {
  const set = new Set(ids);
  manual.steps = manual.steps.map((step) => (set.has(step.id) ? { ...step, ...changes } : step));
}

// 세부단계가 있으면 모두 체크됐을 때 완료, 없으면 큰 단계 자신의 체크로 정한다.
function isStageDone(stage) {
  const subs = subsOf(stage.id);
  return subs.length ? subs.every((sub) => sub.checked) : stage.checked;
}

// 진행 현황은 세부단계마다 하나, 세부단계가 없는 큰 단계는 그 자체로 하나로 센다.
function manualProgressCount(manualId) {
  let total = 0;
  let done = 0;
  stagesOf(manualId).forEach((stage) => {
    const subs = subsOf(stage.id);
    const units = subs.length ? subs : [stage];
    total += units.length;
    done += units.filter((unit) => unit.checked).length;
  });
  return { total, done };
}

function hasAnyCheck(manualId) {
  return manualProgressCount(manualId).done > 0;
}

function sortSteps(steps) {
  return [...steps].sort((a, b) => a.sort_order - b.sort_order);
}

function storeManual(id) {
  try {
    localStorage.setItem(MANUAL_STORAGE_KEY, id || "");
  } catch {
    // 저장하지 못해도 이번 화면에서는 동작한다.
  }
}

function readStoredManual() {
  try {
    return localStorage.getItem(MANUAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readCollapsedStages() {
  try {
    const ids = JSON.parse(localStorage.getItem(MANUAL_COLLAPSED_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function storeCollapsedStages() {
  try {
    localStorage.setItem(MANUAL_COLLAPSED_STORAGE_KEY, JSON.stringify([...manualCollapsed]));
  } catch {
    // 저장하지 못해도 이번 화면에서는 동작한다.
  }
}

// 줄 수에 맞춰 입력칸 높이를 늘린다.
function fitTextarea(textarea) {
  // 화면에 보이지 않을 때는 높이를 잴 수 없다.
  if (!textarea.offsetParent) {
    return;
  }
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/* ---------- 그리기 ---------- */

function renderManual() {
  // 매뉴얼 이름을 입력하는 중에 탭을 다시 그리면 입력창이 사라진다.
  if (!manual.addingFolder && !manual.renamingFolderId) {
    renderManualTabs();
  }
  renderManualBody();
}

function renderManualTabs() {
  const tabs = [];
  if (manual.addingFolder) {
    tabs.push(createFolderInput("", commitManualFolder, cancelManualFolder));
  }
  manual.manuals.forEach((item) => {
    tabs.push(
      item.id === manual.renamingFolderId
        ? createFolderInput(item.name, (value) => commitManualRename(item.id, value), cancelManualRename)
        : createManualTab(item),
    );
  });

  const addButton = button("folder-add-button", "+", () => {
    if (manual.renamingFolderId) {
      return;
    }
    manual.addingFolder = true;
    renderManualTabs();
  });
  addButton.title = "매뉴얼 추가";
  addButton.setAttribute("aria-label", "매뉴얼 추가");
  tabs.push(addButton);

  manualTabs.replaceChildren(...tabs);
  const nameInput = manualTabs.querySelector(".folder-name-input");
  if (nameInput) {
    nameInput.placeholder = "매뉴얼 이름 후 Enter";
    nameInput.focus();
    nameInput.select();
  }
}

function createManualTab(item) {
  const isActive = manual.currentManual === item.id;
  const node = element("div", "folder-tab");
  node.classList.toggle("is-active", isActive);

  const label = button("folder-tab-button", undefined, () => clickManualTab(item.id));
  label.title = "더블클릭해서 이름 변경";
  label.append(element("span", null, item.name));
  node.append(label);

  if (isActive) {
    const deleteButton = button("folder-delete", "×", () => openManualDelete(item.id));
    deleteButton.title = "매뉴얼 삭제";
    deleteButton.setAttribute("aria-label", `'${item.name}' 매뉴얼 삭제`);
    node.append(deleteButton);
  }
  return node;
}

function renderManualBody() {
  const ready = manual.status === "ready" && Boolean(manual.currentManual);
  const stages = ready ? stagesOf(manual.currentManual) : [];

  let message = "";
  if (manual.status === "loading") {
    message = "불러오는 중입니다.";
  } else if (manual.status === "error") {
    message = "불러오지 못했습니다. 새로고침해 주세요.";
  } else if (!manual.currentManual) {
    message = "탭 옆 + 를 눌러 매뉴얼을 만들어 주세요.";
  } else if (!stages.length && !manual.editing) {
    message = "아직 단계가 없습니다. 편집을 눌러 단계를 추가해 주세요.";
  }
  manualMessage.textContent = message;
  manualMessage.hidden = !message;

  manualTools.hidden = !ready;
  manualBanner.hidden = !ready || !manual.editing;
  manualAddStage.hidden = !ready || !manual.editing;
  manualEditButton.textContent = manual.editing ? "완료" : "편집";
  manualResetButton.hidden = manual.editing;
  manualResetButton.disabled = !ready || !hasAnyCheck(manual.currentManual);
  setResetConfirming(manual.confirmReset && !manualResetButton.disabled);

  manualStages.classList.toggle("is-editing", manual.editing);
  manualStages.replaceChildren(...stages.map(manual.editing ? createEditStage : createCheckStage));
  manualStages.querySelectorAll("textarea").forEach(fitTextarea);
  renderManualProgress();
}

function renderManualProgress() {
  const { total, done } =
    manual.status === "ready" && manual.currentManual ? manualProgressCount(manual.currentManual) : { total: 0, done: 0 };
  manualProgress.hidden = !total || manual.editing;
  if (manualProgress.hidden) {
    return;
  }
  manualProgress.replaceChildren(`${total}개 중 `, element("strong", null, `완료 ${done}`));
}

function createCheckbox(className, checked, label, onChange) {
  const checkbox = element("input", className);
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.setAttribute("aria-label", label);
  checkbox.addEventListener("change", () => onChange(checkbox.checked));
  return checkbox;
}

function createCheckStage(stage) {
  const subs = subsOf(stage.id);
  const done = isStageDone(stage);
  const collapsed = subs.length > 0 && manualCollapsed.has(stage.id);
  const node = element("li", "manual-stage");
  node.dataset.id = stage.id;
  node.classList.toggle("is-done", done);
  node.classList.toggle("is-collapsed", collapsed);

  const head = element("div", "manual-stage-head");
  if (subs.length) {
    const caret = button("manual-caret", undefined, () => toggleStageCollapse(stage.id));
    caret.setAttribute("aria-expanded", String(!collapsed));
    caret.setAttribute("aria-label", collapsed ? "세부단계 펼치기" : "세부단계 접기");
    head.append(caret);
    // 제목을 눌러도 접고 편다. 체크박스는 제외한다.
    head.classList.add("is-toggle");
    head.addEventListener("click", (event) => {
      if (event.target === head || event.target.classList.contains("manual-stage-title") || event.target.classList.contains("manual-count")) {
        toggleStageCollapse(stage.id);
      }
    });
  } else {
    head.append(element("span", "manual-caret-space"));
  }

  const checkbox = createCheckbox("manual-check", done, "큰 단계 완료", (checked) => toggleStageCheck(stage.id, checked));
  checkbox.indeterminate = !done && subs.some((sub) => sub.checked);
  head.append(checkbox, createStepText("manual-stage-title", stage.text, "이름 없는 단계"));
  if (subs.length) {
    head.append(element("span", "manual-count", `${subs.filter((sub) => sub.checked).length}/${subs.length}`));
  }
  node.append(head);

  if (subs.length && !collapsed) {
    const list = element("ul", "manual-subs");
    subs.forEach((sub) => {
      const item = element("li");
      const row = element("label", "manual-sub");
      row.classList.toggle("is-done", sub.checked);
      row.append(
        createCheckbox("manual-check", sub.checked, "세부단계 완료", (checked) => toggleSubCheck(sub.id, checked)),
        createStepText("manual-sub-text", sub.text, "내용 없음"),
      );
      item.append(row);
      list.append(item);
    });
    node.append(list);
  }
  return node;
}

function createStepText(className, text, placeholder) {
  const node = element("span", className, text || placeholder);
  node.classList.toggle("is-placeholder", !text);
  return node;
}

function createEditStage(stage, index) {
  const subs = subsOf(stage.id);
  const node = element("li", "manual-stage is-editing");
  node.dataset.id = stage.id;

  const head = element("div", "manual-stage-head");
  const input = element("input", "manual-input manual-stage-input");
  input.type = "text";
  input.value = stage.text;
  input.maxLength = STAGE_MAX_LENGTH;
  input.placeholder = "큰 단계 이름";
  input.setAttribute("aria-label", "큰 단계 이름");
  bindStepInput(input, stage.id);

  const deleteButton = button("manual-delete", "×", () => clickStageDelete(stage.id, deleteButton));
  setStageDeleteConfirming(deleteButton, manual.confirmDeleteId === stage.id);
  deleteButton.addEventListener("blur", () => {
    if (manual.confirmDeleteId === stage.id) {
      manual.confirmDeleteId = null;
      setStageDeleteConfirming(deleteButton, false);
    }
  });
  head.append(createDragHandle(node, stage, null, index), input, deleteButton);
  node.append(head);

  const list = element("ul", "manual-subs");
  subs.forEach((sub, subIndex) => {
    const item = element("li", "manual-sub is-editing");
    item.dataset.id = sub.id;
    const textarea = element("textarea", "manual-input manual-sub-input");
    textarea.rows = 1;
    textarea.value = sub.text;
    textarea.maxLength = SUB_MAX_LENGTH;
    textarea.placeholder = "세부단계 내용";
    textarea.setAttribute("aria-label", "세부단계 내용");
    textarea.addEventListener("input", () => fitTextarea(textarea));
    bindStepInput(textarea, sub.id);

    const subDelete = button("manual-delete", "×", () => deleteStep(sub.id));
    subDelete.title = "세부단계 삭제";
    subDelete.setAttribute("aria-label", "세부단계 삭제");
    item.append(createDragHandle(item, sub, stage.id, subIndex), textarea, subDelete);
    bindDropTarget(item, sub, stage.id, subIndex);
    list.append(item);
  });
  const addSub = button("manual-add-sub", "+ 세부단계 추가", () => addStep(stage.id));
  const addItem = element("li");
  addItem.append(addSub);
  list.append(addItem);
  node.append(list);

  bindDropTarget(node, stage, null, index);
  return node;
}

// 입력을 마치면(포커스가 빠지면) 저장한다. Enter는 입력을 마치고, Esc는 고치기 전으로 되돌린다.
// 세부단계는 Shift+Enter로 줄을 바꾼다.
function bindStepInput(input, id) {
  input.addEventListener("change", () => saveStepText(id, input));
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      const step = findStep(id);
      input.value = step ? step.text : input.value;
      if (input.tagName === "TEXTAREA") {
        fitTextarea(input);
      }
      input.blur();
    }
  });
}

function createDragHandle(node, step, parentId, index) {
  const handle = element("span", "drag-handle", "⋮⋮");
  handle.title = "끌어서 순서 변경";
  handle.draggable = true;
  handle.addEventListener("dragstart", (event) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", step.id);
    event.dataTransfer.setDragImage(node, 16, 16);
    manualDrag = { id: step.id, parentId, index };
    requestAnimationFrame(() => node.classList.add("is-dragging"));
  });
  handle.addEventListener("dragend", () => endManualDrag());
  return handle;
}

// 큰 단계는 큰 단계끼리, 세부단계는 같은 큰 단계 안에서만 옮긴다.
function bindDropTarget(node, step, parentId, index) {
  const accepts = () => manualDrag && manualDrag.parentId === parentId && manualDrag.id !== step.id;
  node.addEventListener("dragover", (event) => {
    if (!accepts()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    markManualDropTarget(node, index > manualDrag.index ? "is-drop-after" : "is-drop-before");
  });
  node.addEventListener("drop", (event) => {
    if (!accepts()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const id = manualDrag.id;
    endManualDrag();
    reorderManualStep(id, step.id);
  });
}

function markManualDropTarget(node, className) {
  manualStages.querySelectorAll(".is-drop-before, .is-drop-after").forEach((other) => {
    if (other !== node) {
      other.classList.remove("is-drop-before", "is-drop-after");
    }
  });
  node.classList.remove("is-drop-before", "is-drop-after");
  node.classList.add(className);
}

function endManualDrag() {
  manualDrag = null;
  manualStages.querySelectorAll(".is-dragging, .is-drop-before, .is-drop-after").forEach((node) => {
    node.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
  });
}

function setStageDeleteConfirming(deleteButton, confirming) {
  deleteButton.classList.toggle("is-confirming", confirming);
  deleteButton.textContent = confirming ? "삭제" : "×";
  deleteButton.title = confirming ? "한 번 더 누르면 세부단계까지 삭제" : "큰 단계 삭제";
  deleteButton.setAttribute("aria-label", confirming ? "삭제 확인" : "큰 단계 삭제");
}

function setResetConfirming(confirming) {
  manual.confirmReset = confirming;
  manualResetButton.classList.toggle("is-confirming", confirming);
  manualResetButton.textContent = confirming ? "한 번 더 누르면 초기화" : "초기화";
  manualResetButton.title = confirming ? "" : "모든 체크를 지웁니다";
}

/* ---------- 체크 ---------- */

// 먼저 화면에 반영하고, 저장에 실패하면 되돌린다.
async function applyChecks(ids, checked, save) {
  const previous = new Map(ids.map((id) => [id, findStep(id)?.checked]));
  patchSteps(ids, { checked });
  renderManualBody();
  if (!(await save())) {
    manual.steps = manual.steps.map((step) => (previous.has(step.id) ? { ...step, checked: previous.get(step.id) } : step));
    renderManualBody();
    showToast(SAVE_ERROR_MESSAGE);
  }
}

// 큰 단계 자신의 체크도 "세부단계가 모두 끝났는지"에 맞춰 둔다. 세부단계를 다 지웠을 때 예전 값이 드러나지 않게 한다.
function toggleSubCheck(id, checked) {
  const sub = findStep(id);
  const stage = sub && findStep(sub.parent_id);
  if (!stage) {
    return;
  }
  const allDone = subsOf(stage.id).every((other) => (other.id === id ? checked : other.checked));
  if (stage.checked === allDone) {
    applyChecks([id], checked, () => updateManualStep(id, { checked }));
    return;
  }
  applyChecks([id], checked, async () => {
    const results = await Promise.all([updateManualStep(id, { checked }), updateManualStep(stage.id, { checked: allDone })]);
    if (results.every(Boolean)) {
      patchSteps([stage.id], { checked: allDone });
      return true;
    }
    return false;
  });
}

function toggleStageCheck(stageId, checked) {
  const ids = [stageId, ...subsOf(stageId).map((sub) => sub.id)];
  applyChecks(ids, checked, () => updateStageChecked(stageId, checked));
}

function toggleStageCollapse(stageId) {
  if (manualCollapsed.has(stageId)) {
    manualCollapsed.delete(stageId);
  } else {
    manualCollapsed.add(stageId);
  }
  storeCollapsedStages();
  renderManualBody();
}

async function clickManualReset() {
  const manualId = manual.currentManual;
  if (!manualId || manual.editing) {
    return;
  }
  if (!manual.confirmReset) {
    setResetConfirming(true);
    manualResetButton.focus();
    return;
  }
  setResetConfirming(false);
  const ids = manual.steps.filter((step) => step.manual_id === manualId && step.checked).map((step) => step.id);
  await applyChecks(ids, false, () => resetManualChecks(manualId));
  if (!hasAnyCheck(manualId)) {
    showToast("초기화했습니다");
  }
}

/* ---------- 편집 ---------- */

function toggleManualEditing() {
  manual.editing = !manual.editing;
  manual.confirmDeleteId = null;
  manual.confirmReset = false;
  renderManualBody();
}

async function saveStepText(id, input) {
  const step = findStep(id);
  const value = input.value.trim();
  if (!step || value === step.text) {
    return;
  }
  const previous = step.text;
  patchSteps([id], { text: value });
  if (!(await updateManualStep(id, { text: value }))) {
    if (findStep(id)) {
      patchSteps([id], { text: previous });
      if (document.activeElement !== input) {
        input.value = previous;
      }
    }
    showToast(SAVE_ERROR_MESSAGE);
  }
}

// parentId가 없으면 큰 단계를, 있으면 그 큰 단계의 세부단계를 맨 아래에 만든다.
async function addStep(parentId) {
  const manualId = manual.currentManual;
  if (!manualId || manual.adding) {
    return;
  }
  manual.adding = true;
  const siblings = parentId ? subsOf(parentId) : stagesOf(manualId);
  const last = siblings[siblings.length - 1];
  const saved = await insertManualStep({
    manual_id: manualId,
    parent_id: parentId,
    sort_order: last ? last.sort_order + 1 : 1,
  });
  manual.adding = false;
  if (!saved) {
    showToast(SAVE_ERROR_MESSAGE);
    return;
  }
  manual.steps = sortSteps([...manual.steps, saved]);
  if (parentId) {
    manualCollapsed.delete(parentId);
    storeCollapsedStages();
  }
  renderManualBody();
  const input = manualStages.querySelector(`[data-id="${saved.id}"] .manual-input`);
  if (input) {
    input.focus();
  }
}

// 세부단계가 든 큰 단계는 한 번 더 눌러야 지운다.
// 다시 그리면 포커스된 버튼이 사라지며 blur로 확인이 풀리므로, 버튼을 그 자리에서 바꾼다.
function clickStageDelete(id, deleteButton) {
  if (subsOf(id).length && manual.confirmDeleteId !== id) {
    manual.confirmDeleteId = id;
    setStageDeleteConfirming(deleteButton, true);
    deleteButton.focus();
    return;
  }
  manual.confirmDeleteId = null;
  deleteStep(id);
}

async function deleteStep(id) {
  if (!(await deleteManualStep(id))) {
    showToast("삭제하지 못했습니다");
    return;
  }
  manual.steps = manual.steps.filter((step) => step.id !== id && step.parent_id !== id);
  manualCollapsed.delete(id);
  renderManualBody();
  showToast("삭제했습니다");
}

async function reorderManualStep(dragId, targetId) {
  const dragged = findStep(dragId);
  if (!dragged) {
    return;
  }
  const siblings = dragged.parent_id ? subsOf(dragged.parent_id) : stagesOf(dragged.manual_id);
  const from = siblings.findIndex((step) => step.id === dragId);
  const to = siblings.findIndex((step) => step.id === targetId);
  if (from < 0 || to < 0 || from === to) {
    return;
  }

  // 아래로 옮기면 대상 뒤에, 위로 옮기면 대상 앞에 놓는다(끄는 중 표시선과 같은 위치).
  const ordered = siblings.filter((step) => step.id !== dragId);
  const index = ordered.findIndex((step) => step.id === targetId) + (from < to ? 1 : 0);
  ordered.splice(index, 0, dragged);

  const before = ordered[index - 1];
  const after = ordered[index + 1];
  let changes;
  if (before && after && after.sort_order - before.sort_order < MIN_SORT_GAP) {
    changes = ordered
      .map((step, i) => ({ id: step.id, sort_order: i + 1 }))
      .filter((change, i) => ordered[i].sort_order !== change.sort_order);
  } else {
    let sortOrder;
    if (before && after) {
      sortOrder = (before.sort_order + after.sort_order) / 2;
    } else if (before) {
      sortOrder = before.sort_order + 1;
    } else {
      sortOrder = after.sort_order - 1;
    }
    changes = [{ id: dragId, sort_order: sortOrder }];
  }

  const previous = manual.steps;
  const newOrders = new Map(changes.map((change) => [change.id, change.sort_order]));
  manual.steps = sortSteps(
    manual.steps.map((step) => (newOrders.has(step.id) ? { ...step, sort_order: newOrders.get(step.id) } : step)),
  );
  renderManualBody();

  const results = await Promise.all(changes.map((change) => updateManualStep(change.id, { sort_order: change.sort_order })));
  if (!results.every(Boolean)) {
    manual.steps = previous;
    renderManualBody();
    showToast(SAVE_ERROR_MESSAGE);
  }
}

/* ---------- 매뉴얼(탭) 동작 ---------- */

function setManual(id) {
  manual.currentManual = id;
  manual.editing = false;
  manual.confirmDeleteId = null;
  manual.confirmReset = false;
  storeManual(id);
  renderManual();
}

// 첫 클릭에 탭을 다시 그리므로 브라우저의 dblclick이 오지 않는다. 그래서 같은 탭을 연달아 누른 것을 직접 센다.
function clickManualTab(id) {
  const now = Date.now();
  const isDouble = manualLastTabClick.id === id && now - manualLastTabClick.time < DOUBLE_CLICK_MS;
  manualLastTabClick = isDouble ? { id: null, time: 0 } : { id, time: now };
  if (isDouble && !manual.addingFolder) {
    manual.renamingFolderId = id;
    renderManualTabs();
  } else if (manual.currentManual !== id) {
    setManual(id);
  } else {
    renderManualTabs();
  }
}

async function commitManualFolder(rawName) {
  // Enter로 만든 뒤 입력창이 사라지면서 blur가 한 번 더 올 수 있다.
  if (!manual.addingFolder) {
    return;
  }
  manual.addingFolder = false;
  renderManualTabs();

  const name = rawName.trim();
  if (!name) {
    return;
  }
  if (manual.manuals.some((item) => item.name === name)) {
    showToast("같은 이름의 매뉴얼이 있습니다");
    return;
  }
  const created = await insertManual(name);
  if (!created) {
    showToast("매뉴얼을 만들지 못했습니다");
    return;
  }
  // 최신 매뉴얼이 맨 왼쪽에 온다. 새 매뉴얼은 바로 편집할 수 있게 연다.
  manual.manuals.unshift(created);
  setManual(created.id);
  manual.editing = true;
  renderManualBody();
}

function cancelManualFolder() {
  manual.addingFolder = false;
  renderManualTabs();
}

function cancelManualRename() {
  manual.renamingFolderId = null;
  renderManual();
}

async function commitManualRename(manualId, rawName) {
  if (manual.renamingFolderId !== manualId) {
    return;
  }
  manual.renamingFolderId = null;

  const target = manual.manuals.find((item) => item.id === manualId);
  const name = rawName.trim();
  if (!target || !name || name === target.name) {
    renderManual();
    return;
  }
  if (manual.manuals.some((item) => item.name === name)) {
    renderManual();
    showToast("같은 이름의 매뉴얼이 있습니다");
    return;
  }

  const previousName = target.name;
  const setName = (value) => {
    manual.manuals = manual.manuals.map((item) => (item.id === manualId ? { ...item, name: value } : item));
  };
  setName(name);
  renderManual();

  const result = await renameManualRow(manualId, name);
  if (result !== "ok") {
    setName(previousName);
    renderManual();
    showToast(result === "duplicate" ? "같은 이름의 매뉴얼이 있습니다" : SAVE_ERROR_MESSAGE);
  }
}

function openManualDelete(manualId) {
  const target = manual.manuals.find((item) => item.id === manualId);
  if (!target) {
    return;
  }
  manualDeleting = target;
  const count = manual.steps.filter((step) => step.manual_id === manualId).length;
  manualDeleteHeading.textContent = `'${target.name}' 매뉴얼을 삭제할까요?`;
  const body = element("p");
  if (count) {
    body.append(element("strong", null, `안에 있는 단계 ${count}개도 함께 삭제됩니다.`));
  } else {
    body.textContent = "매뉴얼에 단계가 없습니다.";
  }
  manualDeleteBody.replaceChildren(body);
  setManualDeleteBusy(false);
  setManualDeleteMessage("");
  manualDeleteOverlay.hidden = false;
  manualDeleteCancel.focus();
}

function closeManualDelete() {
  manualDeleting = null;
  manualDeleteOverlay.hidden = true;
}

function setManualDeleteBusy(busy) {
  manualDeleteConfirm.disabled = busy;
  manualDeleteCancel.disabled = busy;
}

function setManualDeleteMessage(text) {
  manualDeleteMessage.textContent = text;
  manualDeleteMessage.hidden = !text;
}

async function deleteManual() {
  const target = manualDeleting;
  if (!target) {
    return;
  }
  setManualDeleteBusy(true);
  setManualDeleteMessage("");
  if (!(await deleteManualRow(target.id))) {
    setManualDeleteBusy(false);
    setManualDeleteMessage(SAVE_ERROR_MESSAGE);
    return;
  }

  manual.manuals = manual.manuals.filter((item) => item.id !== target.id);
  manual.steps = manual.steps.filter((step) => step.manual_id !== target.id);
  if (manualDeleting === target) {
    closeManualDelete();
  }
  if (manual.currentManual === target.id) {
    setManual(manual.manuals.length ? manual.manuals[0].id : null);
  } else {
    renderManual();
  }
  showToast("매뉴얼을 삭제했습니다");
}

/* ---------- 불러오기 (app.js가 로그인·로그아웃 때 부른다) ---------- */

async function loadManual(userId) {
  manual.manuals = [];
  manual.steps = [];
  manual.status = "loading";
  renderManual();
  try {
    const [manuals, steps] = await Promise.all([fetchManuals(), fetchManualSteps()]);
    // 불러오는 사이에 로그아웃했다면 화면에 그리지 않는다.
    if (userId !== currentUserId) {
      return;
    }
    manual.manuals = manuals;
    manual.steps = steps;
    const stored = readStoredManual();
    manual.currentManual = manuals.some((item) => item.id === stored) ? stored : manuals.length ? manuals[0].id : null;
    manual.status = "ready";
  } catch {
    if (userId !== currentUserId) {
      return;
    }
    manual.status = "error";
  }
  renderManual();
}

function resetManual() {
  closeManualDelete();
  Object.assign(manual, {
    manuals: [],
    steps: [],
    currentManual: null,
    status: "loading",
    addingFolder: false,
    renamingFolderId: null,
    editing: false,
    confirmDeleteId: null,
    confirmReset: false,
    adding: false,
  });
  renderManual();
}

/* ---------- 이벤트 ---------- */

manualEditButton.addEventListener("click", toggleManualEditing);
manualResetButton.addEventListener("click", clickManualReset);
// 다른 곳을 누르면 초기화 확인을 취소한다.
manualResetButton.addEventListener("blur", () => {
  if (manual.confirmReset) {
    setResetConfirming(false);
  }
});
manualAddStage.addEventListener("click", () => addStep(null));
manualDeleteConfirm.addEventListener("click", deleteManual);
manualDeleteCancel.addEventListener("click", closeManualDelete);
manualDeleteOverlay.addEventListener("mousedown", (event) => {
  if (event.target === manualDeleteOverlay && !manualDeleteCancel.disabled) {
    closeManualDelete();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && manualDeleting && !manualDeleteCancel.disabled) {
    closeManualDelete();
  }
});
