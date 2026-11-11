// 공개되어도 되는 값이다. 데이터 접근은 supabase/schema.sql의 권한 규칙으로 막는다.
const SUPABASE_URL = "https://ljnpbdwhgenrxccinnno.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_VSwsbTaZvwRHuUv3yKIQoQ_SHZxMwkD";

const LEGACY_STORAGE_KEY = "qa-tool.phrases";
const FOLDER_STORAGE_KEY = "qa-tool.current-folder";
const TOOL_STORAGE_KEY = "qa-tool.current-tool";
const TOOLS = ["phrases", "deploy", "manual"];
const COPY_FEEDBACK_MS = 1500;
const TOAST_MS = 1500;
const SAVE_ERROR_MESSAGE = "저장하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.";
const REQUIRED_MESSAGE = "제목과 내용을 모두 입력해 주세요.";
const EMPTY_LIST_MESSAGE = "아직 등록된 문구가 없습니다.";
const EMPTY_FOLDER_MESSAGE = "이 폴더에 문구가 없습니다.";
const LOADING_MESSAGE = "문구를 불러오는 중입니다.";
const LOAD_ERROR_MESSAGE = "문구를 불러오지 못했습니다. 새로고침해 주세요.";
// 시간 변수가 분 단위라 분이 바뀐 걸 늦지 않게 알아차리도록 자주 확인한다.
const DATE_CHECK_MS = 10000;
const DOUBLE_CLICK_MS = 400;
// 중간값으로 끼워 넣다가 간격이 이보다 좁아지면 전체 순서를 다시 매긴다.
const MIN_SORT_GAP = 1e-6;
const PHRASE_COLUMNS = "id, title, text, sort_order, phrase_folders(folder_id)";
const FOLDER_COLUMNS = "id, name, sort_order";

const pad = (value) => String(value).padStart(2, "0");

const DATE_FORMATS = {
  "YYYY-MM-DD": (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  "YYYY.MM.DD": (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`,
  "MM/DD": (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
  MMDD: (d) => `${pad(d.getMonth() + 1)}${pad(d.getDate())}`,
  "M월 D일": (d) => `${d.getMonth() + 1}월 ${d.getDate()}일`,
};

const addDays = (d, days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

const DATE_BASES = [
  { label: "오늘", prefix: "", resolve: (d) => d },
  { label: "내일", prefix: "내일 ", resolve: (d) => addDays(d, 1) },
  // 오늘 이후 가장 가까운 월요일이다. 월요일에는 7일 뒤, 일요일에는 다음 날이 된다.
  { label: "다음주 월요일", prefix: "다음주 월요일 ", resolve: (d) => addDays(d, (8 - d.getDay()) % 7 || 7) },
];

// 캡처 그룹이 하나뿐이라 split 결과의 홀수 번째 항목이 변수가 된다.
// 지금으로부터 몇 시간 뒤의 시각을 10분 단위로 올림한 값이다. 자정을 넘기면 다음 날 시각이 되며 날짜는 붙지 않는다.
const TIME_OFFSET_HOURS = 2;
const TIME_TOKEN = "{2시간 뒤 HH시 mm분}";
const DATE_VARIABLE_PATTERN =
  /(\{(?:(?:내일 |다음주 월요일 )?(?:YYYY-MM-DD|YYYY\.MM\.DD|MM\/DD|MMDD|M월 D일)|2시간 뒤 HH시 mm분)\})/;

const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const loginView = document.getElementById("login-view");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginMessage = document.getElementById("login-message");
const toolNav = document.getElementById("tool-nav");
const account = document.getElementById("account");
const accountEmail = document.getElementById("account-email");
const logoutButton = document.getElementById("logout-button");
const appView = document.getElementById("app-view");
const deployView = document.getElementById("deploy-view");
const manualView = document.getElementById("manual-view");
const toolLinks = [...toolNav.querySelectorAll(".tool-link")];
const folderTabs = document.getElementById("folder-tabs");
const newPhraseButton = document.getElementById("new-phrase-button");
const listMessage = document.getElementById("list-message");
const list = document.getElementById("phrase-list");
const editorOverlay = document.getElementById("editor-overlay");
const editorForm = document.getElementById("editor-form");
const editorHeading = document.getElementById("editor-heading");
const editorTitle = document.getElementById("editor-title");
const editorFolders = document.getElementById("editor-folders");
const editorTextField = document.getElementById("editor-text-field");
const editorText = document.getElementById("editor-text");
const editorMessage = document.getElementById("editor-message");
const editorHint = document.getElementById("editor-hint");
const editorSave = document.getElementById("editor-save");
const editorCancel = document.getElementById("editor-cancel");
const folderDeleteOverlay = document.getElementById("folder-delete-overlay");
const folderDeleteHeading = document.getElementById("folder-delete-heading");
const folderDeleteBody = document.getElementById("folder-delete-body");
const folderDeleteMessage = document.getElementById("folder-delete-message");
const folderDeleteWithPhrases = document.getElementById("folder-delete-with-phrases");
const folderDeleteOnly = document.getElementById("folder-delete-only");
const folderDeleteCancel = document.getElementById("folder-delete-cancel");
const toast = document.getElementById("toast");

let shownDate = dateKey();
let shownTime = timeKey();
// undefined는 아직 로그인 상태를 확인하지 못했다는 뜻이다.
let currentUserId;

const state = {
  phrases: [],
  folders: [],
  currentFolder: "all",
  listStatus: "loading",
  selectedId: null,
  copiedId: null,
  // { id, busy, failed }
  confirmDelete: null,
  addingFolder: false,
  renamingFolderId: null,
};
// null 또는 { mode: "new" | "edit", id }
let editor = null;
// 삭제 확인창을 띄운 폴더. null이면 닫혀 있다.
let deletingFolder = null;
let lastTabClick = { key: null, time: 0 };
// 끄는 중인 문구. 끄는 동안 목록을 다시 그리면 끌기가 끊기므로 그리기를 미룬다.
let drag = null;
let renderPending = false;
let copiedTimer;
let toastTimer;

/* ---------- Supabase ---------- */

// 연결 테이블 행을 폴더 id 목록으로 바꿔 둔다.
function toPhrase(row) {
  const { phrase_folders: links = [], ...phrase } = row;
  return { ...phrase, folder_ids: links.map((link) => link.folder_id) };
}

async function fetchPhrases() {
  const { data, error } = await client
    .from("phrases")
    .select(PHRASE_COLUMNS)
    .order("sort_order")
    .order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  return data.map(toPhrase);
}

async function fetchFolders() {
  const { data, error } = await client
    .from("folders")
    .select(FOLDER_COLUMNS)
    .order("sort_order")
    .order("created_at");
  if (error) {
    throw error;
  }
  return data;
}

async function insertPhrase(row) {
  const { data, error } = await client.from("phrases").insert(row).select(PHRASE_COLUMNS).single();
  return error ? null : toPhrase(data);
}

async function updatePhrase(id, changes) {
  const { data, error } = await client
    .from("phrases")
    .update(changes)
    .eq("id", id)
    .select(PHRASE_COLUMNS)
    .single();
  return error ? null : toPhrase(data);
}

async function deletePhrases(ids) {
  const { data, error } = await client.from("phrases").delete().in("id", ids).select("id");
  // 권한 규칙에 막히면 오류 없이 0건이 되므로 실제로 지워진 id를 돌려준다.
  return error ? [] : data.map((row) => row.id);
}

async function addPhraseFolders(phraseId, folderIds) {
  if (!folderIds.length) {
    return true;
  }
  const rows = folderIds.map((folderId) => ({ phrase_id: phraseId, folder_id: folderId }));
  const { error } = await client.from("phrase_folders").insert(rows);
  return !error;
}

async function removePhraseFolders(phraseId, folderIds) {
  if (!folderIds.length) {
    return true;
  }
  const { error } = await client
    .from("phrase_folders")
    .delete()
    .eq("phrase_id", phraseId)
    .in("folder_id", folderIds);
  return !error;
}

// 문구가 들어 있는 폴더를 nextIds로 맞춘다.
async function setPhraseFolders(phraseId, currentIds, nextIds) {
  const added = nextIds.filter((id) => !currentIds.includes(id));
  const removed = currentIds.filter((id) => !nextIds.includes(id));
  const [addedOk, removedOk] = await Promise.all([
    addPhraseFolders(phraseId, added),
    removePhraseFolders(phraseId, removed),
  ]);
  return addedOk && removedOk;
}

async function updateSortOrders(changes) {
  const results = await Promise.all(changes.map((change) => updatePhrase(change.id, { sort_order: change.sort_order })));
  return results.every(Boolean);
}

async function insertFolder(name, sortOrder) {
  const { data, error } = await client
    .from("folders")
    .insert({ name, sort_order: sortOrder })
    .select(FOLDER_COLUMNS)
    .single();
  return error ? null : data;
}

// 성공하면 "ok", 같은 이름이 있으면 "duplicate", 그 밖의 실패는 "error"를 돌려준다.
async function renameFolderRow(id, name) {
  const { data, error } = await client.from("folders").update({ name }).eq("id", id).select("id");
  if (error) {
    // 23505: 사용자별 폴더 이름 고유 조건 위반
    return error.code === "23505" ? "duplicate" : "error";
  }
  return data.length ? "ok" : "error";
}

async function updateFolderSortOrder(id, sortOrder) {
  const { data, error } = await client.from("folders").update({ sort_order: sortOrder }).eq("id", id).select("id");
  return !error && data.length > 0;
}

async function deleteFolderRow(id) {
  const { data, error } = await client.from("folders").delete().eq("id", id).select("id");
  return !error && data.length > 0;
}

// 온라인 저장 전에 이 브라우저에 저장해 둔 문구를 한 번만 옮긴다.
async function importLegacyPhrases() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return;
  }
  if (!Array.isArray(saved)) {
    return;
  }
  if (!saved.length) {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return;
  }

  // 옮긴 문구를 기존 문구보다 위에, 저장되어 있던 순서대로 놓는다.
  const { data: first, error: firstError } = await client
    .from("phrases")
    .select("sort_order")
    .order("sort_order")
    .limit(1);
  if (firstError) {
    return;
  }
  const start = (first.length ? first[0].sort_order : 1) - saved.length;
  const now = Date.now();
  const rows = saved.map((phrase, index) => ({
    title: phrase.text.split("\n")[0].slice(0, 100),
    text: phrase.text,
    created_at: new Date(now - index).toISOString(),
    sort_order: start + index,
  }));
  const { error } = await client.from("phrases").insert(rows);
  if (!error) {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

/* ---------- 날짜 변수 ---------- */

function dateKey() {
  return DATE_FORMATS["YYYY-MM-DD"](new Date());
}

function timeKey() {
  const now = new Date();
  return `${dateKey()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatDateVariable(token, date) {
  if (token === TIME_TOKEN) {
    const later = new Date(date.getTime() + TIME_OFFSET_HOURS * 60 * 60 * 1000);
    // 분은 10분 단위로 올림한다. 60분이 되면 setMinutes가 다음 시로 넘겨 준다.
    later.setMinutes(Math.ceil(later.getMinutes() / 10) * 10);
    return `${pad(later.getHours())}시 ${pad(later.getMinutes())}분`;
  }
  const inner = token.slice(1, -1);
  const base = DATE_BASES.find((b) => b.prefix && inner.startsWith(b.prefix)) || DATE_BASES[0];
  return DATE_FORMATS[inner.slice(base.prefix.length)](base.resolve(date));
}

function applyDateVariables(template, date) {
  return template
    .split(DATE_VARIABLE_PATTERN)
    .map((part, index) => (index % 2 ? formatDateVariable(part, date) : part))
    .join("");
}

function refreshDates() {
  if (timeKey() === shownTime) {
    return;
  }
  shownTime = timeKey();
  const dateChanged = dateKey() !== shownDate;
  shownDate = dateKey();

  const date = new Date();
  document.querySelectorAll(".date-button").forEach((button) => {
    button.textContent = formatDateVariable(button.dataset.token, date);
  });
  // 미리보기도 지금 기준으로 다시 그린다. 시간 변수는 분마다 바뀌므로 그 문구가 있을 때만 매분 그린다.
  if (dateChanged || state.phrases.some((phrase) => phrase.text.includes(TIME_TOKEN))) {
    render();
  }
}

function createVariableButton(token, textarea, date) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "date-button";
  button.dataset.token = token;
  button.title = token;
  button.textContent = formatDateVariable(token, date);
  button.addEventListener("click", () => {
    textarea.setRangeText(token, textarea.selectionStart, textarea.selectionEnd, "end");
    textarea.focus();
  });
  return button;
}

function createVariableRow(labelText, buttons) {
  const row = document.createElement("div");
  row.className = "date-row";
  const label = document.createElement("span");
  label.className = "date-label";
  label.textContent = labelText;
  row.append(label, ...buttons);
  return row;
}

function createDateToolbar(textarea) {
  const toolbar = document.createElement("div");
  toolbar.className = "date-toolbar";

  const heading = document.createElement("div");
  heading.className = "date-toolbar-heading";
  heading.textContent = "날짜·시간 넣기 · 복사할 때 실제 값으로 바뀝니다";
  toolbar.append(heading);

  const date = new Date();
  DATE_BASES.forEach((base) => {
    const buttons = Object.keys(DATE_FORMATS).map((format) =>
      createVariableButton(`{${base.prefix}${format}}`, textarea, date),
    );
    toolbar.append(createVariableRow(base.label, buttons));
  });
  toolbar.append(createVariableRow(`${TIME_OFFSET_HOURS}시간 뒤`, [createVariableButton(TIME_TOKEN, textarea, date)]));

  return toolbar;
}

/* ---------- 공통 도우미 ---------- */

async function copyText(text) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한 거부 등으로 실패하면 아래 방식으로 다시 시도한다.
    }
  }

  // HTTPS가 아닌 주소에서는 navigator.clipboard를 쓸 수 없다.
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.append(helper);
  helper.select();
  const copied = document.execCommand("copy");
  helper.remove();
  return copied;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function button(className, text, onClick) {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", (event) => {
    // 행을 누르면 선택되므로 버튼 클릭이 행까지 전해지지 않게 한다.
    event.stopPropagation();
    onClick(event);
  });
  return node;
}

function showToast(text) {
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.hidden = true;
  // 연달아 띄울 때도 등장 애니메이션이 다시 나오게 한다.
  void toast.offsetWidth;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, TOAST_MS);
}

function readStoredTool() {
  try {
    const tool = localStorage.getItem(TOOL_STORAGE_KEY);
    return TOOLS.includes(tool) ? tool : "phrases";
  } catch {
    return "phrases";
  }
}

function setTool(tool) {
  appView.hidden = tool !== "phrases";
  deployView.hidden = tool !== "deploy";
  manualView.hidden = tool !== "manual";
  toolLinks.forEach((link) => {
    const isActive = link.dataset.tool === tool;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
  try {
    localStorage.setItem(TOOL_STORAGE_KEY, tool);
  } catch {
    // 저장하지 못해도 이번 화면에서는 동작한다.
  }
}

function readStoredFolder() {
  try {
    return localStorage.getItem(FOLDER_STORAGE_KEY) || "all";
  } catch {
    return "all";
  }
}

function storeFolder(key) {
  try {
    localStorage.setItem(FOLDER_STORAGE_KEY, key);
  } catch {
    // 저장하지 못해도 이번 화면에서는 동작한다.
  }
}

function visiblePhrases() {
  if (state.currentFolder === "all") {
    return state.phrases;
  }
  return state.phrases.filter((phrase) => phrase.folder_ids.includes(state.currentFolder));
}

function phrasesInFolder(folderId) {
  return state.phrases.filter((phrase) => phrase.folder_ids.includes(folderId));
}

function folderName(id) {
  const folder = state.folders.find((f) => f.id === id);
  return folder ? folder.name : "";
}

function isTyping() {
  return /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
}

/* ---------- 그리기 ---------- */

function render() {
  if (drag) {
    renderPending = true;
    return;
  }
  renderPending = false;
  // 폴더 이름을 입력하는 중에 탭을 다시 그리면 입력창이 사라지므로 입력이 끝난 뒤 그린다.
  if (!state.addingFolder && !state.renamingFolderId) {
    renderTabs();
  }
  renderList();
}

function renderTabs() {
  const tabs = [
    { key: "all", name: "전체", count: state.phrases.length },
    ...state.folders.map((folder) => ({
      key: folder.id,
      name: folder.name,
      count: phrasesInFolder(folder.id).length,
    })),
  ].map((tab) =>
    tab.key === state.renamingFolderId
      ? createFolderInput(tab.name, (value) => commitRename(tab.key, value), cancelRename)
      : createFolderTab(tab),
  );

  if (state.addingFolder) {
    tabs.push(createFolderInput("", commitFolder, cancelAddFolder));
  }

  tabs.push(
    button("folder-add-button", "+", () => {
      state.addingFolder = true;
      renderTabs();
    }),
  );
  tabs[tabs.length - 1].title = "폴더 추가";
  tabs[tabs.length - 1].setAttribute("aria-label", "폴더 추가");

  folderTabs.replaceChildren(...tabs);
  const folderInput = folderTabs.querySelector(".folder-name-input");
  if (folderInput) {
    folderInput.focus();
    folderInput.select();
  }
}

function createFolderTab(tab) {
  const isActive = state.currentFolder === tab.key;
  const node = element("div", "folder-tab");
  node.classList.toggle("is-active", isActive);
  node.dataset.folderId = tab.key;

  const label = button("folder-tab-button", undefined, () => clickFolderTab(tab.key));
  label.append(element("span", null, tab.name), element("span", "folder-count", String(tab.count)));
  node.append(label);

  // "전체"는 폴더가 아니므로 이름을 바꾸거나 지우거나 문구를 놓을 수 없다.
  if (tab.key === "all") {
    return node;
  }

  label.title = "더블클릭해서 이름 변경";
  if (isActive) {
    const deleteButton = button("folder-delete", "×", () => openFolderDelete(tab.key));
    deleteButton.title = "폴더 삭제";
    deleteButton.setAttribute("aria-label", `'${tab.name}' 폴더 삭제`);
    node.append(deleteButton);
  }
  makeTabDraggable(node, folderTabs, tab.key, moveFolderTab);

  node.addEventListener("dragover", (event) => {
    if (!drag) {
      return;
    }
    event.preventDefault();
    node.classList.add("is-drop-target");
  });
  node.addEventListener("dragleave", (event) => {
    // 탭 안의 버튼 사이를 지날 때는 표시를 유지한다.
    if (!node.contains(event.relatedTarget)) {
      node.classList.remove("is-drop-target");
    }
  });
  node.addEventListener("drop", (event) => {
    event.preventDefault();
    if (!drag) {
      return;
    }
    const id = drag.id;
    endDrag();
    addPhraseToFolder(id, tab.key);
  });
  return node;
}

function createFolderInput(value, onCommit, onCancel) {
  const folderInput = element("input", "folder-name-input");
  folderInput.type = "text";
  folderInput.maxLength = 50;
  folderInput.value = value;
  folderInput.placeholder = "폴더 이름 후 Enter";
  folderInput.setAttribute("aria-label", value ? "폴더 이름 변경" : "새 폴더 이름");
  folderInput.addEventListener("keydown", (event) => {
    if (event.isComposing) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit(folderInput.value);
    } else if (event.key === "Escape") {
      onCancel();
    }
  });
  folderInput.addEventListener("blur", () => onCommit(folderInput.value));
  return folderInput;
}

/* ---------- 탭 끌어서 순서 바꾸기 (세 메뉴 공통) ---------- */

// 끄는 중인 탭 { container, id }. 문구를 탭에 놓는 끌기(drag)와는 따로 둔다.
let tabDrag = null;

function clearTabDropMarks() {
  document.querySelectorAll(".folder-tab.is-drop-before, .folder-tab.is-drop-after, .folder-tab.is-dragging").forEach((node) => {
    node.classList.remove("is-drop-before", "is-drop-after", "is-dragging");
  });
}

function endTabDrag() {
  tabDrag = null;
  clearTabDropMarks();
}

// 끄는 동안 탭을 다시 그려 원래 탭이 사라지면 dragend가 오지 않을 수 있다.
document.addEventListener("dragend", () => tabDrag && endTabDrag());
document.addEventListener("drop", () => tabDrag && endTabDrag());

// 같은 탭 줄 안에서만 옮길 수 있다. 놓으면 onMove(끈 id, 대상 id, 대상 뒤인지)를 부른다.
function makeTabDraggable(node, container, id, onMove) {
  node.draggable = true;
  node.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    // 일부 브라우저는 데이터가 없으면 끌기를 시작하지 않는다.
    event.dataTransfer.setData("text/plain", id);
    tabDrag = { container, id };
    requestAnimationFrame(() => node.classList.add("is-dragging"));
  });
  node.addEventListener("dragover", (event) => {
    if (!tabDrag || tabDrag.container !== container || tabDrag.id === id) {
      return;
    }
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    if (!node.classList.contains(after ? "is-drop-after" : "is-drop-before")) {
      container.querySelectorAll(".is-drop-before, .is-drop-after").forEach((other) => {
        other.classList.remove("is-drop-before", "is-drop-after");
      });
      node.classList.add(after ? "is-drop-after" : "is-drop-before");
    }
  });
  node.addEventListener("dragleave", (event) => {
    if (!node.contains(event.relatedTarget)) {
      node.classList.remove("is-drop-before", "is-drop-after");
    }
  });
  node.addEventListener("drop", (event) => {
    if (!tabDrag || tabDrag.container !== container || tabDrag.id === id) {
      return;
    }
    event.preventDefault();
    const after = node.classList.contains("is-drop-after");
    const dragId = tabDrag.id;
    endTabDrag();
    onMove(dragId, id, after);
  });
  node.addEventListener("dragend", endTabDrag);
}

// 옮긴 뒤의 id 순서. 순서가 그대로면 null을 돌려준다.
function movedTabOrder(ids, dragId, targetId, after) {
  const rest = ids.filter((id) => id !== dragId);
  const target = rest.indexOf(targetId);
  if (target < 0 || rest.length === ids.length) {
    return null;
  }
  rest.splice(target + (after ? 1 : 0), 0, dragId);
  return rest.every((id, i) => id === ids[i]) ? null : rest;
}

// 탭은 몇 개 안 되므로 옮길 때마다 1부터 다시 매기고, 값이 바뀐 탭만 저장한다.
// items를 새 순서로 바꿔 돌려주고, 저장에 실패하면 원래 items로 되돌릴 수 있게 한다.
async function reorderTabs(items, orderedIds, apply, update) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const next = orderedIds.map((id, i) => ({ ...byId.get(id), sort_order: i + 1 }));
  const changes = next.filter((item) => byId.get(item.id).sort_order !== item.sort_order);
  apply(next);
  const results = await Promise.all(changes.map((item) => update(item.id, item.sort_order)));
  if (!results.every(Boolean)) {
    apply(items);
    showToast(SAVE_ERROR_MESSAGE);
  }
}

function renderList() {
  const visible = visiblePhrases();
  let message = "";
  if (state.listStatus === "loading") {
    message = LOADING_MESSAGE;
  } else if (state.listStatus === "error") {
    message = LOAD_ERROR_MESSAGE;
  } else if (!state.phrases.length) {
    message = EMPTY_LIST_MESSAGE;
  } else if (!visible.length) {
    message = EMPTY_FOLDER_MESSAGE;
  }
  listMessage.textContent = message;
  listMessage.hidden = !message;

  const items = state.listStatus === "ready" ? visible.map(createPhraseItem) : [];
  list.replaceChildren(...items);
}

function createPhraseItem(phrase, index) {
  const item = element("li", "phrase-item");
  item.dataset.id = phrase.id;
  item.draggable = true;
  item.classList.toggle("is-selected", state.selectedId === phrase.id);
  item.classList.toggle("is-copied", state.copiedId === phrase.id);
  item.addEventListener("click", () => selectPhrase(phrase.id));

  const handle = element("span", "drag-handle", "⋮⋮");
  handle.title = "끌어서 순서 변경";
  handle.setAttribute("aria-hidden", "true");

  const key = element("span", "phrase-key", index < 9 ? String(index + 1) : "");
  key.classList.toggle("is-hidden", index >= 9);

  const body = element("div", "phrase-body");
  body.append(
    element("p", "phrase-title", phrase.title || "(제목 없음)"),
    element("p", "phrase-preview", applyDateVariables(phrase.text, new Date()).replace(/\n/g, "  ")),
  );

  item.append(handle, key, body);

  // "전체"에서는 들어 있는 폴더를 탭 순서대로 모두 보여 준다.
  if (state.currentFolder === "all") {
    state.folders
      .filter((folder) => phrase.folder_ids.includes(folder.id))
      .forEach((folder) => item.append(element("span", "folder-tag", folder.name)));
  }

  const confirming = state.confirmDelete && state.confirmDelete.id === phrase.id;
  item.append(confirming ? createDeleteConfirm(phrase) : createPhraseActions(phrase));

  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    // 일부 브라우저는 데이터가 없으면 끌기를 시작하지 않는다.
    event.dataTransfer.setData("text/plain", phrase.id);
    drag = { id: phrase.id, index };
    // 바로 흐리게 하면 끌리는 미리보기 그림까지 흐려진다.
    requestAnimationFrame(() => item.classList.add("is-dragging"));
  });
  item.addEventListener("dragover", (event) => {
    if (!drag || drag.id === phrase.id) {
      return;
    }
    event.preventDefault();
    markDropTarget(item, index > drag.index ? "is-drop-after" : "is-drop-before");
  });
  item.addEventListener("drop", (event) => {
    event.preventDefault();
    if (!drag || drag.id === phrase.id) {
      return;
    }
    const id = drag.id;
    endDrag();
    reorderPhrase(id, phrase.id);
  });
  item.addEventListener("dragend", () => {
    if (drag) {
      endDrag();
    }
  });

  return item;
}

function createPhraseActions(phrase) {
  const actions = element("div", "phrase-actions");
  const copied = state.copiedId === phrase.id;
  const copyButton = button("copy-button", copied ? "복사됨" : "복사", () => copyPhrase(phrase));
  copyButton.classList.toggle("is-copied", copied);
  actions.append(
    button("text-button", "수정", () => openEditor(phrase)),
    button("text-button is-danger", "삭제", () => askDelete(phrase.id)),
    copyButton,
  );
  return actions;
}

function createDeleteConfirm(phrase) {
  const { busy, failed } = state.confirmDelete;
  const confirm = element("div", "delete-confirm");
  const question = element("span", "delete-question", failed ? "삭제하지 못했습니다." : "삭제할까요?");
  question.setAttribute("role", "status");

  const cancelButton = button("button-secondary delete-cancel", "취소", () => {
    state.confirmDelete = null;
    render();
  });
  const confirmButton = button("button-danger", "삭제", () => removePhrase(phrase.id));
  confirmButton.disabled = busy;

  confirm.append(question, cancelButton, confirmButton);
  return confirm;
}

function markDropTarget(item, className) {
  list.querySelectorAll(".is-drop-before, .is-drop-after").forEach((node) => {
    if (node !== item) {
      node.classList.remove("is-drop-before", "is-drop-after");
    }
  });
  item.classList.remove("is-drop-before", "is-drop-after");
  item.classList.add(className);
}

function endDrag() {
  drag = null;
  folderTabs.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
  // 끄는 동안 미룬 그리기가 없어도 끌기 표시를 지우려고 다시 그린다.
  render();
}

/* ---------- 동작 ---------- */

function setCurrentFolder(key) {
  state.currentFolder = key;
  state.selectedId = null;
  state.confirmDelete = null;
  storeFolder(key);
  render();
}

// 첫 클릭에 탭을 다시 그리므로 브라우저의 dblclick이 오지 않는다. 그래서 같은 탭을 연달아 누른 것을 직접 센다.
function clickFolderTab(key) {
  const now = Date.now();
  const isDouble = key !== "all" && lastTabClick.key === key && now - lastTabClick.time < DOUBLE_CLICK_MS;
  lastTabClick = isDouble ? { key: null, time: 0 } : { key, time: now };
  if (isDouble) {
    startRename(key);
  } else {
    setCurrentFolder(key);
  }
}

function selectPhrase(id) {
  if (state.selectedId === id) {
    return;
  }
  state.selectedId = id;
  render();
}

async function copyPhrase(phrase) {
  state.selectedId = phrase.id;
  refreshDates();
  const copied = await copyText(applyDateVariables(phrase.text, new Date()));

  clearTimeout(copiedTimer);
  state.copiedId = copied ? phrase.id : null;
  render();
  showToast(copied ? `'${phrase.title}' 복사됨` : "복사하지 못했습니다");
  if (copied) {
    copiedTimer = setTimeout(() => {
      state.copiedId = null;
      render();
    }, COPY_FEEDBACK_MS);
  }
}

function askDelete(id) {
  state.confirmDelete = { id, busy: false, failed: false };
  render();
  const cancelButton = list.querySelector(".delete-cancel");
  if (cancelButton) {
    cancelButton.focus();
  }
}

async function removePhrase(id) {
  state.confirmDelete = { id, busy: true, failed: false };
  render();
  const deleted = (await deletePhrases([id])).length > 0;
  if (!deleted) {
    if (state.confirmDelete && state.confirmDelete.id === id) {
      state.confirmDelete = { id, busy: false, failed: true };
      render();
    }
    return;
  }

  state.phrases = state.phrases.filter((phrase) => phrase.id !== id);
  if (state.confirmDelete && state.confirmDelete.id === id) {
    state.confirmDelete = null;
  }
  if (state.selectedId === id) {
    state.selectedId = null;
  }
  render();
  showToast("삭제했습니다");
}

async function commitFolder(rawName) {
  // Enter로 만든 뒤 입력창이 사라지면서 blur가 한 번 더 올 수 있다.
  if (!state.addingFolder) {
    return;
  }
  state.addingFolder = false;
  renderTabs();

  const name = rawName.trim();
  if (!name || state.folders.some((folder) => folder.name === name)) {
    return;
  }

  const lastOrder = state.folders.reduce((max, folder) => Math.max(max, folder.sort_order), 0);
  const folder = await insertFolder(name, lastOrder + 1);
  if (!folder) {
    showToast("폴더를 만들지 못했습니다");
    return;
  }
  state.folders.push(folder);
  setCurrentFolder(folder.id);
}

function cancelAddFolder() {
  state.addingFolder = false;
  renderTabs();
}

function startRename(folderId) {
  if (state.addingFolder) {
    return;
  }
  state.renamingFolderId = folderId;
  renderTabs();
}

function cancelRename() {
  state.renamingFolderId = null;
  render();
}

async function commitRename(folderId, rawName) {
  // Enter로 저장한 뒤 입력창이 사라지면서 blur가 한 번 더 올 수 있다.
  if (state.renamingFolderId !== folderId) {
    return;
  }
  state.renamingFolderId = null;

  const folder = state.folders.find((f) => f.id === folderId);
  const name = rawName.trim();
  if (!folder || !name || name === folder.name) {
    render();
    return;
  }
  if (state.folders.some((f) => f.name === name)) {
    render();
    showToast("같은 이름의 폴더가 있습니다");
    return;
  }

  const previousName = folder.name;
  const setName = (value) => {
    state.folders = state.folders.map((f) => (f.id === folderId ? { ...f, name: value } : f));
  };
  setName(name);
  render();

  const result = await renameFolderRow(folderId, name);
  if (result !== "ok") {
    setName(previousName);
    render();
    showToast(result === "duplicate" ? "같은 이름의 폴더가 있습니다" : SAVE_ERROR_MESSAGE);
  }
}

function moveFolderTab(dragId, targetId, after) {
  const ids = movedTabOrder(state.folders.map((folder) => folder.id), dragId, targetId, after);
  if (!ids) {
    return;
  }
  reorderTabs(
    state.folders,
    ids,
    (folders) => {
      state.folders = folders;
      render();
    },
    updateFolderSortOrder,
  );
}

// 탭 위에 놓으면 원래 폴더는 그대로 두고 그 폴더에도 넣는다.
async function addPhraseToFolder(id, folderId) {
  const phrase = state.phrases.find((p) => p.id === id);
  if (!phrase || phrase.folder_ids.includes(folderId)) {
    return;
  }

  const setFolders = (folderIds) => {
    state.phrases = state.phrases.map((p) => (p.id === id ? { ...p, folder_ids: folderIds } : p));
  };
  const previousIds = phrase.folder_ids;
  setFolders([...previousIds, folderId]);
  render();

  if (!(await addPhraseFolders(id, [folderId]))) {
    setFolders(previousIds);
    render();
    showToast(SAVE_ERROR_MESSAGE);
    return;
  }
  showToast(`'${folderName(folderId)}' 폴더에 추가했습니다`);
}

/* ---------- 폴더 삭제 확인창 ---------- */

function openFolderDelete(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) {
    return;
  }
  deletingFolder = folder;
  state.confirmDelete = null;

  const phrases = phrasesInFolder(folderId);
  const shared = phrases.filter((phrase) => phrase.folder_ids.length > 1).length;

  folderDeleteHeading.textContent = `'${folder.name}' 폴더를 삭제할까요?`;
  const lines = [];
  if (!phrases.length) {
    lines.push(element("p", null, "폴더에 문구가 없습니다."));
  } else {
    lines.push(element("p", null, `"폴더만 삭제"하면 문구 ${phrases.length}개는 남고 이 폴더에서만 빠집니다.`));
    const warning = element("p");
    warning.append(`"문구도 함께 삭제"하면 문구 ${phrases.length}개가 모든 폴더에서 지워집니다.`);
    if (shared) {
      warning.append(" ", element("strong", null, `다른 폴더에도 있는 문구 ${shared}개도 함께 지워집니다.`));
    }
    lines.push(warning);
  }
  folderDeleteBody.replaceChildren(...lines);

  folderDeleteWithPhrases.hidden = !phrases.length;
  setFolderDeleteBusy(false);
  setFolderDeleteMessage("");
  folderDeleteOverlay.hidden = false;
  render();
  folderDeleteOnly.focus();
}

function closeFolderDelete() {
  deletingFolder = null;
  folderDeleteOverlay.hidden = true;
}

function setFolderDeleteBusy(busy) {
  [folderDeleteWithPhrases, folderDeleteOnly, folderDeleteCancel].forEach((node) => {
    node.disabled = busy;
  });
}

function setFolderDeleteMessage(text) {
  folderDeleteMessage.textContent = text;
  folderDeleteMessage.hidden = !text;
}

async function deleteFolder(withPhrases) {
  const folder = deletingFolder;
  if (!folder) {
    return;
  }
  setFolderDeleteBusy(true);
  setFolderDeleteMessage("");

  let removedPhrases = 0;
  if (withPhrases) {
    const ids = phrasesInFolder(folder.id).map((phrase) => phrase.id);
    const deletedIds = ids.length ? await deletePhrases(ids) : [];
    removedPhrases = deletedIds.length;
    state.phrases = state.phrases.filter((phrase) => !deletedIds.includes(phrase.id));
    if (deletedIds.length < ids.length) {
      setFolderDeleteBusy(false);
      setFolderDeleteMessage("문구를 모두 지우지 못했습니다. 다시 시도해 주세요.");
      render();
      return;
    }
  }

  if (!(await deleteFolderRow(folder.id))) {
    setFolderDeleteBusy(false);
    setFolderDeleteMessage(SAVE_ERROR_MESSAGE);
    render();
    return;
  }

  // 폴더를 지우면 DB에서 연결도 함께 지워지므로 화면에서도 뺀다.
  state.folders = state.folders.filter((f) => f.id !== folder.id);
  state.phrases = state.phrases.map((phrase) =>
    phrase.folder_ids.includes(folder.id)
      ? { ...phrase, folder_ids: phrase.folder_ids.filter((id) => id !== folder.id) }
      : phrase,
  );
  if (deletingFolder === folder) {
    closeFolderDelete();
  }
  if (state.currentFolder === folder.id) {
    setCurrentFolder("all");
  } else {
    render();
  }
  showToast(removedPhrases ? `폴더와 문구 ${removedPhrases}개를 삭제했습니다` : "폴더를 삭제했습니다");
}

async function reorderPhrase(dragId, targetId) {
  const visible = visiblePhrases();
  const from = visible.findIndex((p) => p.id === dragId);
  const to = visible.findIndex((p) => p.id === targetId);
  if (from < 0 || to < 0 || from === to) {
    return;
  }

  // 아래로 옮기면 대상 뒤에, 위로 옮기면 대상 앞에 놓는다(끄는 중 표시선과 같은 위치).
  const target = visible[to];
  const moved = visible[from];
  const ordered = state.phrases.filter((p) => p.id !== dragId);
  const index = ordered.indexOf(target) + (from < to ? 1 : 0);
  ordered.splice(index, 0, moved);

  const before = ordered[index - 1];
  const after = ordered[index + 1];
  let changes;
  if (before && after && after.sort_order - before.sort_order < MIN_SORT_GAP) {
    changes = ordered
      .map((p, i) => ({ id: p.id, sort_order: i + 1 }))
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

  const previous = state.phrases;
  const newOrders = new Map(changes.map((change) => [change.id, change.sort_order]));
  state.phrases = ordered.map((p) => (newOrders.has(p.id) ? { ...p, sort_order: newOrders.get(p.id) } : p));
  render();

  if (!(await updateSortOrders(changes))) {
    state.phrases = previous;
    render();
    showToast(SAVE_ERROR_MESSAGE);
  }
}

/* ---------- 모달 ---------- */

function openEditor(phrase) {
  state.confirmDelete = null;
  editor = phrase ? { mode: "edit", id: phrase.id } : { mode: "new" };

  if (phrase) {
    editorHeading.textContent = "문구 수정";
    editorTitle.value = phrase.title;
    editorText.value = phrase.text;
    renderFolderChecks(phrase.folder_ids);
  } else {
    editorHeading.textContent = "새 문구";
    editorTitle.value = "";
    editorText.value = "";
    // 보고 있는 폴더에 새 문구를 넣는다. "전체"에서는 아무 폴더도 고르지 않는다.
    renderFolderChecks(state.currentFolder === "all" ? [] : [state.currentFolder]);
  }

  setEditorMessage("");
  editorSave.disabled = false;
  editorOverlay.hidden = false;
  render();
  editorTitle.focus();
}

function renderFolderChecks(checkedIds) {
  if (!state.folders.length) {
    editorFolders.replaceChildren(
      element("span", "folder-checks-empty", "폴더가 없습니다. 탭 옆 + 로 만들 수 있습니다."),
    );
    return;
  }

  const checks = state.folders.map((folder) => {
    const label = element("label", "folder-check");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.value = folder.id;
    checkbox.checked = checkedIds.includes(folder.id);
    label.classList.toggle("is-checked", checkbox.checked);
    checkbox.addEventListener("change", () => label.classList.toggle("is-checked", checkbox.checked));
    label.append(checkbox, folder.name);
    return label;
  });
  editorFolders.replaceChildren(...checks);
}

function checkedFolderIds() {
  return [...editorFolders.querySelectorAll("input:checked")].map((checkbox) => checkbox.value);
}

function closeEditor() {
  editor = null;
  editorOverlay.hidden = true;
}

function setEditorMessage(text) {
  editorMessage.textContent = text;
  editorMessage.hidden = !text;
  editorHint.hidden = Boolean(text);
}

async function saveEditor() {
  const current = editor;
  if (!current || editorSave.disabled) {
    return;
  }

  const title = editorTitle.value.trim();
  const text = editorText.value.trim();
  if (!title || !text) {
    setEditorMessage(REQUIRED_MESSAGE);
    (title ? editorText : editorTitle).focus();
    return;
  }
  const folderIds = checkedFolderIds();
  const isNew = current.mode === "new";

  editorSave.disabled = true;
  let saved;
  if (isNew) {
    const top = state.phrases.length ? state.phrases[0].sort_order - 1 : 1;
    saved = await insertPhrase({ title, text, sort_order: top });
  } else {
    saved = await updatePhrase(current.id, { title, text });
  }
  if (!saved) {
    editorSave.disabled = false;
    if (editor === current) {
      setEditorMessage(SAVE_ERROR_MESSAGE);
    }
    return;
  }

  if (isNew) {
    state.phrases = [saved, ...state.phrases];
    state.selectedId = saved.id;
    // 폴더 저장이 실패해 다시 누르면 문구를 또 만들지 않고 이 문구를 고치게 한다.
    current.mode = "edit";
    current.id = saved.id;
  } else {
    state.phrases = state.phrases.map((p) => (p.id === saved.id ? saved : p));
  }

  const foldersSaved = await setPhraseFolders(saved.id, saved.folder_ids, folderIds);
  editorSave.disabled = false;
  if (foldersSaved) {
    state.phrases = state.phrases.map((p) => (p.id === saved.id ? { ...p, folder_ids: folderIds } : p));
  }
  render();

  if (!foldersSaved) {
    if (editor === current) {
      setEditorMessage("문구는 저장했지만 폴더를 저장하지 못했습니다. 다시 저장해 주세요.");
    }
    return;
  }

  if (editor === current) {
    closeEditor();
  }
  showToast(isNew ? "등록했습니다" : "수정했습니다");
}

/* ---------- 화면 전환 ---------- */

async function showApp(email) {
  loginView.hidden = true;
  setTool(readStoredTool());
  toolNav.hidden = false;
  account.hidden = false;
  accountEmail.textContent = email || "";
  accountEmail.title = email || "";

  state.phrases = [];
  state.folders = [];
  state.listStatus = "loading";
  state.currentFolder = readStoredFolder();
  render();

  const userId = currentUserId;
  loadDeploy(userId);
  loadManual(userId);
  await importLegacyPhrases();
  try {
    const [phrases, folders] = await Promise.all([fetchPhrases(), fetchFolders()]);
    // 불러오는 사이에 로그아웃했다면 화면에 그리지 않는다.
    if (userId !== currentUserId) {
      return;
    }
    state.phrases = phrases;
    state.folders = folders;
    if (state.currentFolder !== "all" && !folders.some((folder) => folder.id === state.currentFolder)) {
      state.currentFolder = "all";
    }
    state.listStatus = "ready";
  } catch {
    if (userId !== currentUserId) {
      return;
    }
    state.listStatus = "error";
  }
  render();
}

function showLogin() {
  appView.hidden = true;
  deployView.hidden = true;
  resetDeploy();
  manualView.hidden = true;
  resetManual();
  toolNav.hidden = true;
  account.hidden = true;
  accountEmail.textContent = "";
  loginView.hidden = false;

  closeEditor();
  closeFolderDelete();
  toast.hidden = true;
  Object.assign(state, {
    phrases: [],
    folders: [],
    listStatus: "loading",
    selectedId: null,
    copiedId: null,
    confirmDelete: null,
    addingFolder: false,
    renamingFolderId: null,
  });
  render();

  loginPassword.value = "";
  loginEmail.focus();
}

/* ---------- 이벤트 ---------- */

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const submitButton = loginForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  loginMessage.textContent = "";
  const { error } = await client.auth.signInWithPassword({
    email: loginEmail.value.trim(),
    password: loginPassword.value,
  });
  submitButton.disabled = false;
  if (error) {
    loginMessage.textContent = "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.";
  }
});

logoutButton.addEventListener("click", () => {
  client.auth.signOut();
});

toolLinks.forEach((link) => link.addEventListener("click", () => setTool(link.dataset.tool)));

newPhraseButton.addEventListener("click", () => openEditor(null));

editorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveEditor();
});

editorText.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    saveEditor();
  }
});

editorCancel.addEventListener("click", closeEditor);

editorOverlay.addEventListener("mousedown", (event) => {
  if (event.target === editorOverlay) {
    closeEditor();
  }
});

editorTextField.after(createDateToolbar(editorText));

folderDeleteOnly.addEventListener("click", () => deleteFolder(false));
folderDeleteWithPhrases.addEventListener("click", () => deleteFolder(true));
folderDeleteCancel.addEventListener("click", closeFolderDelete);
folderDeleteOverlay.addEventListener("mousedown", (event) => {
  if (event.target === folderDeleteOverlay && !folderDeleteCancel.disabled) {
    closeFolderDelete();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && deletingFolder) {
    if (!folderDeleteCancel.disabled) {
      closeFolderDelete();
    }
    return;
  }
  if (event.key === "Escape" && editor) {
    closeEditor();
    return;
  }
  if (editor || deletingFolder || appView.hidden || state.listStatus !== "ready" || isTyping()) {
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
    return;
  }

  const visible = visiblePhrases();
  if (/^[1-9]$/.test(event.key)) {
    const phrase = visible[Number(event.key) - 1];
    if (phrase) {
      event.preventDefault();
      copyPhrase(phrase);
    }
    return;
  }

  if (event.key === "n" || event.key === "N" || event.key === "ㅜ") {
    event.preventDefault();
    openEditor(null);
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!visible.length) {
      return;
    }
    event.preventDefault();
    const current = visible.findIndex((p) => p.id === state.selectedId);
    let next;
    if (current < 0) {
      next = 0;
    } else if (event.key === "ArrowDown") {
      next = Math.min(visible.length - 1, current + 1);
    } else {
      next = Math.max(0, current - 1);
    }
    selectPhrase(visible[next].id);
    const selected = list.querySelector(".phrase-item.is-selected");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
    return;
  }

  // 버튼에 포커스가 있으면 Enter는 그 버튼을 누르는 것이다.
  if (event.key === "Enter" && !(document.activeElement && document.activeElement.tagName === "BUTTON")) {
    const phrase = visible.find((p) => p.id === state.selectedId);
    if (phrase) {
      event.preventDefault();
      copyPhrase(phrase);
    }
  }
});

client.auth.onAuthStateChange((event, session) => {
  const userId = session ? session.user.id : null;
  // 탭으로 돌아올 때도 이벤트가 오므로, 편집 내용이 사라지지 않게 사용자가 바뀔 때만 화면을 바꾼다.
  if (userId === currentUserId) {
    return;
  }
  currentUserId = userId;
  const email = session ? session.user.email : "";
  // 이 콜백 안에서 Supabase를 바로 호출하면 멈출 수 있어 콜백이 끝난 뒤 실행한다.
  setTimeout(() => (userId ? showApp(email) : showLogin()));
});

// 페이지를 켜 둔 채 날짜가 바뀌어도 화면이 복사될 값과 같도록 유지한다.
setInterval(refreshDates, DATE_CHECK_MS);
