"use strict";

const DATA_URL = "./data.json";
const SETTINGS_KEY = "kanjipath.settings.v3";
const DAILY_KEY = "kanjipath.daily.v3";
const DRAFT_KEY = "kanjipath.local-draft.v1";

const $ = selector => document.querySelector(selector);
const 
$$ = selector => [...document.querySelectorAll(selector)];

let records = [];
let selectedCharacter = "";
let settings = readStorage(SETTINGS_KEY, { language: "pl" });

function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function rubyText(text, reading) {
  const safeText = escapeHTML(text || "");
  const safeReading = escapeHTML(reading || "");
  if (!safeText || !safeReading) return safeText;
  return `<ruby>${safeText}<rt>${safeReading}</rt></ruby>`;
}

function normalizeRecord(item) {
  const sourceMeanings = item.meanings || {};
  const meanings = Array.isArray(sourceMeanings)
    ? { pl: "", en: sourceMeanings.join("; ") }
    : {
        ...sourceMeanings,
        pl: sourceMeanings.pl || "",
        en: sourceMeanings.en || ""
      };

  const sourceExamples = Array.isArray(item.examples)
    ? item.examples
    : Array.isArray(item.words)
      ? item.words.map(word => typeof word === "string" ? { word } : word)
      : [];

  return {
    ...item,
    character: String(item.character || "").trim(),
    characterReading: item.characterReading || "",
    grade: item.grade ?? "",
    schoolStage: item.schoolStage || "",
    jlpt: item.jlpt || item.level || "",
    strokes: item.strokes ?? "",
    meanings,
    onyomi: Array.isArray(item.onyomi) ? item.onyomi : [],
    kunyomi: Array.isArray(item.kunyomi) ? item.kunyomi : [],
    examples: sourceExamples.map(example => {
      const wordMeaning = example.wordMeaning || {};
      const sentenceMeaning = example.sentenceMeaning || {};
      const oldMeanings = Array.isArray(example.meanings)
        ? example.meanings.join("; ")
        : "";

      return {
        ...example,
        word: example.word || "",
        reading: example.reading || "",
        wordMeaning: {
          ...wordMeaning,
          pl: wordMeaning.pl || "",
          en: wordMeaning.en || oldMeanings
        },
        sentence: example.sentence || example.ja || "",
        sentenceReading: example.sentenceReading || "",
        sentenceMeaning: {
          ...sentenceMeaning,
          pl: sentenceMeaning.pl || "",
          en: sentenceMeaning.en || example.en || ""
        }
      };
    })
  };
}

function saveLocalDraft() {
  store(DRAFT_KEY, { version: 1, kanji: records });
}

async function loadJSON() {
  $("#status").textContent = "Wczytuję data.json…";

  try {
    const response = await fetch(`${DATA_URL}?refresh=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data || !Array.isArray(data.kanji)) {
      throw new Error("JSON musi zawierać tablicę kanji.");
    }

    const localDraft = readStorage(DRAFT_KEY, null);
    const source = Array.isArray(localDraft?.kanji)
      ? localDraft.kanji
      : data.kanji;

    records = source.map(normalizeRecord).filter(item => item.character);
    selectedCharacter = "";
    $("#status").textContent =
      `Wczytano ${records.length.toLocaleString("pl-PL")} kanji`;

    renderAll();
  } catch (error) {
    $("#status").textContent = "Nie udało się wczytać data.json";
    $("#detail").innerHTML = `
      <p>Nie udało się wczytać <code>data.json</code>.</p>
      <p class="muted">${escapeHTML(error.message)}</p>
      <p>Sprawdź, czy plik znajduje się obok index.html i jest poprawnym JSON-em.</p>
    `;
  }
}

function displayTranslation(polish, english) {
  const pl = String(polish || "").trim();
  const en = String(english || "").trim();

  if (settings.language === "en") {
    return escapeHTML(en || pl || "Translation unavailable");
  }

  if (settings.language === "both") {
    if (pl && en) {
      return `${escapeHTML(pl)} <span class="muted">/</span> ${escapeHTML(en)}`;
    }
    return escapeHTML(pl || en || "Brak tłumaczenia / Translation unavailable");
  }

  return escapeHTML(pl || en || "Brak tłumaczenia");
}

function getFilteredRecords() {
  const query = $("#search").value.trim().toLowerCase();
  const selectedLevel = $("#level").value;
  const selectedGrade = $("#grade").value;

  return records.filter(item => {
    if (selectedLevel !== "all" && item.jlpt !== selectedLevel) return false;
    if (selectedGrade !== "all" && String(item.grade) !== selectedGrade) return false;

    const exampleText = item.examples.flatMap(example => [
      example.word,
      example.reading,
      example.wordMeaning?.pl,
      example.wordMeaning?.en,
      example.sentence,
      example.sentenceReading,
      example.sentenceMeaning?.pl,
      example.sentenceMeaning?.en
    ]);

    const searchable = [
      item.character,
      item.characterReading,
      item.meanings?.pl,
      item.meanings?.en,
      item.schoolStage,
      ...item.onyomi,
      ...item.kunyomi,
      ...exampleText
    ].join(" ").toLowerCase();

    return !query || searchable.includes(query);
  }).sort((a, b) => a.character.localeCompare(b.character));
}

function renderAll() {
  renderList();
  renderDaily();
  if (selectedCharacter) renderDetail(selectedCharacter);
}

function renderList() {
  const all = getFilteredRecords();
  const visible = all.slice(0, 300);

  $("#count").textContent = `${all.length.toLocaleString("pl-PL")} wyników`;
  $("#listHint").textContent = all.length > visible.length
    ? `Wyświetlam pierwsze ${visible.length}. Zawęź wyszukiwanie lub filtry.`
    : "";

  $("#cards").innerHTML = visible.map(item => `
    <button type="button"
      class="tile ${item.character === selectedCharacter ? "selected" : ""}"
      data-character="${escapeHTML(item.character)}">
      <span class="glyph">${rubyText(item.character, item.characterReading)}</span>
      <small>${displayTranslation(item.meanings.pl, item.meanings.en)}</small>
    </button>
  `).join("");

  $$("#cards [data-character]").forEach(button => {
    button.addEventListener("click", () => {
      selectedCharacter = button.dataset.character;
      renderList();
      renderDetail(selectedCharacter);
    });
  });
}

function renderDetail(character) {
  const item = records.find(record => record.character === character);
  if (!item) return;

  const examplesHTML = item.examples.length
    ? item.examples.map(example => `
      <div class="example">
        <h3>${rubyText(example.word || "Przykład", example.reading)}</h3>
        ${(example.wordMeaning.pl || example.wordMeaning.en)
          ? `<div>${displayTranslation(
              example.wordMeaning.pl, example.wordMeaning.en
            )}</div>`
          : ""}
        ${example.sentence
          ? `<div class="example-ja">
              ${rubyText(example.sentence, example.sentenceReading)}
            </div>`
          : ""}
        ${(example.sentenceMeaning.pl || example.sentenceMeaning.en)
          ? `<div>${displayTranslation(
              example.sentenceMeaning.pl, example.sentenceMeaning.en
            )}</div>`
          : ""}
      </div>
    `).join("")
    : `<p class="muted">Nie dodano jeszcze przykładów.</p>`;

  $("#detail").innerHTML = `
    <div class="hero">
      <div class="bigkanji">${rubyText(item.character, item.characterReading)}</div>
      <div>
        <h2>${escapeHTML(item.character)}</h2>
        <div>${displayTranslation(item.meanings.pl, item.meanings.en)}</div>
        ${item.jlpt ? `<span class="tag">JLPT ${escapeHTML(item.jlpt)} · przybliżony</span>` : ""}
        ${item.grade ? `<span class="tag">Klasa ${escapeHTML(item.grade)}</span>` : ""}
        ${item.schoolStage ? `<span class="tag">${escapeHTML(item.schoolStage)}</span>` : ""}
        ${item.strokes ? `<span class="tag">${escapeHTML(item.strokes)} kresek</span>` : ""}
      </div>
    </div>

    <div class="example">
      <h3>Odczyty</h3>
      <p><b>On’yomi:</b> ${escapeHTML(item.onyomi.join("、") || "—")}</p>
      <p><b>Kun’yomi:</b> ${escapeHTML(item.kunyomi.join("、") || "—")}</p>
    </div>

    <div class="example">
      <h3>Słowa i zdania (${item.examples.length})</h3>
      ${examplesHTML}
    </div>

    <div class="actions">
      <button type="button" id="editSelected">Edytuj kanji</button>
      <button type="button" id="speakKanji" class="secondary">Odsłuchaj kanji</button>
    </div>

    <section class="practice-tools">
      <h3>Ćwiczenie pisania</h3>
      <p class="muted">Narysuj znak palcem lub myszą.</p>
      <canvas id="writingCanvas" width="640" height="440"></canvas>
      <div class="actions">
        <button type="button" id="clearCanvas" class="secondary">Wyczyść</button>
        <button type="button" id="showKanji" class="secondary">Pokaż znak</button>
        <button type="button" id="listenSentence" class="secondary">Odsłuchaj zdanie</button>
        <button type="button" id="checkPronunciation" class="secondary">Sprawdź wymowę</button>
      </div>
      <p id="practiceMessage" class="status" aria-live="polite"></p>
    </section>
  `;

  $("#editSelected").addEventListener("click", () => openEditor(character));
  $("#speakKanji").addEventListener("click", () => speakJapanese(item.character));
  setupPracticeTools(item);
}

function setupPracticeTools(item) {
  const canvas = $("#writingCanvas");
  const context = canvas.getContext("2d");
  let drawing = false;

  context.lineWidth = 8;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#252b32";

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height
    };
  }

  canvas.addEventListener("pointerdown", event => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const p = point(event);
    context.beginPath();
    context.moveTo(p.x, p.y);
  });

  canvas.addEventListener("pointermove", event => {
    if (!drawing) return;
    const p = point(event);
    context.lineTo(p.x, p.y);
    context.stroke();
  });

  canvas.addEventListener("pointerup", () => {
    drawing = false;
    context.closePath();
  });

  canvas.addEventListener("pointercancel", () => {
    drawing = false;
  });

  $("#clearCanvas").addEventListener("click", () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    $("#practiceMessage").textContent = "";
  });

  $("#showKanji").addEventListener("click", () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#e8e1d9";
    context.font = '280px "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(item.character, canvas.width / 2, canvas.height / 2);
  });

  $("#listenSentence").addEventListener("click", () => {
    const sentence = item.examples.find(example => example.sentence)?.sentence;
    if (sentence) speakJapanese(sentence);
    else $("#practiceMessage").textContent = "Nie dodano zdania do tego kanji.";
  });

  $("#checkPronunciation").addEventListener("click", () => {
    checkPronunciation(item);
  });
}

function speakJapanese(text) {
  if (!("speechSynthesis" in window)) {
    $("#practiceMessage").textContent = "Synteza mowy nie jest dostępna.";
    return;
  }

  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  speechSynthesis.speak(utterance);
}

function checkPronunciation(item) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Recognition) {
    $("#practiceMessage").textContent =
      "Rozpoznawanie mowy nie jest obsługiwane przez tę przeglądarkę.";
    return;
  }

  const expected = item.characterReading ||
    item.examples.find(example => example.reading)?.reading;

  if (!expected) {
    $("#practiceMessage").textContent =
      "Uzupełnij najpierw odczyt kanji lub słowa w edytorze.";
    return;
  }

  const recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  $("#practiceMessage").textContent = "Słucham — wypowiedz odczyt.";

  recognition.onresult = event => {
    const heard = event.results[0][0].transcript || "";
    const clean = value => value.replace(/[\s。、！？,.!?]/g, "").normalize("NFC");
    $("#practiceMessage").textContent = clean(heard) === clean(expected)
      ? `Rozpoznano „${heard}” — zgodne z wpisanym odczytem.`
      : `Rozpoznano „${heard}”. Oczekiwany odczyt: „${expected}”.`;
  };

  recognition.onerror = event => {
    $("#practiceMessage").textContent =
      `Błąd rozpoznawania mowy: ${event.error}. Sprawdź mikrofon i uprawnienia.`;
  };

  recognition.start();
}

function renderDaily() {
  $("#dailyDate").textContent = new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date());

  const pool = getFilteredRecords();
  if (!pool.length) {
    $("#dailyContent").innerHTML = '<p class="muted">Brak kanji w filtrze.</p>';
    return;
  }

  const dateKey = [
    new Date().getFullYear(),
    String(new Date().getMonth() + 1).padStart(2, "0"),
    String(new Date().getDate()).padStart(2, "0")
  ].join("-");

  const filterKey = `${$("#level").value}|${$("#grade").value}`;
  const seedText = `${dateKey}|${filterKey}`;
  let seed = 0;
  for (const char of seedText) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;

  const item = pool[seed % pool.length];
  const key = `${dateKey}|${filterKey}`;
  const done = readStorage(DAILY_KEY, {})[key] === item.character;

  $("#dailyContent").innerHTML = `
    <div class="daily-content">
      <div class="daily-kanji">${rubyText(item.character, item.characterReading)}</div>
      <div>
        <h3>${displayTranslation(item.meanings.pl, item.meanings.en)}</h3>
        <div class="actions">
          <button type="button" id="openDaily">Otwórz kartę</button>
          <button type="button" id="markDaily" class="secondary" ${done ? "disabled" : ""}>
            ${done ? "Przerobione dziś" : "Oznacz jako przerobione"}
          </button>
        </div>
      </div>
    </div>
  `;

  $("#openDaily").addEventListener("click", () => {
    selectedCharacter = item.character;
    renderList();
    renderDetail(item.character);
    $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#markDaily").addEventListener("click", () => {
    const daily = readStorage(DAILY_KEY, {});
    daily[key] = item.character;
    store(DAILY_KEY, daily);
    renderDaily();
  });
}

function addExampleEditor(example = {}) {
  const row = document.createElement("div");
  row.className = "example-editor";
  row.innerHTML = `
    <div class="example-editor-grid">
      <label>Słowo po japońsku
        <input data-field="word" value="${escapeHTML(example.word || "")}">
      </label>
      <label>Furigana / odczyt słowa
        <input data-field="reading" value="${escapeHTML(example.reading || "")}">
      </label>
      <label>Znaczenie słowa — polski
        <input data-field="wordPL" value="${escapeHTML(example.wordMeaning.pl || "")}">
      </label>
      <label>Word meaning — English
        <input data-field="wordEN" value="${escapeHTML(example.wordMeaning.en || "")}">
      </label>
      <label>Zdanie po japońsku
        <textarea data-field="sentence">${escapeHTML(example.sentence || "")}</textarea>
      </label>
      <label>Furigana / odczyt zdania
        <input data-field="sentenceReading"
          value="${escapeHTML(example.sentenceReading || "")}">
      </label>
      <label>Znaczenie zdania — polski
        <textarea data-field="sentencePL">${escapeHTML(example.sentenceMeaning.pl || "")}</textarea>
      </label>
      <label>Sentence meaning — English
        <textarea data-field="sentenceEN">${escapeHTML(example.sentenceMeaning.en || "")}</textarea>
      </label>
    </div>
    <button type="button" class="button secondary remove-example">Usuń przykład</button>
  `;

  row.querySelector(".remove-example").addEventListener("click", () => row.remove());
  $("#examples").appendChild(row);
}

function openEditor(character = "") {
  const item = records.find(record => record.character === character);
  $("#kanjiForm").reset();
  $("#examples").innerHTML = "";

  $("#originalCharacter").value = item?.character || "";
  $("#character").value = item?.character || "";
  $("#characterReading").value = item?.characterReading || "";
  $("#gradeInput").value = item?.grade || "";
  $("#stageInput").value = item?.schoolStage || "";
  $("#jlptInput").value = item?.jlpt || "";
  $("#strokesInput").value = item?.strokes || "";
  $("#meaningPL").value = item?.meanings.pl || "";
  $("#meaningEN").value = item?.meanings.en || "";
  $("#onyomiInput").value = (item?.onyomi || []).join(", ");
  $("#kunyomiInput").value = (item?.kunyomi || []).join(", ");

  const known = new Set([
    "character", "characterReading", "grade", "schoolStage", "jlpt", "level",
    "strokes", "meanings", "onyomi", "kunyomi", "examples", "words"
  ]);

  const extras = Object.fromEntries(
    Object.entries(item || {}).filter(([key]) => !known.has(key))
  );
  $("#extraFields").value = Object.keys(extras).length
    ? JSON.stringify(extras, null, 2)
    : "";

  $("#formTitle").textContent = item ? `Edytuj kanji ${item.character}` : "Dodaj kanji";
  (item?.examples || []).forEach(addExampleEditor);
  if (!item) addExampleEditor();

  showTab("manage");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function saveEditor(event) {
  event.preventDefault();
  const character = $("#character").value.trim();
  if (!character) return;

  let extras = {};
  if ($("#extraFields").value.trim()) {
    try {
      extras = JSON.parse($("#extraFields").value);
      if (!extras || Array.isArray(extras) || typeof extras !== "object") {
        throw new Error("Dodatkowe pola muszą być obiektem JSON.");
      }
    } catch (error) {
      alert(`Nieprawidłowy JSON w polu dodatkowych danych: ${error.message}`);
      return;
    }
  }

  const get = (row, name) =>
    row.querySelector(`[data-field="${name}"]`).value.trim();

  const examples = 
$$(".example-editor").map(row => ({
    word: get(row, "word"),
    reading: get(row, "reading"),
    wordMeaning: { pl: get(row, "wordPL"), en: get(row, "wordEN") },
    sentence: get(row, "sentence"),
    sentenceReading: get(row, "sentenceReading"),
    sentenceMeaning: { pl: get(row, "sentencePL"), en: get(row, "sentenceEN") }
  })).filter(example =>
    example.word || example.reading || example.wordMeaning.pl ||
    example.wordMeaning.en || example.sentence || example.sentenceReading ||
    example.sentenceMeaning.pl || example.sentenceMeaning.en
  );

  const original = $("#originalCharacter").value;
  const previous = records.find(item => item.character === original) ||
    records.find(item => item.character === character) || {};

  const record = normalizeRecord({
    ...previous,
    ...extras,
    character,
    characterReading: $("#characterReading").value.trim(),
    grade: $("#gradeInput").value ? Number($("#gradeInput").value) : null,
    schoolStage: $("#stageInput").value,
    jlpt: $("#jlptInput").value,
    strokes: $("#strokesInput").value ? Number($("#strokesInput").value) : null,
    meanings: {
      pl: $("#meaningPL").value.trim(),
      en: $("#meaningEN").value.trim()
    },
    onyomi: $("#onyomiInput").value.split(/[,;،]/).map(x => x.trim()).filter(Boolean),
    kunyomi: $("#kunyomiInput").value.split(/[,;،]/).map(x => x.trim()).filter(Boolean),
    examples
  });

  if (original && original !== character) {
    records = records.filter(item => item.character !== original);
  }

  const index = records.findIndex(item => item.character === character);
  if (index >= 0) records[index] = record;
  else records.push(record);

  selectedCharacter = character;
  saveLocalDraft();
  renderAll();
  renderDetail(character);

  $("#status").textContent = "Zapisano lokalny szkic — pobierz JSON, aby zachować go na GitHubie.";
  $("#dataMessage").textContent = "Zapisano kanji i przykłady lokalnie.";
  showTab("learn");
}

function exportJSON(download = true) {
  const payload = {
    version: 1,
    source: "Kanji Path",
    kanji: records
  };
  const text = JSON.stringify(payload, null, 2);

  if (!download) return text;

  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "data.json";
  link.click();
  URL.revokeObjectURL(url);

  $("#dataMessage").textContent = "Pobrano pełny plik data.json.";
}

async function importJSON(file) {
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.kanji;
    if (!Array.isArray(incoming)) {
      throw new Error("Plik musi zawierać tablicę kanji.");
    }

    const imported = incoming.map(normalizeRecord).filter(item => item.character);
    if (!imported.length) throw new Error("Nie znaleziono rekordów kanji.");

    if ($("#importMode").value === "replace") {
      records = imported;
    } else {
      const map = new Map(records.map(item => [item.character, item]));
      imported.forEach(item => map.set(item.character, item));
      records = [...map.values()];
    }

    selectedCharacter = "";
    saveLocalDraft();
    renderAll();
    $("#detail").innerHTML = '<p class="muted">Wybierz znak z listy.</p>';
    $("#dataMessage").textContent = `Zaimportowano ${imported.length} rekordów.`;
  } catch (error) {
    $("#dataMessage").textContent = `Import nie powiódł się: ${error.message}`;
  } finally {
    $("#importFile").value = "";
  }
}

function startQuiz() {
  const pool = getFilteredRecords().filter(
    item => item.meanings.pl || item.meanings.en
  );

  if (pool.length < 2) {
    $("#quizContent").innerHTML =
      '<p class="muted">Quiz wymaga co najmniej dwóch kanji ze znaczeniami.</p>';
    return;
  }

  const question = pool[Math.floor(Math.random() * pool.length)];
  const answer = question.meanings.pl || question.meanings.en;
  const choices = [
    question,
    ...pool.filter(item => item.character !== question.character)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
  ].sort(() => Math.random() - 0.5);

  $("#quizContent").innerHTML = `
    <p>Wybierz znaczenie znaku:</p>
    <div class="bigkanji">${rubyText(question.character, question.characterReading)}</div>
    ${choices.map(item => `
      <button class="quiz-choice" data-answer="${escapeHTML(item.character)}"
        type="button">${displayTranslation(item.meanings.pl, item.meanings.en)}</button>
    `).join("")}
    <p id="quizFeedback" class="quiz-feedback" aria-live="polite"></p>
  `;

  $$("#quizContent [data-answer]").forEach(button => {
    button.addEventListener("click", () => {
      $("#quizFeedback").textContent =
        button.dataset.answer === question.character
          ? "Dobrze!"
          : `Spróbuj ponownie. Poprawne znaczenie: ${answer}`;
    });
  });
}

function showTab(id) {
  $$(".view").forEach(view => view.classList.toggle("hidden", view.id !== id));
  $$(".tab").forEach(button => {
    const active = button.dataset.tab === id;
    button.classList.toggle("active", active);
    button.classList.toggle("secondary", !active);
  });
}

$("#kanjiForm").addEventListener("submit", saveEditor);
$("#addExample").addEventListener("click", () => addExampleEditor());
$("#newEntry").addEventListener("click", () => openEditor(""));
$("#copyJson").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(exportJSON(false));
    $("#status").textContent = "JSON skopiowany.";
  } catch {
    exportJSON(true);
    $("#status").textContent = "Pobrano plik JSON.";
  }
});
$("#exportFile").addEventListener("click", () => exportJSON(true));
$("#importFile").addEventListener("change", event => importJSON(event.target.files?.[0]));
$("#startQuiz").addEventListener("click", startQuiz);

$("#refresh").addEventListener("click", () => {
  if (readStorage(DRAFT_KEY, null) &&
      !confirm("Odświeżenie wczyta data.json z serwera i usunie lokalny szkic. Kontynuować?")) {
    return;
  }
  localStorage.removeItem(DRAFT_KEY);
  loadJSON();
});

$("#language").value = settings.language || "pl";
$("#language").addEventListener("change", () => {
  settings.language = $("#language").value;
  store(SETTINGS_KEY, settings);
  renderAll();
});

$("#search").addEventListener("input", renderList);
["level", "grade"].forEach(id => {
  $("#" + id).addEventListener("change", renderAll);
});

$("#clear").addEventListener("click", () => {
  $("#search").value = "";
  $("#level").value = "all";
  $("#grade").value = "all";
  renderAll();
});

$$(".tab").forEach(button => {
  button.addEventListener("click", () => {
    showTab(button.dataset.tab);
    if (button.dataset.tab === "quiz") startQuiz();
  });
});

loadJSON();
