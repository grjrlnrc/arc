const QUIZ_KEYS = new Set(["title", "topic", "translation", "questions"]);
const QUESTION_KEYS = new Set([
  "question",
  "answers",
  "correct",
  "verse",
  "verseText",
  "explanation",
]);
const CHAPTER_QUIZ_KEYS = new Set(["lessonTitle", "questions"]);
const CHAPTER_QUESTION_KEYS = new Set(["questionText", "options", "correctIndex"]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".bmp",
  ".ico",
]);

const state = {
  catalog: null,
  trail: [],
};

let session = null;
let opener = null;
let opening = false;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasExactKeys(value, allowed) {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

// Exact keys only, so a retired index-based quiz file stays an ordinary JSON resource.
export function isScriptureQuiz(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  if (!hasExactKeys(data, QUIZ_KEYS)) return false;
  if (!isNonEmptyString(data.title) || !isNonEmptyString(data.topic) || !isNonEmptyString(data.translation)) {
    return false;
  }
  if (!Array.isArray(data.questions) || data.questions.length === 0) return false;
  return data.questions.every(isQuizQuestion);
}

function isQuizQuestion(question) {
  if (question === null || typeof question !== "object" || Array.isArray(question)) return false;
  if (!hasExactKeys(question, QUESTION_KEYS)) return false;
  if (!isNonEmptyString(question.question) || !isNonEmptyString(question.correct)) return false;
  if (!isNonEmptyString(question.verse) || !isNonEmptyString(question.verseText) || !isNonEmptyString(question.explanation)) {
    return false;
  }
  if (!Array.isArray(question.answers) || question.answers.length !== 4) return false;
  if (!question.answers.every(isNonEmptyString)) return false;
  return question.answers.some((answer) => answer === question.correct);
}

// Index-based chapter format used by the Resources/Quiz folder.
export function isChapterQuiz(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  if (!hasExactKeys(data, CHAPTER_QUIZ_KEYS)) return false;
  if (!isNonEmptyString(data.lessonTitle)) return false;
  if (!Array.isArray(data.questions) || data.questions.length === 0) return false;
  return data.questions.every(isChapterQuestion);
}

function isChapterQuestion(question) {
  if (question === null || typeof question !== "object" || Array.isArray(question)) return false;
  if (!hasExactKeys(question, CHAPTER_QUESTION_KEYS)) return false;
  if (!isNonEmptyString(question.questionText)) return false;
  if (!Array.isArray(question.options) || question.options.length !== 4) return false;
  if (!question.options.every(isNonEmptyString)) return false;
  const index = question.correctIndex;
  return Number.isInteger(index) && index >= 0 && index < question.options.length;
}

export function classifyJsonText(text) {
  try {
    const data = JSON.parse(text);
    return isScriptureQuiz(data) || isChapterQuiz(data) ? "quiz" : "resource";
  } catch {
    return "resource";
  }
}

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap];
    copy[swap] = current;
  }
  return copy;
}

// Normalize either quiz shape into the internal attempt source.
// Chapter quizzes carry no verse or explanation, so those stay null.
function canonicalQuiz(data) {
  if (isScriptureQuiz(data)) return data;
  if (!isChapterQuiz(data)) return null;
  return {
    topic: data.lessonTitle,
    questions: data.questions.map((question) => ({
      question: question.questionText,
      answers: [...question.options],
      correct: question.options[question.correctIndex],
      verse: null,
      verseText: null,
      explanation: null,
    })),
  };
}

export function createAttempt(data, random = Math.random) {
  const quiz = canonicalQuiz(data);
  if (!quiz) throw new Error("Not a scripture quiz");
  return {
    topic: quiz.topic,
    index: 0,
    questions: shuffle(
      quiz.questions.map((question) => ({
        question: question.question,
        answers: shuffle(question.answers, random),
        correct: question.correct,
        verse: question.verse,
        verseText: question.verseText,
        explanation: question.explanation,
        selected: null,
        checked: false,
      })),
      random,
    ),
  };
}

export function selectAnswer(attempt, choice) {
  const question = attempt.questions[attempt.index];
  if (!question || question.checked || !question.answers.includes(choice)) {
    return { changed: false };
  }
  if (question.selected === choice) return { changed: false };
  question.selected = choice;
  return { changed: true };
}

export function submitAnswer(attempt) {
  const question = attempt.questions[attempt.index];
  if (!question || question.checked || question.selected === null) {
    return { ok: false, correct: false };
  }
  question.checked = true;
  return { ok: true, correct: question.selected === question.correct };
}

export function goNext(attempt) {
  const question = attempt.questions[attempt.index];
  if (!question || !question.checked || attempt.index >= attempt.questions.length - 1) {
    return { ok: false };
  }
  attempt.index += 1;
  return { ok: true };
}

export function goPrevious(attempt) {
  if (attempt.index <= 0) return { ok: false };
  attempt.index -= 1;
  return { ok: true };
}

export function answerPresentation(question) {
  const checked = question.checked === true;
  return question.answers.map((text) => {
    let tone = "idle";
    if (checked && text === question.correct) tone = "correct";
    else if (checked && text === question.selected) tone = "wrong";
    else if (!checked && text === question.selected) tone = "selected";
    return { text, tone, disabled: checked };
  });
}

export function feedbackFor(question) {
  if (!question || question.checked !== true) return null;
  return {
    correct: question.selected === question.correct,
    selected: question.selected,
    answer: question.correct,
    verse: question.verse,
    verseText: question.verseText,
    explanation: question.explanation,
  };
}

export function scoreAttempt(attempt) {
  const total = attempt.questions.length;
  const correct = attempt.questions.filter((question) => question.selected === question.correct).length;
  return {
    correct,
    total,
    percentage: total === 0 ? 0 : Math.round((correct / total) * 100),
  };
}

export function readyForResults(attempt) {
  const question = attempt.questions[attempt.index];
  return attempt.questions.length > 0 && attempt.index === attempt.questions.length - 1 && question?.checked === true;
}

export function partitionFolder(folder) {
  const folders = [];
  const files = [];
  const images = [];
  const imageFolder = folder?.isImageFolder === true;
  for (const item of folder?.items ?? []) {
    if (item.type === "folder") folders.push(item);
    else if (imageFolder && IMAGE_EXTENSIONS.has(String(item.extension || "").toLowerCase())) images.push(item);
    else files.push(item);
  }
  return { folders, files, images };
}

export function isPreviewableFile(file) {
  if (!file || file.type !== "file") return false;
  const extension = String(file.extension || "").toLowerCase();
  return extension === ".pdf" || IMAGE_EXTENSIONS.has(extension);
}

export function resourceHref(resourcePath) {
  return String(resourcePath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function applyText(node, text) {
  const value = String(text ?? "");
  node.textContent = value;
  if (/[\u0B80-\u0BFF]/.test(value)) node.lang = "ta";
  else node.removeAttribute("lang");
}

function itemCount(count) {
  return count === 1 ? "1 item" : `${count} items`;
}

function badge(text) {
  const node = document.createElement("span");
  node.className = "badge";
  node.textContent = text;
  return node;
}

function nameSpan(text) {
  const node = document.createElement("span");
  node.className = "resource-name";
  applyText(node, text);
  return node;
}

function actionSpan(text) {
  const node = document.createElement("span");
  node.className = "row-action";
  node.textContent = text;
  return node;
}

function showAlert(message) {
  document.getElementById("page-alert").textContent = message;
}

function hideAlert() {
  const alert = document.getElementById("page-alert");
  if (alert) alert.textContent = "";
}

function setStatus(node, message, { retry = false } = {}) {
  node.replaceChildren();
  if (message) node.append(document.createTextNode(message));
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "retry";
    button.textContent = "Retry";
    button.addEventListener("click", () => {
      loadCatalog();
    });
    node.append(button);
  }
}

function readHashSegments() {
  let raw = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  raw = raw.replace(/^\/+|\/+$/g, "");
  if (!raw) return [];
  return raw.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

function segmentsEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scrollToId(id) {
  const node = document.getElementById(id);
  if (!node) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  node.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

function findTrail(items, segments) {
  const trail = [];
  let level = items;
  for (const segment of segments) {
    const next = level.find((item) => item.type === "folder" && item.name === segment);
    if (!next) return null;
    trail.push(next);
    level = next.items;
  }
  return trail;
}

function goTo(segments) {
  if (!state.catalog) return;
  if (segmentsEqual(segments, readHashSegments())) {
    renderFromHash({ scroll: true });
    return;
  }
  location.hash = segments.length ? `#/${segments.map((segment) => encodeURIComponent(segment)).join("/")}` : "#/";
}

function renderFromHash({ scroll = true } = {}) {
  if (!state.catalog) return;
  const segments = readHashSegments();
  hideAlert();
  if (!segments.length) {
    state.trail = [];
    renderLanding();
    document.title = "ARC - Reformed Learners";
    if (scroll) scrollToId("categories");
    return;
  }
  const trail = findTrail(state.catalog.items, segments);
  if (!trail) {
    state.trail = [];
    renderLanding();
    document.title = "ARC - Reformed Learners";
    showAlert("That folder could not be found.");
    if (scroll) scrollToId("categories");
    return;
  }
  state.trail = trail;
  renderBrowser(trail[trail.length - 1]);
  document.title = `${trail[trail.length - 1].title} · ARC - Reformed Learners`;
  if (scroll) scrollToId("browser");
}

function renderLanding() {
  document.getElementById("categories").hidden = false;
  document.getElementById("browser").hidden = true;
  const folders = state.catalog.items.filter((item) => item.type === "folder");
  const files = state.catalog.items.filter((item) => item.type === "file");
  const grid = document.getElementById("category-grid");
  const status = document.getElementById("catalog-status");
  grid.replaceChildren();
  if (!folders.length && !files.length) setStatus(status, "No resources yet. Add folders inside Resources.");
  else setStatus(status, "");
  folders.forEach((folder, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-card tone-${index % 4}`;
    const kicker = document.createElement("span");
    kicker.className = "card-kicker";
    kicker.textContent = "Folder";
    const title = document.createElement("span");
    title.className = "card-title";
    applyText(title, folder.title);
    const count = document.createElement("span");
    count.className = "card-count";
    count.textContent = itemCount(folder.items.length);
    button.append(kicker, title, count);
    button.addEventListener("click", () => goTo([folder.name]));
    grid.append(button);
  });
  const rootFiles = document.getElementById("root-files");
  rootFiles.replaceChildren(...files.map((file, index) => fileLink(file, index)));
  rootFiles.hidden = files.length === 0;
}

function isCreedsSection() {
  return String(state.trail[0]?.name ?? "").toLowerCase() === "creeds";
}

function renderBrowser(folder) {
  document.getElementById("categories").hidden = true;
  document.getElementById("browser").hidden = false;
  applyText(document.getElementById("folder-title"), folder.title);
  document.getElementById("folder-summary").textContent = itemCount(folder.items.length);
  renderBreadcrumbs();
  const parts = partitionFolder(folder);
  const creeds = isCreedsSection();
  const previews = creeds ? [...parts.files, ...parts.images].filter(isPreviewableFile) : [];
  const remaining = parts.files.filter((file) => !previews.includes(file));
  const rows = document.getElementById("browser-rows");
  const rowNodes = [
    ...parts.folders.map((child, index) => folderButton(child, index)),
    ...remaining.map((file, index) => fileLink(file, parts.folders.length + index)),
  ];
  rows.replaceChildren(...rowNodes);
  rows.hidden = rowNodes.length === 0;
  renderPreviews(previews);
  renderImages(creeds ? [] : parts.images);
  const status = document.getElementById("browser-status");
  const total = parts.folders.length + parts.files.length + parts.images.length;
  status.textContent = total === 0 ? "This folder is empty." : "";
}

function renderBreadcrumbs() {
  const nav = document.getElementById("breadcrumbs");
  const list = document.createElement("ol");
  list.className = "crumbs";
  state.trail.forEach((folder, index) => {
    const item = document.createElement("li");
    if (index === state.trail.length - 1) {
      const current = document.createElement("span");
      current.setAttribute("aria-current", "page");
      applyText(current, folder.title);
      item.append(current);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "crumb";
      applyText(button, folder.title);
      button.addEventListener("click", () => {
        goTo(state.trail.slice(0, index + 1).map((entry) => entry.name));
      });
      item.append(button);
    }
    list.append(item);
  });
  nav.replaceChildren(list);
}

function folderButton(folder, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `resource-row tone-${index % 4}`;
  button.append(badge("Folder"), nameSpan(folder.title), actionSpan("Open"));
  button.addEventListener("click", () => {
    goTo([...state.trail.map((entry) => entry.name), folder.name]);
  });
  return button;
}

function fileLink(file, index) {
  const link = document.createElement("a");
  link.className = `resource-row tone-${index % 4}`;
  link.href = resourceHref(file.path);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const label = file.extension ? file.extension.slice(1).toUpperCase() : "File";
  link.append(badge(label), nameSpan(file.title), actionSpan("Open"));
  if (file.extension === ".json") {
    link.addEventListener("click", (event) => {
      onJsonClick(event, link);
    });
  }
  return link;
}

function renderImages(images) {
  const grid = document.getElementById("image-grid");
  grid.replaceChildren();
  images.forEach((image, index) => {
    const figure = document.createElement("figure");
    figure.className = `image-card tone-${index % 4}`;
    const link = document.createElement("a");
    link.href = resourceHref(image.path);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const img = document.createElement("img");
    img.src = link.href;
    img.alt = "";
    const caption = document.createElement("figcaption");
    applyText(caption, image.title);
    link.append(img, caption);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openImageViewer(image, link);
    });
    figure.append(link);
    grid.append(figure);
  });
  grid.hidden = images.length === 0;
}

function renderPreviews(files) {
  const grid = document.getElementById("preview-grid");
  grid.replaceChildren();
  files.forEach((file, index) => {
    const figure = document.createElement("figure");
    figure.className = `preview-card tone-${index % 4}`;
    const link = document.createElement("a");
    link.href = resourceHref(file.path);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const caption = document.createElement("figcaption");
    applyText(caption, file.title);
    if (file.extension === ".pdf") {
      const frame = document.createElement("object");
      frame.className = "preview-media preview-pdf";
      frame.type = "application/pdf";
      frame.data = `${link.href}#page=1&view=FitH&toolbar=0&navpanes=0`;
      frame.setAttribute("aria-label", `Preview of ${caption.textContent}`);
      frame.append(document.createTextNode("Preview unavailable. Open the file to view it."));
      link.append(frame, caption);
    } else {
      const img = document.createElement("img");
      img.className = "preview-media";
      img.src = link.href;
      img.loading = "lazy";
      img.alt = "";
      link.append(img, caption);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        openImageViewer(file, link);
      });
    }
    figure.append(link);
    grid.append(figure);
  });
  grid.hidden = files.length === 0;
}

async function loadCatalog() {
  const status = document.getElementById("catalog-status");
  setStatus(status, "Loading resources…");
  hideAlert();
  try {
    const response = await fetch(resourceHref("Resources/catalog.json"), { cache: "no-store" });
    if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.items)) throw new Error("Catalog format is invalid");
    state.catalog = payload;
    renderFromHash({ scroll: readHashSegments().length > 0 });
  } catch (error) {
    console.error(error);
    state.catalog = null;
    document.getElementById("category-grid").replaceChildren();
    document.getElementById("root-files").replaceChildren();
    document.getElementById("categories").hidden = false;
    document.getElementById("browser").hidden = true;
    setStatus(status, "The resource catalog could not be loaded.", { retry: true });
    showAlert("The resource catalog could not be loaded.");
  }
}

async function onJsonClick(event, link) {
  event.preventDefault();
  if (opening) return;
  opening = true;
  link.setAttribute("aria-busy", "true");
  const status = document.getElementById("browser-status");
  status.textContent = "Opening…";
  try {
    const response = await fetch(link.href, { cache: "no-store" });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const text = await response.text();
    if (classifyJsonText(text) === "quiz") {
      status.textContent = "";
      openQuiz(JSON.parse(text), link);
    } else {
      status.textContent = "";
      const popup = window.open(link.href, "_blank", "noopener,noreferrer");
      if (!popup) window.location.assign(link.href);
    }
  } catch (error) {
    console.error(error);
    status.textContent = "";
    showAlert("That file could not be opened.");
  } finally {
    opening = false;
    link.removeAttribute("aria-busy");
  }
}

function focusQuestion() {
  const question = document.getElementById("quiz-question");
  question.tabIndex = -1;
  question.focus();
}

const IMAGE_MAX_SCALE = 6;
const imageView = {
  scale: 1,
  x: 0,
  y: 0,
  pointers: new Map(),
  pinch: null,
  pinched: false,
  lastTap: 0,
  lastTapX: 0,
  lastTapY: 0,
};
let imageOpener = null;

function applyImageView() {
  const img = document.getElementById("image-full");
  img.style.transform = `translate(${imageView.x}px, ${imageView.y}px) scale(${imageView.scale})`;
}

function setImageViewScale(scale) {
  imageView.scale = Math.min(IMAGE_MAX_SCALE, Math.max(1, scale));
  if (imageView.scale === 1) {
    imageView.x = 0;
    imageView.y = 0;
  }
  applyImageView();
}

function resetImageView() {
  imageView.scale = 1;
  imageView.x = 0;
  imageView.y = 0;
  imageView.pointers.clear();
  imageView.pinch = null;
  imageView.pinched = false;
  imageView.lastTap = 0;
  applyImageView();
}

function toggleImageViewZoom() {
  setImageViewScale(imageView.scale > 1 ? 1 : 2.5);
}

function openImageViewer(file, trigger) {
  imageOpener = trigger ?? null;
  const dialog = document.getElementById("image-dialog");
  const img = document.getElementById("image-full");
  img.src = resourceHref(file.path);
  img.alt = file.title || "Image";
  resetImageView();
  if (!dialog.open) dialog.showModal();
  document.getElementById("image-close").focus();
}

function bindImageViewer() {
  const dialog = document.getElementById("image-dialog");
  const viewport = document.getElementById("image-viewport");

  document.getElementById("image-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    document.getElementById("image-full").removeAttribute("src");
    resetImageView();
    imageOpener?.focus();
  });

  viewport.addEventListener("pointerdown", (event) => {
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured.
    }
    imageView.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    });
    if (imageView.pointers.size === 2) {
      const [first, second] = [...imageView.pointers.values()];
      imageView.pinched = true;
      imageView.pinch = {
        distance: Math.hypot(first.x - second.x, first.y - second.y),
        scale: imageView.scale,
      };
    } else {
      imageView.pinch = null;
    }
  });

  viewport.addEventListener("pointermove", (event) => {
    const point = imageView.pointers.get(event.pointerId);
    if (!point) return;
    const dx = event.clientX - point.x;
    const dy = event.clientY - point.y;
    point.x = event.clientX;
    point.y = event.clientY;
    if (Math.hypot(event.clientX - point.startX, event.clientY - point.startY) > 6) {
      point.moved = true;
    }
    if (imageView.pointers.size === 2 && imageView.pinch) {
      const [first, second] = [...imageView.pointers.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const ratio = imageView.pinch.distance > 0 ? distance / imageView.pinch.distance : 1;
      setImageViewScale(imageView.pinch.scale * ratio);
      return;
    }
    if (imageView.scale > 1 && (dx !== 0 || dy !== 0)) {
      imageView.x += dx;
      imageView.y += dy;
      applyImageView();
    }
  });

  function endPointer(event) {
    const point = imageView.pointers.get(event.pointerId);
    imageView.pointers.delete(event.pointerId);
    if (imageView.pointers.size < 2) imageView.pinch = null;
    if (imageView.pinched) {
      if (imageView.pointers.size === 0) imageView.pinched = false;
      return;
    }
    if (!point || point.moved) return;
    const now = Date.now();
    const near = Math.hypot(event.clientX - imageView.lastTapX, event.clientY - imageView.lastTapY) < 36;
    if (now - imageView.lastTap < 320 && near) {
      imageView.lastTap = 0;
      toggleImageViewZoom();
    } else {
      imageView.lastTap = now;
      imageView.lastTapX = event.clientX;
      imageView.lastTapY = event.clientY;
    }
  }

  viewport.addEventListener("pointerup", endPointer);
  viewport.addEventListener("pointercancel", (event) => {
    imageView.pointers.delete(event.pointerId);
    if (imageView.pointers.size < 2) imageView.pinch = null;
    if (imageView.pointers.size === 0) imageView.pinched = false;
  });
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      setImageViewScale(imageView.scale * Math.exp(-event.deltaY * 0.0015));
    },
    { passive: false },
  );
}


function openQuiz(data, trigger) {
  opener = trigger ?? null;
  session = {
    source: data,
    attempt: createAttempt(data),
    view: "play",
  };
  renderQuiz();
  const dialog = document.getElementById("quiz-dialog");
  if (!dialog.open) dialog.showModal();
  focusQuestion();
}

function renderQuiz() {
  if (!session) return;
  const play = document.getElementById("quiz-play");
  const results = document.getElementById("quiz-results");
  const dialog = document.getElementById("quiz-dialog");
  if (session.view === "results") {
    play.hidden = true;
    results.hidden = false;
    dialog.setAttribute("aria-labelledby", "results-heading");
    renderResults();
    const heading = document.getElementById("results-heading");
    heading.tabIndex = -1;
    heading.focus();
    return;
  }

  play.hidden = false;
  results.hidden = true;
  dialog.setAttribute("aria-labelledby", "quiz-topic");
  const { attempt } = session;
  const question = attempt.questions[attempt.index];
  const current = attempt.index + 1;
  const total = attempt.questions.length;
  applyText(document.getElementById("quiz-topic"), attempt.topic);
  document.getElementById("quiz-count").textContent = `QUESTION ${current} OF ${total}`;
  const progress = document.getElementById("quiz-progress");
  progress.setAttribute("aria-valuemin", "1");
  progress.setAttribute("aria-valuemax", String(total));
  progress.setAttribute("aria-valuenow", String(current));
  progress.setAttribute("aria-label", `Question ${current} of ${total}`);
  document.getElementById("quiz-progress-bar").style.width = `${(current / total) * 100}%`;
  applyText(document.getElementById("quiz-question"), question.question);
  let answerLabel = "Choose one answer";
  if (question.checked) answerLabel = "Answer locked";
  else if (question.selected !== null) answerLabel = "Ready to submit";
  document.getElementById("answer-label").textContent = answerLabel;

  const answers = document.getElementById("answers");
  answers.replaceChildren();
  for (const choice of answerPresentation(question)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer";
    if (choice.tone === "correct") button.classList.add("is-correct");
    if (choice.tone === "wrong") button.classList.add("is-wrong");
    if (choice.tone === "selected") button.classList.add("is-selected");
    applyText(button, choice.text);
    button.disabled = choice.disabled;
    button.setAttribute("aria-pressed", String(choice.tone === "selected" || choice.tone === "wrong"));
    button.addEventListener("click", () => {
      if (!selectAnswer(attempt, choice.text).changed) return;
      renderQuiz();
      const submit = document.getElementById("quiz-next");
      if (!submit.disabled) submit.focus();
    });
    answers.append(button);
  }

  renderFeedback(question);
  const previous = document.getElementById("quiz-prev");
  const next = document.getElementById("quiz-next");
  previous.hidden = attempt.index === 0;
  next.hidden = false;
  if (question.checked) {
    next.textContent = readyForResults(attempt) ? "See results" : "Next";
    next.disabled = false;
  } else {
    next.textContent = "Submit";
    next.disabled = question.selected === null;
  }
}

function renderFeedback(question) {
  const feedback = document.getElementById("quiz-feedback");
  const model = feedbackFor(question);
  feedback.replaceChildren();
  if (!model) {
    feedback.hidden = true;
    return;
  }
  feedback.hidden = false;
  const status = document.createElement("p");
  status.className = model.correct ? "feedback-status is-correct" : "feedback-status is-wrong";
  applyText(status, model.correct ? "Correct" : "Incorrect");
  feedback.append(status);
  if (model.verse) feedback.append(metaLabel("Verse"), textBlock("p", "verse-ref", model.verse));
  if (model.verseText) feedback.append(textBlock("blockquote", "verse-text", model.verseText));
  if (model.explanation) feedback.append(metaLabel("Explanation"), textBlock("p", "explanation", model.explanation));
}

function renderResults() {
  const score = scoreAttempt(session.attempt);
  document.getElementById("score-percent").textContent = `${score.percentage}%`;
  document.getElementById("score-count").textContent = `${score.correct} of ${score.total} correct`;
  const list = document.getElementById("review-list");
  list.replaceChildren();
  session.attempt.questions.forEach((question, index) => {
    const gotIt = question.selected === question.correct;
    const item = document.createElement("li");
    item.className = gotIt ? "review-item is-correct" : "review-item is-wrong";
    const kicker = document.createElement("p");
    kicker.className = "review-kicker";
    kicker.textContent = `Question ${index + 1} · ${gotIt ? "Correct" : "Incorrect"}`;
    item.append(kicker, textBlock("p", "review-question", question.question));
    if (!gotIt) item.append(metaLabel("Your answer"), chip(question.selected, "is-wrong"));
    item.append(metaLabel("Correct answer"), chip(question.correct, "is-correct"));
    if (question.verse) item.append(metaLabel("Verse"), textBlock("p", "verse-ref", question.verse));
    if (question.verseText) item.append(textBlock("blockquote", "verse-text", question.verseText));
    if (question.explanation) item.append(metaLabel("Explanation"), textBlock("p", "explanation", question.explanation));
    list.append(item);
  });
}

function metaLabel(text) {
  const node = document.createElement("p");
  node.className = "meta-label";
  node.textContent = text;
  return node;
}

function textBlock(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  applyText(node, text);
  return node;
}

function chip(text, tone) {
  const node = document.createElement("p");
  node.className = `answer-chip ${tone}`;
  applyText(node, text);
  return node;
}

function boot() {
  document.getElementById("all-folders").addEventListener("click", () => goTo([]));
  document.querySelector(".cta").addEventListener("click", (event) => {
    event.preventDefault();
    goTo([]);
  });

  const dialog = document.getElementById("quiz-dialog");
  document.getElementById("quiz-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    opener?.focus();
  });
  bindImageViewer();
  document.getElementById("quiz-prev").addEventListener("click", () => {
    if (!session || session.view !== "play" || !goPrevious(session.attempt).ok) return;
    renderQuiz();
    focusQuestion();
  });
  document.getElementById("quiz-next").addEventListener("click", () => {
    if (!session || session.view !== "play") return;
    const attempt = session.attempt;
    const question = attempt.questions[attempt.index];
    if (!question) return;
    if (!question.checked) {
      if (!submitAnswer(attempt).ok) return;
      renderQuiz();
      const feedback = document.getElementById("quiz-feedback");
      feedback.tabIndex = -1;
      feedback.focus();
      return;
    }
    if (readyForResults(attempt)) {
      session.view = "results";
      renderQuiz();
      return;
    }
    if (!goNext(attempt).ok) return;
    renderQuiz();
    focusQuestion();
  });
  document.getElementById("try-again").addEventListener("click", () => {
    if (!session) return;
    session.attempt = createAttempt(session.source);
    session.view = "play";
    renderQuiz();
    focusQuestion();
  });
  window.addEventListener("hashchange", () => renderFromHash({ scroll: true }));
  loadCatalog();
}

if (typeof document !== "undefined" && typeof window !== "undefined") boot();
