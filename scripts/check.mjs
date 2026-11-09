import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  answerPresentation,
  classifyJsonText,
  createAttempt,
  feedbackFor,
  goNext,
  goPrevious,
  isChapterQuiz,
  isPreviewableFile,
  isScriptureQuiz,
  partitionFolder,
  readyForResults,
  resourceHref,
  scoreAttempt,
  selectAnswer,
  shuffle,
  submitAnswer,
} from "../app.js";
import { catalogFile, generateCatalog, projectRoot, resourcesDir } from "./generate-catalog.mjs";
import { HOST, PORT, listen } from "./local-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const probeFile = path.join(resourcesDir, "__server_probe.txt");
const caseDir = path.join(resourcesDir, "__CaseCheck__");
const serverDir = path.join(resourcesDir, "__ServerCheck__");
const binaryExtensions = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico"]);

function request(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: HOST, port: PORT, path: urlPath, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function walkItems(items, visit) {
  for (const item of items) {
    visit(item);
    if (item.type === "folder") walkItems(item.items, visit);
  }
}

function question(overrides = {}) {
  return {
    question: "Who is addressed in Acts?",
    answers: ["Theophilus", "Timothy", "Cornelius", "Philemon"],
    correct: "Theophilus",
    verse: "Acts 1:1",
    verseText: "The first book I wrote, Theophilus,",
    explanation: "Acts addresses Theophilus.",
    ...overrides,
  };
}

function quiz(overrides = {}) {
  return {
    title: "Hidden title",
    topic: "Acts",
    translation: "WEB",
    questions: [question()],
    ...overrides,
  };
}

function assertSchema() {
  assert.equal(isScriptureQuiz(quiz()), true);
  assert.equal(isScriptureQuiz(null), false);
  assert.equal(isScriptureQuiz([]), false);
  assert.equal(isScriptureQuiz(quiz({ title: "   " })), false);
  assert.equal(isScriptureQuiz(quiz({ translation: "" })), false);
  assert.equal(isScriptureQuiz(quiz({ questions: [] })), false);
  assert.equal(isScriptureQuiz(quiz({ note: "extra" })), false);
  assert.equal(isScriptureQuiz(quiz({ questions: [question({ correctIndex: 0 })] })), false);
  assert.equal(isScriptureQuiz(quiz({ questions: [question({ answers: ["Only", "Three", "Here"] })] })), false);
  assert.equal(isScriptureQuiz(quiz({ questions: [question({ correct: "Luke" })] })), false);
  assert.equal(isScriptureQuiz(quiz({ questions: [question({ correct: "theophilus" })] })), false);
  assert.equal(isScriptureQuiz(quiz({ questions: [question({ answers: [" ", "B", "C", "D"], correct: " " })] })), false);
  assert.equal(isScriptureQuiz(quiz({ questions: [question({ verseText: "" })] })), false);
  assert.equal(classifyJsonText("{"), "resource");
  assert.equal(classifyJsonText(JSON.stringify(quiz())), "quiz");
  assert.equal(classifyJsonText(JSON.stringify({ correctIndex: 1 })), "resource");

  const chapter = {
    lessonTitle: "Acts Chapter 1",
    questions: [
      { questionText: "Who am I?", options: ["Peter", "Theophilus", "Luke", "John"], correctIndex: 2 },
    ],
  };
  assert.equal(isChapterQuiz(chapter), true);
  assert.equal(isChapterQuiz(null), false);
  assert.equal(isChapterQuiz({ ...chapter, note: "extra" }), false);
  assert.equal(isChapterQuiz({ ...chapter, lessonTitle: "  " }), false);
  assert.equal(isChapterQuiz({ ...chapter, questions: [] }), false);
  assert.equal(isChapterQuiz({ ...chapter, questions: [{ questionText: "Q", options: ["A", "B", "C"], correctIndex: 0 }] }), false);
  assert.equal(isChapterQuiz({ ...chapter, questions: [{ questionText: "Q", options: ["A", "B", "C", "D"], correctIndex: 4 }] }), false);
  assert.equal(isChapterQuiz({ ...chapter, questions: [{ questionText: "Q", options: ["A", "B", "C", "D"], correctIndex: "2" }] }), false);
  assert.equal(isChapterQuiz({ ...chapter, questions: [{ questionText: "Q", options: ["A", "", "C", "D"], correctIndex: 0 }] }), false);
  assert.equal(classifyJsonText(JSON.stringify(chapter)), "quiz");
  const chapterAttempt = createAttempt(chapter, () => 0);
  assert.equal(chapterAttempt.topic, "Acts Chapter 1");
  assert.equal(chapterAttempt.questions[0].correct, "Luke");
  assert.equal(chapterAttempt.questions[0].answers.length, 4);
  assert.equal(chapterAttempt.questions[0].verse, null);
}

function assertAttemptBehavior() {
  const data = quiz({
    questions: [
      question({ question: "One" }),
      question({
        question: "Two",
        answers: ["Rome", "Jerusalem", "Antioch", "Damascus"],
        correct: "Jerusalem",
        verse: "Acts 1:4",
        verseText: "Wait in Jerusalem.",
        explanation: "Jesus told them to wait there.",
      }),
    ],
  });
  const snapshot = structuredClone(data);
  const attempt = createAttempt(data, () => 0);
  assert.deepEqual(data, snapshot);
  assert.equal("title" in attempt, false);
  assert.equal("translation" in attempt, false);
  assert.equal(attempt.topic, "Acts");
  assert.equal(attempt.questions.length, 2);
  for (const item of attempt.questions) {
    assert.equal(item.answers.includes(item.correct), true);
    assert.equal(item.selected, null);
    const original = data.questions.find((entry) => entry.question === item.question);
    assert.deepEqual([...item.answers].sort(), [...original.answers].sort());
  }

  assert.equal(goNext(attempt).ok, false);
  assert.equal(goPrevious(attempt).ok, false);
  assert.equal(readyForResults(attempt), false);
  const first = attempt.questions[0];
  const savedAnswers = [...first.answers];
  const selected = first.answers[0];
  const picked = selectAnswer(attempt, selected);
  assert.equal(picked.changed, true);
  assert.equal(first.selected, selected);
  assert.equal(first.checked, false);
  assert.equal(selectAnswer(attempt, first.answers[1]).changed, true);
  assert.equal(first.selected, first.answers[1]);
  assert.equal(selectAnswer(attempt, selected).changed, true);
  assert.equal(first.selected, selected);
  assert.equal(goNext(attempt).ok, false);
  assert.equal(feedbackFor(first), null);
  const beforeSubmit = answerPresentation(first);
  assert.equal(beforeSubmit.every((choice) => choice.disabled === false), true);
  assert.equal(beforeSubmit.find((choice) => choice.text === selected).tone, "selected");
  assert.equal(beforeSubmit.filter((choice) => choice.tone === "correct" || choice.tone === "wrong").length, 0);
  const submitted = submitAnswer(attempt);
  assert.equal(submitted.ok, true);
  assert.equal(submitted.correct, selected === first.correct);
  assert.equal(submitAnswer(attempt).ok, false);
  assert.equal(first.checked, true);
  assert.equal(selectAnswer(attempt, first.answers[0]).changed, false);
  const presented = answerPresentation(first);
  assert.equal(presented.every((choice) => choice.disabled), true);
  assert.equal(presented.find((choice) => choice.text === first.correct).tone, "correct");
  if (selected !== first.correct) {
    assert.equal(presented.find((choice) => choice.text === selected).tone, "wrong");
    assert.equal(presented.filter((choice) => choice.tone === "wrong").length, 1);
  } else {
    assert.equal(presented.filter((choice) => choice.tone === "wrong").length, 0);
  }
  const feedback = feedbackFor(first);
  assert.equal(feedback.verse, first.verse);
  assert.equal(feedback.verseText, first.verseText);
  assert.equal(feedback.explanation, first.explanation);
  assert.equal("translation" in feedback, false);
  assert.equal(goNext(attempt).ok, true);
  assert.equal(goPrevious(attempt).ok, true);
  assert.equal(attempt.index, 0);
  assert.equal(first.selected, selected);
  assert.deepEqual(first.answers, savedAnswers);
  assert.equal(goNext(attempt).ok, true);
  assert.equal(readyForResults(attempt), false);
  selectAnswer(attempt, attempt.questions[1].correct);
  assert.equal(readyForResults(attempt), false);
  assert.equal(submitAnswer(attempt).ok, true);
  assert.equal(readyForResults(attempt), true);
  assert.equal(goNext(attempt).ok, false);
  const score = scoreAttempt(attempt);
  assert.equal(score.total, 2);
  assert.equal(score.percentage, Math.round((score.correct / score.total) * 100));

  const correctOnly = { answers: ["A", "B", "C", "D"], correct: "B", selected: "B", checked: true };
  assert.equal(answerPresentation(correctOnly).filter((choice) => choice.tone === "wrong").length, 0);
  const wrongOnly = { answers: ["A", "B", "C", "D"], correct: "B", selected: "C", checked: true };
  assert.deepEqual(
    answerPresentation(wrongOnly).map((choice) => choice.tone),
    ["idle", "correct", "wrong", "idle"],
  );
  const selectedOnly = { answers: ["A", "B", "C", "D"], correct: "B", selected: "C", checked: false };
  assert.deepEqual(
    answerPresentation(selectedOnly).map((choice) => choice.tone),
    ["idle", "idle", "selected", "idle"],
  );
  const open = { answers: ["A", "B", "C", "D"], correct: "B", selected: null, checked: false };
  assert.equal(answerPresentation(open).every((choice) => choice.tone === "idle" && choice.disabled === false), true);
  assert.equal(feedbackFor(open), null);
  assert.deepEqual(scoreAttempt({ questions: [{ selected: "A", correct: "A" }, { selected: "A", correct: "B" }, { selected: "A", correct: "C" }] }), {
    correct: 1,
    total: 3,
    percentage: 33,
  });
}

function assertShuffleVaries(data) {
  const questionOrders = new Set();
  const answerOrders = new Map();
  for (let index = 0; index < 40; index += 1) {
    const attempt = createAttempt(data);
    questionOrders.add(attempt.questions.map((item) => item.question).join("|"));
    for (const item of attempt.questions) {
      assert.equal(item.answers.includes(item.correct), true);
      if (!answerOrders.has(item.question)) answerOrders.set(item.question, new Set());
      answerOrders.get(item.question).add(item.answers.join("|"));
    }
  }
  assert.ok(questionOrders.size > 1, "questions were not shuffled");
  for (const [prompt, orders] of answerOrders) {
    assert.ok(orders.size > 1, `answers were not shuffled for ${prompt}`);
  }
  const once = shuffle(["a", "b", "c", "d"], () => 0);
  assert.deepEqual(once, ["b", "c", "d", "a"]);
  assert.deepEqual(shuffle(["only"]), ["only"]);
}

function assertPartition() {
  const items = [
    { type: "folder", name: "nested" },
    { type: "file", extension: ".svg", name: "lamp.svg" },
    { type: "file", extension: ".PNG", name: "photo.PNG" },
    { type: "file", extension: ".txt", name: "about.txt" },
  ];
  const images = partitionFolder({ isImageFolder: true, items });
  assert.equal(images.folders.length, 1);
  assert.equal(images.images.length, 2);
  assert.equal(images.files.length, 1);
  const plain = partitionFolder({ isImageFolder: false, items });
  assert.equal(plain.images.length, 0);
  assert.equal(plain.files.length, 3);
  assert.equal(isPreviewableFile({ type: "file", extension: ".pdf" }), true);
  assert.equal(isPreviewableFile({ type: "file", extension: ".PNG" }), true);
  assert.equal(isPreviewableFile({ type: "file", extension: ".txt" }), false);
  assert.equal(isPreviewableFile({ type: "folder", extension: "" }), false);
}

async function assertSources() {
  const [html, css, app, pkg] = await Promise.all([
    fs.readFile(path.join(root, "index.html"), "utf8"),
    fs.readFile(path.join(root, "styles.css"), "utf8"),
    fs.readFile(path.join(root, "app.js"), "utf8"),
    fs.readFile(path.join(root, "package.json"), "utf8"),
  ]);
  const packageJson = JSON.parse(pkg);
  assert.equal(packageJson.scripts.serve, "node scripts/local-server.mjs");
  assert.equal(packageJson.scripts.catalog, "node scripts/generate-catalog.mjs");
  assert.equal(packageJson.scripts.check, "node scripts/check.mjs");
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.match(packageJson.engines.node, />=20/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /Noto\+Sans\+Tamil/);
  assert.match(html, /DM\+Sans/);
  assert.match(html, /Playfair\+Display/);
  assert.match(html, /Explore what we have!/);
  assert.match(html, />All folders</);
  assert.match(html, /<dialog id="quiz-dialog"/);
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src="[^"]*(react|vue|jquery)/i);
  for (const color of ["#2a1056", "#c665dc", "#2ca8e4", "#ff7044", "#cbd914", "#f8f6ff", "#25113f", "#d50000", "#39ff14"]) {
    assert.ok(css.toLowerCase().includes(color), `missing color ${color}`);
  }
  assert.match(css, /min-height:\s*245px/);
  assert.match(css, /min-height:\s*270px/);
  assert.match(css, /Playfair Display/);
  assert.match(css, /DM Sans/);
  assert.match(css, /Noto Sans Tamil/);
  const noStore = app.match(/cache:\s*"no-store"/g) ?? [];
  assert.ok(noStore.length >= 2, "catalog and quiz fetches must set cache no-store");
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.deepEqual(app.match(/\.translation\b/g), [".translation"]);
  assert.match(app, /isNonEmptyString\(data\.translation\)/);
  assert.match(app, /QUESTION \$\{current\} OF \$\{total\}/);
  assert.match(app, /See results/);
  assert.match(app, /"Next"/);
  assert.match(app, /"Submit"/);
  assert.match(html, /Try again/);
  assert.match(html, />Previous</);
  assert.match(html, />Submit</);
  assert.match(html, /id="preview-grid"/);
  assert.match(html, /id="image-dialog"/);
  assert.match(html, /id="image-viewport"/);
  assert.match(css, /\.preview-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.image-viewport\s*\{[^}]*touch-action:\s*none/s);
  assert.match(app, /isPreviewableFile/);
  assert.match(app, /openImageViewer/);
  assert.match(app, /"pointerdown"/);
  assert.equal(resourceHref("Resources/வேத பாடங்கள்/யோவான் 3.json").split("/").map(decodeURIComponent).join("/"), "Resources/வேத பாடங்கள்/யோவான் 3.json");
}

function assertSyntax() {
  for (const file of ["app.js", "scripts/generate-catalog.mjs", "scripts/local-server.mjs", "scripts/check.mjs"]) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || `syntax check failed for ${file}`);
  }
}

async function assertUtf8Tree() {
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (binaryExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      const buffer = await fs.readFile(full);
      assert.ok(!(buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf), `BOM in ${full}`);
      const decoded = buffer.toString("utf8");
      assert.ok(Buffer.from(decoded, "utf8").equals(buffer), `invalid UTF-8 in ${path.relative(root, full)}`);
    }
  }
  await walk(root);
}

async function walkTreeFiles(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkTreeFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function assertCatalogShape(catalog) {
  assert.ok(Array.isArray(catalog.items));
  assert.deepEqual(
    catalog.items.map((item) => item.name),
    ["Confessions", "Creeds", "Quiz", "Scripture", "வேத பாடங்கள்"],
  );
  const quizFolder = catalog.items.find((item) => item.name === "Quiz");
  assert.ok(quizFolder, "Quiz folder missing from catalog");
  walkItems(catalog.items, (item) => {
    for (const key of ["type", "title", "name", "path", "extension", "isImageFolder", "items"]) {
      assert.ok(Object.hasOwn(item, key), `${item.path || item.name} missing ${key}`);
    }
    assert.ok(item.type === "folder" || item.type === "file");
    assert.equal(item.path.includes("\\"), false);
    assert.equal(item.name === "catalog.json", false);
    if (item.type === "folder") {
      assert.equal(item.extension, "");
      assert.equal(item.title, item.name);
      assert.equal(item.isImageFolder, item.name.toLowerCase() === "images");
      assert.ok(Array.isArray(item.items));
    } else {
      assert.equal(item.isImageFolder, false);
      assert.deepEqual(item.items, []);
      const extension = path.extname(item.name).toLowerCase();
      assert.equal(item.extension, extension);
      const title = extension ? item.name.slice(0, -extension.length) : item.name;
      assert.equal(item.title, title);
    }
  });

  const jsonPaths = [];
  walkItems(catalog.items, (item) => {
    if (item.type === "file" && item.extension === ".json") jsonPaths.push(item.path);
  });
  for (const known of [...quizPaths, ...resourceJsonPaths]) {
    assert.ok(jsonPaths.includes(known), `catalog missing ${known}`);
  }
  const onDisk = (await walkTreeFiles(resourcesDir))
    .filter((file) => path.extname(file).toLowerCase() === ".json")
    .map((file) => path.relative(projectRoot, file).split(path.sep).join("/"))
    .filter((item) => item !== "Resources/catalog.json");
  assert.deepEqual(jsonPaths.sort(), onDisk.sort());
  const images = catalog.items
    .find((item) => item.name === "Scripture")
    .items.find((item) => item.name === "Acts")
    .items.find((item) => item.name === "images");
  assert.equal(images.isImageFolder, true);
  assert.ok(images.items.some((item) => item.name === "விளக்கு.svg" && item.title === "விளக்கு"));
  assert.ok(images.items.some((item) => item.extension === ".txt"));
  const pdf = catalog.items
    .find((item) => item.name === "Scripture")
    .items.find((item) => item.name === "Acts")
    .items.find((item) => item.name === "Acts Overview.pdf");
  assert.equal(pdf.title, "Acts Overview");
  assert.equal(pdf.extension, ".pdf");
  const tamil = catalog.items.find((item) => item.name === "வேத பாடங்கள்");
  const tamilQuiz = tamil.items.find((item) => item.name === "யோவான் 3.json");
  assert.equal(tamilQuiz.title, "யோவான் 3");
  assert.ok(tamil.items.some((item) => item.type === "folder" && item.name === "குறிப்புகள்"));
  const nested = catalog.items
    .find((item) => item.name === "Scripture")
    .items.find((item) => item.name === "Acts")
    .items.find((item) => item.name === "Letters")
    .items.find((item) => item.name === "Romans")
    .items.find((item) => item.name === "grace.txt");
  assert.equal(nested.path, "Resources/Scripture/Acts/Letters/Romans/grace.txt");
}

async function assertSampleFiles() {
  const actsPath = path.join(resourcesDir, "Scripture", "Acts", "acts-opening.json");
  const tamilPath = path.join(resourcesDir, "வேத பாடங்கள்", "யோவான் 3.json");
  const acts = JSON.parse(await fs.readFile(actsPath, "utf8"));
  const tamil = JSON.parse(await fs.readFile(tamilPath, "utf8"));
  assert.equal(isScriptureQuiz(acts), true);
  assert.equal(isScriptureQuiz(tamil), true);
  assert.equal(acts.title, "Hidden English quiz title");
  assert.equal(acts.translation, "WEB");
  assert.equal(tamil.title, "மறைக்கப்பட்ட தலைப்பு");
  assert.equal(tamil.topic, "யோவான்");
  assert.match(tamil.questions[0].question, /[\u0B80-\u0BFF]/);
  assert.equal(classifyJsonText(await fs.readFile(actsPath, "utf8")), "quiz");
  assert.equal(classifyJsonText(await fs.readFile(tamilPath, "utf8")), "quiz");
  const quizFiles = (await walkTreeFiles(path.join(resourcesDir, "Quiz"))).filter(
    (file) => path.extname(file).toLowerCase() === ".json",
  );
  for (const file of quizFiles) {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(isChapterQuiz(data), true, file);
    assert.equal(classifyJsonText(JSON.stringify(data)), "quiz", file);
    const chapterAttempt = createAttempt(data, () => 0);
    assert.equal(chapterAttempt.questions.length, data.questions.length);
  }
  for (const name of ["almost.json", "broken.json", "legacy-format.json", "study-notes.json"]) {
    const text = await fs.readFile(path.join(resourcesDir, "Scripture", "Acts", name), "utf8");
    assert.equal(classifyJsonText(text), "resource", name);
  }
  await assert.rejects(async () => JSON.parse(await fs.readFile(path.join(resourcesDir, "Scripture", "Acts", "broken.json"), "utf8")));
  assert.match(await fs.readFile(path.join(resourcesDir, "வேத பாடங்கள்", "குறிப்புகள்", "வாசிப்பு.txt"), "utf8"), /[\u0B80-\u0BFF]/);
  assertShuffleVaries(acts);
  assertShuffleVaries(tamil);
}

async function assertImageFolderCase() {
  const images = path.join(caseDir, "Images");
  await fs.mkdir(images, { recursive: true });
  await fs.writeFile(path.join(images, "pixel.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 4 4\"></svg>\n", "utf8");
  try {
    const catalog = await generateCatalog();
    const folder = catalog.items.find((item) => item.name === "__CaseCheck__");
    const imageFolder = folder.items.find((item) => item.name === "Images");
    assert.equal(imageFolder.isImageFolder, true);
    assert.equal(imageFolder.items[0].extension, ".svg");
  } finally {
    await fs.rm(caseDir, { recursive: true, force: true });
  }
}

async function assertServer() {
  const server = await listen();
  try {
    const index = await request("/index.html");
    assert.equal(index.status, 200);
    assert.match(String(index.headers["content-type"]), /text\/html;\s*charset=utf-8/i);
    assert.match(String(index.headers["cache-control"]), /no-store/);
    assert.match(index.body.toString("utf8"), /ARC - Reformed Learners/);

    const rootPage = await request("/");
    assert.equal(rootPage.status, 200);
    assert.match(rootPage.body.toString("utf8"), /Explore what we have!/);

    const style = await request("/styles.css");
    const script = await request("/app.js");
    assert.equal(style.status, 200);
    assert.equal(script.status, 200);
    assert.match(script.body.toString("utf8"), /cache:\s*"no-store"/);

    await fs.writeFile(probeFile, "probe\n", "utf8");
    const withProbe = await request("/Resources/catalog.json");
    assert.equal(withProbe.status, 200);
    assert.match(String(withProbe.headers["cache-control"]), /no-store/);
    assert.match(String(withProbe.headers["content-type"]), /application\/json;\s*charset=utf-8/i);
    const probed = JSON.parse(withProbe.body.toString("utf8"));
    assert.equal(probed.items.some((item) => item.name === "__server_probe.txt"), true);
    await fs.rm(probeFile, { force: true });
    const withoutProbe = JSON.parse((await request("/Resources/catalog.json")).body.toString("utf8"));
    assert.equal(withoutProbe.items.some((item) => item.name === "__server_probe.txt"), false);

    const tamil = await request(`/${resourceHref("Resources/வேத பாடங்கள்/யோவான் 3.json")}`);
    assert.equal(tamil.status, 200);
    const tamilQuiz = JSON.parse(tamil.body.toString("utf8"));
    assert.equal(tamilQuiz.topic, "யோவான்");
    assert.equal(isScriptureQuiz(tamilQuiz), true);

    const pdf = await request(`/${resourceHref("Resources/Scripture/Acts/Acts Overview.pdf")}`);
    assert.equal(pdf.status, 200);
    assert.match(String(pdf.headers["content-type"]), /application\/pdf/);
    assert.equal(pdf.body.subarray(0, 5).toString("latin1"), "%PDF-");

    const svg = await request(`/${resourceHref("Resources/Scripture/Acts/images/விளக்கு.svg")}`);
    assert.equal(svg.status, 200);
    assert.match(svg.body.toString("utf8"), /<svg/);

    const broken = await request("/Resources/Scripture/Acts/broken.json");
    assert.equal(broken.status, 200);
    assert.equal(classifyJsonText(broken.body.toString("utf8")), "resource");

    const missing = await request("/Resources/missing-file.txt");
    assert.equal(missing.status, 404);
    const escaped = await request("/Resources/..%2F..%2F..%2F..%2FWindows/win.ini");
    assert.ok(escaped.status === 403 || escaped.status === 404);
    assert.equal(escaped.body.includes(Buffer.from("[fonts]")), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function cleanup() {
  await fs.rm(probeFile, { force: true });
  await fs.rm(caseDir, { recursive: true, force: true });
  await generateCatalog();
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  assert.ok(major >= 20, `Node.js 20+ is required, found ${process.versions.node}`);
  assert.equal(projectRoot, root);
  assertSyntax();
  await assertSources();
  assertSchema();
  assertAttemptBehavior();
  assertPartition();
  await assertSampleFiles();
  const catalog = await generateCatalog();
  await assertCatalogShape(catalog);
  await assertImageFolderCase();
  const restored = await generateCatalog();
  assert.equal(restored.items.some((item) => item.name === "__CaseCheck__"), false);
  await assertServer();
  await cleanup();
  await assertUtf8Tree();
  const finalCatalog = JSON.parse(await fs.readFile(catalogFile, "utf8"));
  await assertCatalogShape(finalCatalog);
  console.log("check passed");
}

main().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error(cleanupError);
  }
  process.exitCode = 1;
});
