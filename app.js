// 공개되어도 되는 값이다. 데이터 접근은 supabase/schema.sql의 권한 규칙으로 막는다.
const SUPABASE_URL = "https://ljnpbdwhgenrxccinnno.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_VSwsbTaZvwRHuUv3yKIQoQ_SHZxMwkD";

const LEGACY_STORAGE_KEY = "qa-tool.phrases";
const COPY_FEEDBACK_MS = 1500;
const SAVE_ERROR_MESSAGE = "저장하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.";
const EMPTY_LIST_MESSAGE = "아직 등록된 문구가 없습니다.";
const DATE_CHECK_MS = 60000;

const pad = (value) => String(value).padStart(2, "0");

const DATE_VARIABLES = {
  "{YYYY-MM-DD}": (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  "{YYYY.MM.DD}": (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`,
  "{MM/DD}": (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
  "{M월 D일}": (d) => `${d.getMonth() + 1}월 ${d.getDate()}일`,
};
// 캡처 그룹이 있어 split 결과의 홀수 번째 항목이 변수가 된다.
const DATE_VARIABLE_PATTERN = /(\{YYYY-MM-DD\}|\{YYYY\.MM\.DD\}|\{MM\/DD\}|\{M월 D일\})/;

const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const loginView = document.getElementById("login-view");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginMessage = document.getElementById("login-message");
const logoutButton = document.getElementById("logout-button");
const appView = document.getElementById("app-view");
const form = document.getElementById("phrase-form");
const input = document.getElementById("phrase-input");
const formMessage = document.getElementById("form-message");
const listMessage = document.getElementById("list-message");
const list = document.getElementById("phrase-list");

let shownDate = dateKey();
// undefined는 아직 로그인 상태를 확인하지 못했다는 뜻이다.
let currentUserId;

async function fetchPhrases() {
  const { data, error } = await client
    .from("phrases")
    .select("id, text")
    .order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  return data;
}

async function insertPhrase(text) {
  const { data, error } = await client.from("phrases").insert({ text }).select("id, text").single();
  return error ? null : data;
}

async function updatePhrase(id, text) {
  const { data, error } = await client
    .from("phrases")
    .update({ text })
    .eq("id", id)
    .select("id, text")
    .single();
  return error ? null : data;
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

  // 목록이 최신순이므로 앞선 문구일수록 시간이 늦어야 순서가 유지된다.
  const now = Date.now();
  const rows = saved.map((phrase, index) => ({
    text: phrase.text,
    created_at: new Date(now - index).toISOString(),
  }));
  const { error } = rows.length ? await client.from("phrases").insert(rows) : { error: null };
  if (!error) {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

function dateKey() {
  return DATE_VARIABLES["{YYYY-MM-DD}"](new Date());
}

function applyDateVariables(template, date) {
  return template
    .split(DATE_VARIABLE_PATTERN)
    .map((part, index) => (index % 2 ? DATE_VARIABLES[part](date) : part))
    .join("");
}

function renderPhraseText(element, template) {
  const date = new Date();
  const nodes = template.split(DATE_VARIABLE_PATTERN).map((part, index) => {
    if (index % 2 === 0) {
      return part;
    }
    const value = document.createElement("span");
    value.className = "date-value";
    value.textContent = DATE_VARIABLES[part](date);
    return value;
  });
  element.replaceChildren(...nodes);
}

function refreshDates() {
  if (dateKey() === shownDate) {
    return;
  }
  shownDate = dateKey();

  const date = new Date();
  document.querySelectorAll(".phrase-text").forEach((element) => {
    renderPhraseText(element, element.dataset.template);
  });
  document.querySelectorAll(".date-button").forEach((button) => {
    button.textContent = DATE_VARIABLES[button.dataset.token](date);
  });
}

function createDateToolbar(textarea) {
  const toolbar = document.createElement("div");
  toolbar.className = "date-toolbar";

  const label = document.createElement("span");
  label.textContent = "오늘 날짜 넣기";
  toolbar.append(label);

  const date = new Date();
  Object.keys(DATE_VARIABLES).forEach((token) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-button";
    button.dataset.token = token;
    button.title = `${token} 넣기`;
    button.textContent = DATE_VARIABLES[token](date);
    button.addEventListener("click", () => {
      textarea.setRangeText(token, textarea.selectionStart, textarea.selectionEnd, "end");
      textarea.focus();
    });
    toolbar.append(button);
  });

  return toolbar;
}

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

function createPhraseItem(phrase) {
  const item = document.createElement("li");
  item.className = "phrase-item";

  const text = document.createElement("p");
  text.className = "phrase-text";
  text.dataset.template = phrase.text;
  renderPhraseText(text, phrase.text);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.textContent = "복사";

  let resetTimer;
  button.addEventListener("click", async () => {
    refreshDates();
    const copied = await copyText(applyDateVariables(phrase.text, new Date()));
    button.textContent = copied ? "복사됨" : "복사 실패";
    button.classList.toggle("is-copied", copied);
    button.classList.toggle("is-failed", !copied);

    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      button.textContent = "복사";
      button.classList.remove("is-copied", "is-failed");
    }, COPY_FEEDBACK_MS);
  });

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.textContent = "편집";
  editButton.addEventListener("click", () => {
    const editor = createPhraseEditor(phrase);
    item.replaceWith(editor);
    editor.querySelector("textarea").focus();
  });

  const actions = document.createElement("div");
  actions.className = "phrase-actions";
  actions.append(button, editButton);

  item.append(text, actions);
  return item;
}

function createPhraseEditor(phrase) {
  const editor = document.createElement("li");
  editor.className = "phrase-editor";

  const textarea = document.createElement("textarea");
  textarea.rows = 4;
  textarea.value = phrase.text;
  textarea.setAttribute("aria-label", "문구 편집");

  const message = document.createElement("p");
  message.className = "message";
  message.setAttribute("role", "status");

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "취소";
  cancelButton.addEventListener("click", () => {
    editor.replaceWith(createPhraseItem(phrase));
  });

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "button-primary";
  saveButton.textContent = "저장";
  saveButton.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text) {
      message.textContent = "문구를 입력해 주세요.";
      textarea.focus();
      return;
    }

    saveButton.disabled = true;
    const updated = await updatePhrase(phrase.id, text);
    saveButton.disabled = false;
    if (!updated) {
      message.textContent = SAVE_ERROR_MESSAGE;
      return;
    }

    editor.replaceWith(createPhraseItem(updated));
  });

  const actions = document.createElement("div");
  actions.className = "phrase-actions";
  actions.append(cancelButton, saveButton);

  const footer = document.createElement("div");
  footer.className = "form-footer";
  footer.append(message, actions);

  editor.append(textarea, createDateToolbar(textarea), footer);
  return editor;
}

function setListMessage(text) {
  listMessage.textContent = text;
  listMessage.hidden = !text;
}

async function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
  logoutButton.hidden = false;
  list.replaceChildren();
  setListMessage("문구를 불러오는 중입니다.");

  const userId = currentUserId;
  await importLegacyPhrases();
  try {
    const phrases = await fetchPhrases();
    // 불러오는 사이에 로그아웃했다면 화면에 그리지 않는다.
    if (userId !== currentUserId) {
      return;
    }
    list.replaceChildren(...phrases.map(createPhraseItem));
    setListMessage(phrases.length ? "" : EMPTY_LIST_MESSAGE);
  } catch {
    setListMessage("문구를 불러오지 못했습니다. 새로고침해 주세요.");
  }
}

function showLogin() {
  appView.hidden = true;
  logoutButton.hidden = true;
  loginView.hidden = false;
  list.replaceChildren();
  input.value = "";
  formMessage.textContent = "";
  loginPassword.value = "";
  loginEmail.focus();
}

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

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text) {
    formMessage.textContent = "문구를 입력해 주세요.";
    input.focus();
    return;
  }

  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true;
  const phrase = await insertPhrase(text);
  submitButton.disabled = false;
  if (!phrase) {
    formMessage.textContent = SAVE_ERROR_MESSAGE;
    return;
  }

  input.value = "";
  formMessage.textContent = "";
  input.focus();
  // 전체를 다시 그리면 편집 중인 내용이 사라지므로 새 문구만 추가한다.
  list.prepend(createPhraseItem(phrase));
  setListMessage("");
});

input.after(createDateToolbar(input));

client.auth.onAuthStateChange((event, session) => {
  const userId = session ? session.user.id : null;
  // 탭으로 돌아올 때도 이벤트가 오므로, 편집 내용이 사라지지 않게 사용자가 바뀔 때만 화면을 바꾼다.
  if (userId === currentUserId) {
    return;
  }
  currentUserId = userId;
  // 이 콜백 안에서 Supabase를 바로 호출하면 멈출 수 있어 콜백이 끝난 뒤 실행한다.
  setTimeout(userId ? showApp : showLogin);
});

// 페이지를 켜 둔 채 날짜가 바뀌어도 화면이 복사될 값과 같도록 유지한다.
setInterval(refreshDates, DATE_CHECK_MS);
