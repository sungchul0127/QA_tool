const STORAGE_KEY = "qa-tool.phrases";
const COPY_FEEDBACK_MS = 1500;
const SAVE_ERROR_MESSAGE = "저장하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.";
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

const form = document.getElementById("phrase-form");
const input = document.getElementById("phrase-input");
const formMessage = document.getElementById("form-message");
const emptyMessage = document.getElementById("empty-message");
const list = document.getElementById("phrase-list");

let phrases = loadPhrases();
let shownDate = dateKey();

function loadPhrases() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function savePhrases(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
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
  saveButton.addEventListener("click", () => {
    const text = textarea.value.trim();
    if (!text) {
      message.textContent = "문구를 입력해 주세요.";
      textarea.focus();
      return;
    }

    const updated = { ...phrase, text };
    const next = phrases.map((p) => (p.id === phrase.id ? updated : p));
    if (!savePhrases(next)) {
      message.textContent = SAVE_ERROR_MESSAGE;
      return;
    }

    phrases = next;
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

function render() {
  emptyMessage.hidden = phrases.length > 0;
  list.replaceChildren(...phrases.map(createPhraseItem));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text) {
    formMessage.textContent = "문구를 입력해 주세요.";
    input.focus();
    return;
  }

  const phrase = { id: crypto.randomUUID(), text };
  const next = [phrase, ...phrases];
  if (!savePhrases(next)) {
    formMessage.textContent = SAVE_ERROR_MESSAGE;
    return;
  }

  phrases = next;
  input.value = "";
  formMessage.textContent = "";
  input.focus();
  // 전체를 다시 그리면 편집 중인 내용이 사라지므로 새 문구만 추가한다.
  list.prepend(createPhraseItem(phrase));
  emptyMessage.hidden = true;
});

input.after(createDateToolbar(input));
render();
// 페이지를 켜 둔 채 날짜가 바뀌어도 화면이 복사될 값과 같도록 유지한다.
setInterval(refreshDates, DATE_CHECK_MS);
