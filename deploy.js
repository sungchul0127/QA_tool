// 별도배포확인: 배포 폴더(탭)마다 추가배포 건을 표로 적고 푸시·QC확인 여부를 체크한다.
// app.js 다음에 불러오며 client, element, button, showToast, createFolderInput 등을 함께 쓴다.

const DEPLOY_FOLDER_STORAGE_KEY = "qa-tool.deploy-folder";
const DEPLOY_ITEM_COLUMNS = "id, folder_id, qc, job_code, developer, file_types, note, pushed, qc_checked, sort_order";
const DEPLOY_FOLDER_COLUMNS = "id, name, sort_order";
const FILE_TYPES = ["3.0", "5.0", "5.6"];
// 표에서 직접 고치는 글자 칸. 순서가 곧 표의 열 순서다.
const DEPLOY_TEXT_FIELDS = [
  { key: "qc", label: "QC", maxLength: 50 },
  { key: "job_code", label: "잡코드", maxLength: 100 },
  { key: "developer", label: "개발자", maxLength: 50 },
];
const DEPLOY_NOTE_FIELD = { key: "note", label: "특이사항", maxLength: 500 };

const deployTabs = document.getElementById("deploy-tabs");
const deployProgress = document.getElementById("deploy-progress");
const deployMessage = document.getElementById("deploy-message");
const deployGrid = document.getElementById("deploy-grid");
const deployRows = document.getElementById("deploy-rows");
const deployAddRow = document.getElementById("deploy-add-row");
const deployDeleteOverlay = document.getElementById("deploy-folder-delete-overlay");
const deployDeleteHeading = document.getElementById("deploy-folder-delete-heading");
const deployDeleteBody = document.getElementById("deploy-folder-delete-body");
const deployDeleteMessage = document.getElementById("deploy-folder-delete-message");
const deployDeleteConfirm = document.getElementById("deploy-folder-delete-confirm");
const deployDeleteCancel = document.getElementById("deploy-folder-delete-cancel");

const deploy = {
  folders: [],
  items: [],
  currentFolder: null,
  status: "loading",
  addingFolder: false,
  renamingFolderId: null,
  // 삭제 버튼을 한 번 눌러 확인을 기다리는 행
  confirmRowId: null,
  addingRow: false,
};
let deployDeletingFolder = null;
let deployLastTabClick = { id: null, time: 0 };
// 끄는 중인 행 { id, index }
let deployDrag = null;

/* ---------- Supabase ---------- */

async function fetchDeployFolders() {
  const { data, error } = await client
    .from("deploy_folders")
    .select(DEPLOY_FOLDER_COLUMNS)
    .order("sort_order")
    .order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  return data;
}

async function fetchDeployItems() {
  const { data, error } = await client
    .from("deploy_items")
    .select(DEPLOY_ITEM_COLUMNS)
    .order("sort_order")
    .order("created_at");
  if (error) {
    throw error;
  }
  return data;
}

async function insertDeployItem(row) {
  const { data, error } = await client.from("deploy_items").insert(row).select(DEPLOY_ITEM_COLUMNS).single();
  return error ? null : data;
}

async function updateDeployItem(id, changes) {
  const { data, error } = await client.from("deploy_items").update(changes).eq("id", id).select("id");
  return !error && data.length > 0;
}

async function deleteDeployItem(id) {
  const { data, error } = await client.from("deploy_items").delete().eq("id", id).select("id");
  return !error && data.length > 0;
}

async function insertDeployFolder(name, sortOrder) {
  const { data, error } = await client
    .from("deploy_folders")
    .insert({ name, sort_order: sortOrder })
    .select(DEPLOY_FOLDER_COLUMNS)
    .single();
  return error ? null : data;
}

async function updateDeployFolderSortOrder(id, sortOrder) {
  const { data, error } = await client.from("deploy_folders").update({ sort_order: sortOrder }).eq("id", id).select("id");
  return !error && data.length > 0;
}

// 성공하면 "ok", 같은 이름이 있으면 "duplicate", 그 밖의 실패는 "error"를 돌려준다.
async function renameDeployFolderRow(id, name) {
  const { data, error } = await client.from("deploy_folders").update({ name }).eq("id", id).select("id");
  if (error) {
    return error.code === "23505" ? "duplicate" : "error";
  }
  return data.length ? "ok" : "error";
}

// 폴더를 지우면 DB에서 그 안의 배포 건도 함께 지워진다.
async function deleteDeployFolderRow(id) {
  const { data, error } = await client.from("deploy_folders").delete().eq("id", id).select("id");
  return !error && data.length > 0;
}

/* ---------- 도우미 ---------- */

function folderItems(folderId) {
  return deploy.items.filter((item) => item.folder_id === folderId);
}

function findItem(id) {
  return deploy.items.find((item) => item.id === id);
}

function patchItem(id, changes) {
  deploy.items = deploy.items.map((item) => (item.id === id ? { ...item, ...changes } : item));
}

// 빈 행이 섞여 있을 수 있어서, 잡코드가 적힌 행만 배포 건으로 센다.
function countedItems(folderId) {
  return folderItems(folderId).filter((item) => item.job_code);
}

function isDone(item) {
  return item.pushed && item.qc_checked;
}

function storeDeployFolder(id) {
  try {
    localStorage.setItem(DEPLOY_FOLDER_STORAGE_KEY, id || "");
  } catch {
    // 저장하지 못해도 이번 화면에서는 동작한다.
  }
}

function readStoredDeployFolder() {
  try {
    return localStorage.getItem(DEPLOY_FOLDER_STORAGE_KEY);
  } catch {
    return null;
  }
}

/* ---------- 그리기 ---------- */

function renderDeploy() {
  // 폴더 이름을 입력하는 중에 탭을 다시 그리면 입력창이 사라진다.
  if (!deploy.addingFolder && !deploy.renamingFolderId) {
    renderDeployTabs();
  }
  renderDeployBody();
}

function renderDeployTabs() {
  const tabs = [];
  if (deploy.addingFolder) {
    tabs.push(createFolderInput("", commitDeployFolder, cancelDeployFolder));
  }
  deploy.folders.forEach((folder) => {
    tabs.push(
      folder.id === deploy.renamingFolderId
        ? createFolderInput(folder.name, (value) => commitDeployRename(folder.id, value), cancelDeployRename)
        : createDeployTab(folder),
    );
  });

  const addButton = button("folder-add-button", "+", () => {
    if (deploy.renamingFolderId) {
      return;
    }
    deploy.addingFolder = true;
    renderDeployTabs();
  });
  addButton.title = "배포 폴더 추가";
  addButton.setAttribute("aria-label", "배포 폴더 추가");
  tabs.push(addButton);

  deployTabs.replaceChildren(...tabs);
  revealActiveTab(deployTabs);
  const nameInput = deployTabs.querySelector(".folder-name-input");
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }
}

function createDeployTab(folder) {
  const isActive = deploy.currentFolder === folder.id;
  const node = element("div", "folder-tab");
  node.classList.toggle("is-active", isActive);

  const label = button("folder-tab-button", undefined, () => clickDeployTab(folder.id));
  label.title = "더블클릭해서 이름 변경";
  label.append(element("span", null, folder.name), element("span", "folder-count", String(countedItems(folder.id).length)));
  node.append(label);

  if (isActive) {
    const deleteButton = button("folder-delete", "×", () => openDeployFolderDelete(folder.id));
    deleteButton.title = "폴더 삭제";
    deleteButton.setAttribute("aria-label", `'${folder.name}' 폴더 삭제`);
    node.append(deleteButton);
  }
  makeTabDraggable(node, deployTabs, folder.id, moveDeployTab);
  return node;
}

function moveDeployTab(dragId, targetId, after) {
  const ids = movedTabOrder(deploy.folders.map((folder) => folder.id), dragId, targetId, after);
  if (!ids) {
    return;
  }
  reorderTabs(
    deploy.folders,
    ids,
    (folders) => {
      deploy.folders = folders;
      renderDeploy();
    },
    updateDeployFolderSortOrder,
  );
}

function renderDeployBody() {
  let message = "";
  if (deploy.status === "loading") {
    message = "불러오는 중입니다.";
  } else if (deploy.status === "error") {
    message = "불러오지 못했습니다. 새로고침해 주세요.";
  } else if (!deploy.currentFolder) {
    message = "탭 옆 + 를 눌러 배포 폴더를 만들어 주세요.";
  }
  deployMessage.textContent = message;
  deployMessage.hidden = !message;
  deployGrid.hidden = Boolean(message);

  if (message) {
    deployProgress.hidden = true;
    deployRows.replaceChildren();
    return;
  }
  deployRows.replaceChildren(...folderItems(deploy.currentFolder).map(createDeployRow));
  renderDeployProgress();
}

function renderDeployProgress() {
  const items = deploy.currentFolder ? countedItems(deploy.currentFolder) : [];
  deployProgress.hidden = !items.length;
  if (!items.length) {
    return;
  }
  const pushed = items.filter((item) => item.pushed).length;
  const checked = items.filter((item) => item.qc_checked).length;
  deployProgress.replaceChildren(
    `${items.length}건 중 `,
    element("strong", null, `푸시 ${pushed}`),
    " · ",
    element("strong", null, `QC확인 ${checked}`),
  );
}

function createDeployRow(item, index) {
  const row = element("tr", "deploy-row");
  row.dataset.id = item.id;
  row.classList.toggle("is-done", isDone(item));

  const handleCell = element("td", "deploy-handle-cell");
  const handle = element("span", "drag-handle", "⋮⋮");
  handle.title = "끌어서 순서 변경";
  handle.draggable = true;
  handleCell.append(handle);

  const typesCell = element("td");
  const chips = element("div", "deploy-chips");
  FILE_TYPES.forEach((type) => {
    const chip = button("deploy-chip", type, () => toggleFileType(item.id, type));
    chip.dataset.type = type;
    chip.setAttribute("aria-pressed", String(item.file_types.includes(type)));
    chips.append(chip);
  });
  typesCell.append(chips);

  const deleteCell = element("td", "is-center");
  const deleteButton = button("deploy-row-delete", "×", () => clickRowDelete(item.id, deleteButton));
  setDeleteButtonConfirming(deleteButton, deploy.confirmRowId === item.id);
  // 다른 곳을 누르면 확인을 취소한다.
  deleteButton.addEventListener("blur", () => {
    if (deploy.confirmRowId === item.id) {
      deploy.confirmRowId = null;
      setDeleteButtonConfirming(deleteButton, false);
    }
  });
  deleteCell.append(deleteButton);

  row.append(
    handleCell,
    ...DEPLOY_TEXT_FIELDS.map((field) => createTextCell(item, field)),
    typesCell,
    createTextCell(item, DEPLOY_NOTE_FIELD),
    createCheckCell(item, "pushed", "푸시"),
    createCheckCell(item, "qc_checked", "QC확인"),
    deleteCell,
  );

  handle.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    event.dataTransfer.setDragImage(row, 16, 20);
    deployDrag = { id: item.id, index };
    requestAnimationFrame(() => row.classList.add("is-dragging"));
  });
  handle.addEventListener("dragend", () => endDeployDrag());
  row.addEventListener("dragover", (event) => {
    if (!deployDrag || deployDrag.id === item.id) {
      return;
    }
    event.preventDefault();
    markDeployDropTarget(row, index > deployDrag.index ? "is-drop-after" : "is-drop-before");
  });
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    if (!deployDrag || deployDrag.id === item.id) {
      return;
    }
    const id = deployDrag.id;
    endDeployDrag();
    reorderDeployItem(id, item.id);
  });

  return row;
}

function createTextCell(item, field) {
  const cell = element("td");
  const input = element("input", "deploy-input");
  input.type = "text";
  input.value = item[field.key];
  input.maxLength = field.maxLength;
  input.placeholder = field.label;
  input.dataset.field = field.key;
  input.setAttribute("aria-label", field.label);
  input.title = item[field.key];
  input.addEventListener("change", () => saveTextField(item.id, field.key, input));
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      focusNeighborCell(input, event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      const current = findItem(item.id);
      input.value = current ? current[field.key] : input.value;
      input.blur();
    }
  });
  cell.append(input);
  return cell;
}

function createCheckCell(item, key, label) {
  const cell = element("td", "is-center");
  const checkbox = element("input", "deploy-check");
  checkbox.type = "checkbox";
  checkbox.checked = item[key];
  checkbox.dataset.field = key;
  checkbox.setAttribute("aria-label", label);
  checkbox.addEventListener("change", () => saveCheck(item.id, key, checkbox.checked));
  cell.append(checkbox);
  return cell;
}

// Enter는 아래 행, Shift+Enter는 위 행의 같은 칸으로 옮긴다. 더 갈 곳이 없으면 입력을 마친다.
function focusNeighborCell(input, step) {
  const rows = [...deployRows.children];
  const index = rows.indexOf(input.closest("tr"));
  const target = rows[index + step];
  const next = target && target.querySelector(`.deploy-input[data-field="${input.dataset.field}"]`);
  if (next) {
    next.focus();
    next.select();
  } else {
    input.blur();
  }
}

// 표 안에서 화살표로 옮겨 다닐 수 있는 칸: 글자 칸, 파일 종류 칩, 체크박스
const DEPLOY_NAV_SELECTOR = ".deploy-input, .deploy-chip, .deploy-check";

// 화살표로 칸을 옮긴다. 위·아래는 늘 옮기고, 글자 칸에서 왼쪽·오른쪽은 커서가 끝에 닿았을 때만 옮긴다.
function handleDeployArrowKey(event) {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const move = moves[event.key];
  const current = event.target.closest(DEPLOY_NAV_SELECTOR);
  if (!move || !current) {
    return;
  }
  const [rowStep, colStep] = move;
  if (colStep && current.classList.contains("deploy-input")) {
    const { selectionStart, selectionEnd, value } = current;
    const atEdge = selectionStart === selectionEnd && selectionStart === (colStep < 0 ? 0 : value.length);
    if (!atEdge) {
      return;
    }
  }

  const rows = [...deployRows.children];
  const rowIndex = rows.indexOf(current.closest("tr"));
  const cells = [...rows[rowIndex].querySelectorAll(DEPLOY_NAV_SELECTOR)];
  const colIndex = cells.indexOf(current);
  let target;
  if (rowStep) {
    const targetRow = rows[rowIndex + rowStep];
    target = targetRow && targetRow.querySelectorAll(DEPLOY_NAV_SELECTOR)[colIndex];
  } else {
    target = cells[colIndex + colStep];
  }
  event.preventDefault();
  if (!target) {
    return;
  }
  target.focus();
  if (target.classList.contains("deploy-input")) {
    target.select();
  }
}

// 다시 그리지 않고 행의 표시만 고친다. 다른 칸에 입력 중이어도 포커스가 유지된다.
function refreshRow(id) {
  const item = findItem(id);
  const row = deployRows.querySelector(`tr[data-id="${id}"]`);
  if (!item || !row) {
    return;
  }
  row.classList.toggle("is-done", isDone(item));
  row.querySelectorAll(".deploy-chip").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(item.file_types.includes(chip.dataset.type)));
  });
  row.querySelectorAll(".deploy-check").forEach((checkbox) => {
    checkbox.checked = item[checkbox.dataset.field];
  });
  row.querySelectorAll(".deploy-input").forEach((input) => {
    if (document.activeElement !== input) {
      input.value = item[input.dataset.field];
    }
    input.title = item[input.dataset.field];
  });
  renderDeployProgress();
  // 잡코드를 적거나 지우면 탭의 건수도 바뀐다. 폴더 이름을 입력하는 중이면 탭을 그대로 둔다.
  if (!deploy.addingFolder && !deploy.renamingFolderId) {
    renderDeployTabs();
  }
}

function markDeployDropTarget(row, className) {
  deployRows.querySelectorAll(".is-drop-before, .is-drop-after").forEach((node) => {
    if (node !== row) {
      node.classList.remove("is-drop-before", "is-drop-after");
    }
  });
  row.classList.remove("is-drop-before", "is-drop-after");
  row.classList.add(className);
}

function endDeployDrag() {
  deployDrag = null;
  deployRows.querySelectorAll(".is-dragging, .is-drop-before, .is-drop-after").forEach((node) => {
    node.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
  });
}

/* ---------- 행 동작 ---------- */

// 먼저 화면에 반영하고, 저장에 실패하면 되돌린다.
async function saveItemChanges(id, changes) {
  const item = findItem(id);
  if (!item) {
    return;
  }
  const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, item[key]]));
  patchItem(id, changes);
  refreshRow(id);

  if (!(await updateDeployItem(id, changes))) {
    if (findItem(id)) {
      patchItem(id, previous);
      refreshRow(id);
    }
    showToast(SAVE_ERROR_MESSAGE);
  }
}

function saveTextField(id, key, input) {
  const item = findItem(id);
  const value = input.value.trim();
  if (!item || value === item[key]) {
    return;
  }
  saveItemChanges(id, { [key]: value });
}

function saveCheck(id, key, checked) {
  saveItemChanges(id, { [key]: checked });
}

function toggleFileType(id, type) {
  const item = findItem(id);
  if (!item) {
    return;
  }
  const next = item.file_types.includes(type)
    ? item.file_types.filter((t) => t !== type)
    : FILE_TYPES.filter((t) => t === type || item.file_types.includes(t));
  saveItemChanges(id, { file_types: next });
}

async function addDeployRow() {
  const folderId = deploy.currentFolder;
  if (!folderId || deploy.addingRow) {
    return;
  }
  deploy.addingRow = true;
  deployAddRow.disabled = true;

  // 완료되지 않은 마지막 행 바로 뒤, 즉 아래쪽 완료 행들 바로 위에 넣는다. 완료 행이 없으면 맨 아래.
  const items = folderItems(folderId);
  let lastPending = -1;
  items.forEach((item, i) => {
    if (!isDone(item)) {
      lastPending = i;
    }
  });
  const before = items[lastPending];
  const after = items[lastPending + 1];

  let sortOrder;
  let renumbered = [];
  if (before && after) {
    if (after.sort_order - before.sort_order < MIN_SORT_GAP) {
      // 간격이 너무 좁으면 폴더 안 순서를 1, 2, 3...으로 다시 매기고 그 사이에 넣는다.
      renumbered = items
        .map((item, i) => ({ id: item.id, sort_order: i < lastPending + 1 ? i + 1 : i + 2 }))
        .filter((change, i) => items[i].sort_order !== change.sort_order);
      sortOrder = lastPending + 2;
    } else {
      sortOrder = (before.sort_order + after.sort_order) / 2;
    }
  } else if (before) {
    sortOrder = before.sort_order + 1;
  } else if (after) {
    sortOrder = after.sort_order - 1;
  } else {
    sortOrder = 1;
  }

  const renumberResults = await Promise.all(
    renumbered.map((change) => updateDeployItem(change.id, { sort_order: change.sort_order })),
  );
  const saved = renumberResults.every(Boolean)
    ? await insertDeployItem({ folder_id: folderId, sort_order: sortOrder })
    : null;

  deploy.addingRow = false;
  deployAddRow.disabled = false;
  if (renumbered.length > 0) {
    // 일부만 저장됐을 수 있으므로 성공 여부와 관계없이 화면 순서를 서버 기준에 맞춘다.
    const newOrders = new Map(
      renumbered.filter((_, i) => renumberResults[i]).map((change) => [change.id, change.sort_order]),
    );
    deploy.items = deploy.items.map((item) =>
      newOrders.has(item.id) ? { ...item, sort_order: newOrders.get(item.id) } : item,
    );
  }
  if (!saved) {
    deploy.items = sortItems(deploy.items);
    renderDeploy();
    showToast(SAVE_ERROR_MESSAGE);
    return;
  }
  deploy.items = sortItems([...deploy.items, saved]);
  renderDeploy();
  if (deploy.currentFolder === folderId) {
    const input = deployRows.querySelector(`tr[data-id="${saved.id}"] .deploy-input`);
    if (input) {
      input.focus();
    }
  }
}

function setDeleteButtonConfirming(deleteButton, confirming) {
  deleteButton.classList.toggle("is-confirming", confirming);
  deleteButton.textContent = confirming ? "삭제" : "×";
  deleteButton.title = confirming ? "한 번 더 누르면 삭제" : "행 삭제";
  deleteButton.setAttribute("aria-label", confirming ? "삭제 확인" : "행 삭제");
}

// 첫 클릭은 확인을 기다리고, 한 번 더 누르면 지운다.
// 다시 그리면 포커스된 버튼이 사라지며 blur로 확인이 풀리므로, 버튼을 그 자리에서 바꾼다.
async function clickRowDelete(id, deleteButton) {
  if (deploy.confirmRowId !== id) {
    deploy.confirmRowId = id;
    setDeleteButtonConfirming(deleteButton, true);
    deleteButton.focus();
    return;
  }

  deploy.confirmRowId = null;
  setDeleteButtonConfirming(deleteButton, false);
  if (!(await deleteDeployItem(id))) {
    showToast("삭제하지 못했습니다");
    return;
  }
  deploy.items = deploy.items.filter((item) => item.id !== id);
  renderDeploy();
  showToast("삭제했습니다");
}

async function reorderDeployItem(dragId, targetId) {
  const visible = folderItems(deploy.currentFolder);
  const from = visible.findIndex((item) => item.id === dragId);
  const to = visible.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) {
    return;
  }

  // 아래로 옮기면 대상 뒤에, 위로 옮기면 대상 앞에 놓는다(끄는 중 표시선과 같은 위치).
  const ordered = visible.filter((item) => item.id !== dragId);
  const index = ordered.findIndex((item) => item.id === targetId) + (from < to ? 1 : 0);
  ordered.splice(index, 0, visible[from]);

  const before = ordered[index - 1];
  const after = ordered[index + 1];
  let changes;
  if (before && after && after.sort_order - before.sort_order < MIN_SORT_GAP) {
    changes = ordered
      .map((item, i) => ({ id: item.id, sort_order: i + 1 }))
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

  const previous = deploy.items;
  const newOrders = new Map(changes.map((change) => [change.id, change.sort_order]));
  deploy.items = sortItems(
    deploy.items.map((item) => (newOrders.has(item.id) ? { ...item, sort_order: newOrders.get(item.id) } : item)),
  );
  renderDeployBody();

  const results = await Promise.all(changes.map((change) => updateDeployItem(change.id, { sort_order: change.sort_order })));
  if (!results.every(Boolean)) {
    deploy.items = previous;
    renderDeployBody();
    showToast(SAVE_ERROR_MESSAGE);
  }
}

function sortItems(items) {
  return [...items].sort((a, b) => a.sort_order - b.sort_order);
}

/* ---------- 폴더 동작 ---------- */

function setDeployFolder(id) {
  deploy.currentFolder = id;
  deploy.confirmRowId = null;
  storeDeployFolder(id);
  renderDeploy();
}

// 첫 클릭에 탭을 다시 그리므로 브라우저의 dblclick이 오지 않는다. 그래서 같은 탭을 연달아 누른 것을 직접 센다.
function clickDeployTab(id) {
  const now = Date.now();
  const isDouble = deployLastTabClick.id === id && now - deployLastTabClick.time < DOUBLE_CLICK_MS;
  deployLastTabClick = isDouble ? { id: null, time: 0 } : { id, time: now };
  if (isDouble && !deploy.addingFolder) {
    deploy.renamingFolderId = id;
    renderDeployTabs();
  } else {
    setDeployFolder(id);
  }
}

async function commitDeployFolder(rawName) {
  // Enter로 만든 뒤 입력창이 사라지면서 blur가 한 번 더 올 수 있다.
  if (!deploy.addingFolder) {
    return;
  }
  deploy.addingFolder = false;
  renderDeployTabs();

  const name = rawName.trim();
  if (!name) {
    return;
  }
  if (deploy.folders.some((folder) => folder.name === name)) {
    showToast("같은 이름의 폴더가 있습니다");
    return;
  }
  // 새 폴더는 맨 왼쪽에 온다.
  const firstOrder = deploy.folders.reduce((min, f) => Math.min(min, f.sort_order), 1);
  const folder = await insertDeployFolder(name, firstOrder - 1);
  if (!folder) {
    showToast("폴더를 만들지 못했습니다");
    return;
  }
  deploy.folders.unshift(folder);
  setDeployFolder(folder.id);
}

function cancelDeployFolder() {
  deploy.addingFolder = false;
  renderDeployTabs();
}

function cancelDeployRename() {
  deploy.renamingFolderId = null;
  renderDeploy();
}

async function commitDeployRename(folderId, rawName) {
  if (deploy.renamingFolderId !== folderId) {
    return;
  }
  deploy.renamingFolderId = null;

  const folder = deploy.folders.find((f) => f.id === folderId);
  const name = rawName.trim();
  if (!folder || !name || name === folder.name) {
    renderDeploy();
    return;
  }
  if (deploy.folders.some((f) => f.name === name)) {
    renderDeploy();
    showToast("같은 이름의 폴더가 있습니다");
    return;
  }

  const previousName = folder.name;
  const setName = (value) => {
    deploy.folders = deploy.folders.map((f) => (f.id === folderId ? { ...f, name: value } : f));
  };
  setName(name);
  renderDeploy();

  const result = await renameDeployFolderRow(folderId, name);
  if (result !== "ok") {
    setName(previousName);
    renderDeploy();
    showToast(result === "duplicate" ? "같은 이름의 폴더가 있습니다" : SAVE_ERROR_MESSAGE);
  }
}

function openDeployFolderDelete(folderId) {
  const folder = deploy.folders.find((f) => f.id === folderId);
  if (!folder) {
    return;
  }
  deployDeletingFolder = folder;
  const count = folderItems(folderId).length;
  deployDeleteHeading.textContent = `'${folder.name}' 폴더를 삭제할까요?`;
  const body = element("p");
  if (count) {
    body.append(element("strong", null, `안에 있는 배포 건 ${count}개도 함께 삭제됩니다.`));
  } else {
    body.textContent = "폴더에 배포 건이 없습니다.";
  }
  deployDeleteBody.replaceChildren(body);
  setDeployDeleteBusy(false);
  setDeployDeleteMessage("");
  deployDeleteOverlay.hidden = false;
  deployDeleteCancel.focus();
}

function closeDeployFolderDelete() {
  deployDeletingFolder = null;
  deployDeleteOverlay.hidden = true;
}

function setDeployDeleteBusy(busy) {
  deployDeleteConfirm.disabled = busy;
  deployDeleteCancel.disabled = busy;
}

function setDeployDeleteMessage(text) {
  deployDeleteMessage.textContent = text;
  deployDeleteMessage.hidden = !text;
}

async function deleteDeployFolder() {
  const folder = deployDeletingFolder;
  if (!folder) {
    return;
  }
  setDeployDeleteBusy(true);
  setDeployDeleteMessage("");
  if (!(await deleteDeployFolderRow(folder.id))) {
    setDeployDeleteBusy(false);
    setDeployDeleteMessage(SAVE_ERROR_MESSAGE);
    return;
  }

  deploy.folders = deploy.folders.filter((f) => f.id !== folder.id);
  deploy.items = deploy.items.filter((item) => item.folder_id !== folder.id);
  if (deployDeletingFolder === folder) {
    closeDeployFolderDelete();
  }
  if (deploy.currentFolder === folder.id) {
    setDeployFolder(deploy.folders.length ? deploy.folders[0].id : null);
  } else {
    renderDeploy();
  }
  showToast("폴더를 삭제했습니다");
}

/* ---------- 불러오기 (app.js가 로그인·로그아웃 때 부른다) ---------- */

async function loadDeploy(userId) {
  deploy.folders = [];
  deploy.items = [];
  deploy.status = "loading";
  renderDeploy();
  try {
    const [folders, items] = await Promise.all([fetchDeployFolders(), fetchDeployItems()]);
    // 불러오는 사이에 로그아웃했다면 화면에 그리지 않는다.
    if (userId !== currentUserId) {
      return;
    }
    deploy.folders = folders;
    deploy.items = items;
    const stored = readStoredDeployFolder();
    deploy.currentFolder = folders.some((f) => f.id === stored) ? stored : folders.length ? folders[0].id : null;
    deploy.status = "ready";
  } catch {
    if (userId !== currentUserId) {
      return;
    }
    deploy.status = "error";
  }
  renderDeploy();
}

function resetDeploy() {
  closeDeployFolderDelete();
  Object.assign(deploy, {
    folders: [],
    items: [],
    currentFolder: null,
    status: "loading",
    addingFolder: false,
    renamingFolderId: null,
    confirmRowId: null,
    addingRow: false,
  });
  renderDeploy();
}

/* ---------- 이벤트 ---------- */

deployAddRow.addEventListener("click", addDeployRow);
deployRows.addEventListener("keydown", handleDeployArrowKey);
deployDeleteConfirm.addEventListener("click", deleteDeployFolder);
deployDeleteCancel.addEventListener("click", closeDeployFolderDelete);
deployDeleteOverlay.addEventListener("mousedown", (event) => {
  if (event.target === deployDeleteOverlay && !deployDeleteCancel.disabled) {
    closeDeployFolderDelete();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && deployDeletingFolder && !deployDeleteCancel.disabled) {
    closeDeployFolderDelete();
  }
});
