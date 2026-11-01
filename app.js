// 공개되어도 되는 값이다. 데이터 접근은 supabase/schema.sql의 권한 규칙으로 막는다.
const SUPABASE_URL = "https://ljnpbdwhgenrxccinnno.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_VSwsbTaZvwRHuUv3yKIQoQ_SHZxMwkD";

const LEGACY_STORAGE_KEY = "qa-tool.phrases";
const COPY_FEEDBACK_MS = 1500;
const SAVE_ERROR_MESSAGE = "저장하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.";
const EMPTY_LIST_MESSAGE = "아직 등록된 문구가 없습니다.";
const DATE_CHECK_MS = 60000;

const pad = (value) => String(value).padStart(2, "0");

const DATE_FORMATS = {
  "YYYY-MM-DD": (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  "YYYY.MM.DD": (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`,
  "MM/DD": (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
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
const DATE_VARIABLE_PATTERN = /(\{(?:내일 |다음주 월요일 )?(?:YYYY-MM-DD|YYYY\.MM\.DD|MM\/DD|M월 D일)\})/;

const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const loginView = document.getElementById("login-view");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginMessage = document.getElementById("login-message");
const logoutButton = document.getElementById("logout-button");
const appView = document.getElementById("app-view");
const form = document.getElementById("phrase-form");
const titleInput = document.getElementById("phrase-title");
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
    .select("id, title, text")
    .order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  return data;
}

async function insertPhrase(title, text) {
  const { data, error } = await client
    .from("phrases")
    .insert({ title, text })
    .select("id, title, text")
    .single();
  return error ? null : data;
}

async function updatePhrase(id, title, text) {
  const { data, error } = await client
    .from("phrases")
    .update({ title, text })
    .eq("id", id)
    .select("id, title, text")
    .single();
  return error ? null : data;
}

async function deletePhrase(id) {
  const { data, error } = await client.from("phrases").delete().eq("id", id).select("id");
  // 권한 규칙에 막히면 오류 없이 0건이 되므로 실제로 지워졌는지 확인한다.
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

  // 목록이 최신순이므로 앞선 문구일수록 시간이 늦어야 순서가 유지된다.
  const now = Date.now();
  const rows = saved.map((phrase, index) => ({
    title: phrase.text.split("\n")[0].slice(0, 100),
    text: phrase.text,
    created_at: new Date(now - index).toISOString(),
  }));
  const { error } = rows.length ? await client.from("phrases").insert(rows) : { error: null };
  if (!error) {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

function dateKey() {
  return DATE_FORMATS["YYYY-MM-DD"](new Date());
}

function formatDateVariable(token, date) {
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
  if (dateKey() === shownDate) {
    return;
  }
  shownDate = dateKey();

  const date = new Date();
  document.querySelectorAll(".date-button").forEach((button) => {
    button.textContent = formatDateVariable(button.dataset.token, date);
  });
}

function createDateToolbar(textarea) {
  const toolbar = document.createElement("div");
  toolbar.className = "date-toolbar";

  const date = new Date();
  DATE_BASES.forEach((base) => {
    const row = document.createElement("div");
    row.className = "date-row";

    const label = document.createElement("span");
    label.className = "date-label";
    label.textContent = base.label;
    row.append(label);

    Object.keys(DATE_FORMATS).forEach((format) => {
      const token = `{${base.prefix}${format}}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "date-button";
      button.dataset.token = token;
      button.title = `${token} 넣기`;
      button.textContent = formatDateVariable(token, date);
      button.addEventListener("click", () => {
        textarea.setRangeText(token, textarea.selectionStart, textarea.selectionEnd, "end");
        textarea.focus();
      });
      row.append(button);
    });

    toolbar.append(row);
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

  const title = document.createElement("p");
  title.className = "phrase-title";
  title.classList.toggle("is-untitled", !phrase.title);
  title.textContent = phrase.title || "(제목 없음)";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";

  const setCopyState = (icon, label) => {
    button.textContent = icon;
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  setCopyState("📋", "복사");

  let resetTimer;
  button.addEventListener("click", async () => {
    refreshDates();
    const copied = await copyText(applyDateVariables(phrase.text, new Date()));
    if (copied) {
      setCopyState("✅", "복사됨");
    } else {
      setCopyState("⚠️", "복사 실패");
    }
    button.classList.toggle("is-copied", copied);
    button.classList.toggle("is-failed", !copied);

    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      setCopyState("📋", "복사");
      button.classList.remove("is-copied", "is-failed");
    }, COPY_FEEDBACK_MS);
  });

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.textContent = "수정";
  editButton.addEventListener("click", () => {
    const editor = createPhraseEditor(phrase);
    item.replaceWith(editor);
    editor.querySelector("textarea").focus();
  });

  const actions = document.createElement("div");
  actions.className = "phrase-actions";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "삭제";
  deleteButton.addEventListener("click", () => {
    const question = document.createElement("span");
    question.className = "delete-question";
    question.setAttribute("role", "status");
    question.textContent = "삭제할까요?";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "취소";
    cancelButton.addEventListener("click", () => {
      actions.replaceChildren(button, editButton, deleteButton);
    });

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "button-danger";
    confirmButton.textContent = "삭제";
    confirmButton.addEventListener("click", async () => {
      confirmButton.disabled = true;
      const deleted = await deletePhrase(phrase.id);
      confirmButton.disabled = false;
      if (!deleted) {
        question.textContent = "삭제하지 못했습니다.";
        return;
      }

      item.remove();
      if (!list.children.length) {
        setListMessage(EMPTY_LIST_MESSAGE);
      }
    });

    actions.replaceChildren(question, cancelButton, confirmButton);
    cancelButton.focus();
  });

  actions.append(button, editButton, deleteButton);

  item.append(title, actions);
  return item;
}

function createPhraseEditor(phrase) {
  const editor = document.createElement("li");
  editor.className = "phrase-editor";

  const titleField = document.createElement("input");
  titleField.type = "text";
  titleField.maxLength = 100;
  titleField.value = phrase.title;
  titleField.placeholder = "제목";
  titleField.setAttribute("aria-label", "제목 수정");

  const textarea = document.createElement("textarea");
  textarea.rows = 4;
  textarea.value = phrase.text;
  textarea.setAttribute("aria-label", "내용 수정");

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
    const title = titleField.value.trim();
    const text = textarea.value.trim();
    if (!title || !text) {
      message.textContent = "제목과 내용을 모두 입력해 주세요.";
      (title ? textarea : titleField).focus();
      return;
    }

    saveButton.disabled = true;
    const updated = await updatePhrase(phrase.id, title, text);
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

  editor.append(titleField, textarea, createDateToolbar(textarea), footer);
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
  titleInput.value = "";
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

  const title = titleInput.value.trim();
  const text = input.value.trim();
  if (!title || !text) {
    formMessage.textContent = "제목과 내용을 모두 입력해 주세요.";
    (title ? input : titleInput).focus();
    return;
  }

  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true;
  const phrase = await insertPhrase(title, text);
  submitButton.disabled = false;
  if (!phrase) {
    formMessage.textContent = SAVE_ERROR_MESSAGE;
    return;
  }

  titleInput.value = "";
  input.value = "";
  formMessage.textContent = "";
  titleInput.focus();
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
