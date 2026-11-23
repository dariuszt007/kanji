"use strict";

const DATA_URL = "./data.json";
const SETTINGS_KEY = "kanjipath.settings.v4";
const DAILY_KEY = "kanjipath.daily.v4";
const DRAFT_KEY = "kanjipath.local-draft.v2";

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
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Nie udało się zapisać lokalnie:", error);
  }
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function isKanji(character) {
  return /\p{Script=Han}/u.test(character);
}

function textCharacters(text) {
  return Array.from(String(text || ""));
}

function normalizeFurigana(text, source) {
  const characters = textCharacters(text);
  const input = Array.isArray(source) ? source : [];

  return characters.map((character, index) => {
    const savedPart = input[index];

    return {
      text: character,
      reading: isKanji(character) && savedPart?.text === character
        ? String(savedPart.reading || "")
        : ""
    };
  });
}

function migrateFurigana(oldText, newText, oldSegments) {
  const oldCharacters = textCharacters(oldText);
  const newCharacters = textCharacters(newText);
  const normalizedOld = normalizeFurigana(oldText, oldSegments);
  const used = new Set();

  return newCharacters.map((character, newIndex) => {
    if (!isKanji(character)) {
      return { text: character, reading: "" };
    }

    let matchIndex = -1;

    if (oldCharacters[newIndex] === character && !used.has(newIndex)) {
      matchIndex = newIndex;
    } else {
      matchIndex = oldCharacters.findIndex((oldCharacter, index) =>
        oldCharacter === character &&
        isKanji(oldCharacter) &&
        !used.has(index)
      );
    }

    if (matchIndex < 0) {
      return { text: character, reading: "" };
    }

    used.add(matchIndex);
    return {
      text: character,
      reading: normalizedOld[matchIndex]?.reading || ""
    };
  });
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

  const character = String(item.character || "").trim();

  let characterFurigana = item.characterFurigana;

  // Obsługa starszego formatu z jednym odczytem dla pojedynczego kanji.
  if (
    !Array.isArray(characterFurigana) &&
    textCharacters(character).length === 1 &&
    isKanji(character) &&
    item.characterReading
  ) {
    characterFurigana = [{
      text: character,
      reading: item.characterReading
    }];
  }

  return {
    ...item,
    character,
    characterFurigana: normalizeFurigana(
      character,
      characterFurigana
    ),
    grade: item.grade ?? "",
    schoolStage: item.schoolStage || "",
    jlpt: item.jlpt || item.level || "",
    strokes: item.strokes ?? "",
    meanings,
    onyomi: Array.isArray(item.onyomi) ? item.onyomi : [],
    kunyomi: Array.isArray(item.kunyomi) ? item.kunyomi : [],
    examples: sourceExamples.map(example => {
      const word = String(example.word || "");
      const sentence = String(example.sentence || example.ja || "");
      const wordMeaning = example.wordMeaning || {};
      const sentenceMeaning = example.sentenceMeaning || {};
      const oldMeanings = Array.isArray(example.meanings)
        ? example.meanings.join("; ")
        : "";

      return {
        ...example,
        word,
        wordFurigana: normalizeFurigana(word, example.wordFurigana),
        wordMeaning: {
          ...wordMeaning,
          pl: wordMeaning.pl || "",
          en: wordMeaning.en || oldMeanings
        },
        sentence,
        sentenceFurigana: normalizeFurigana(
          sentence,
          example.sentenceFurigana
        ),
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
  store(DRAFT_KEY, { version: 2, kanji: records });
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

function renderFurigana(text, segments) {
  const normalized = normalizeFurigana(text, segments);

  return normalized.map(part => {
    const safeCharacter = escapeHTML(part.text);
    const safeReading = escapeHTML(part.reading);

    if (isKanji(part.text) && safeReading) {
      return `<ruby>${safeCharacter}<rt>${safeReading}</rt></ruby>`;
    }

    return safeCharacter;
  }).join("");
}

function showTab(id) {
  $$(".view").forEach(view => {
    view.classList.toggle("hidden", view.id !== id);
  });

  $$(".tab").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === id);
  });
}

async function loadJSON() {
  $("#status").textContent = "Wczytuję data.json…";

  try {
    const response = await fetch(`${DATA_URL}?refresh=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.kanji)) {
      throw new Error("JSON musi zawierać tablicę kanji.");
    }

    const draft = readStorage(DRAFT_KEY, null);
    const source = Array.isArray(draft?.kanji) ? draft.kanji : data.kanji;

    records = source
      .map(normalizeRecord)
      .filter(item => item.character);

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

function getFilteredRecords() {
  const query = $("#search").value.trim().toLowerCase();
  const selectedLevel = $("#level").value;
  const selectedGrade = $("#grade").value;

  return records.filter(item => {
    if (selectedLevel !== "all" && item.jlpt !== selectedLevel) {
      return false;
    }

    if (selectedGrade !== "all" && String(item.grade) !== selectedGrade) {
      return false;
    }

    const exampleText = item.examples.flatMap(example => [
      example.word,
      example.wordMeaning?.pl,
      example.wordMeaning?.en,
      example.sentence,
      example.sentenceMeaning?.pl,
      example.sentenceMeaning?.en
    ]);

    const searchable = [
      item.character,
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

  if (selectedCharacter) {
    renderDetail(selectedCharacter);
  }
}

function renderList() {
  const all = getFilteredRecords();
  const visible = all.slice(0, 300);

  $("#count").textContent = `${all.length.toLocaleString("pl-PL")} wyników`;
  $("#listHint").textContent = all.length > visible.length
    ? `Wyświetlam pierwsze ${visible.length}. Zawęź wyszukiwanie lub filtry.`
    : "";

  $("#cards").innerHTML = visible.map(item => `
    <button
      type="button"
      class="tile ${item.character === selectedCharacter ? "selected" : ""}"
      data-character="${escapeHTML(item.character)}"
    >
      <span class="glyph">${renderFurigana(
        item.character,
        item.characterFurigana
      )}</span>
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

  const examplesHTML = item.examples.map((example, index) => `
    <article class="example">
      ${example.word
        ? `<h3 class="japanese-text">${renderFurigana(
            example.word,
            example.wordFurigana
          )}</h3>`
        : ""}
      ${(example.wordMeaning.pl || example.wordMeaning.en)
        ? `<div>${displayTranslation(
            example.wordMeaning.pl,
            example.wordMeaning.en
          )}</div>`
        : ""}
      ${example.sentence
        ? `<div class="example-ja">${renderFurigana(
            example.sentence,
            example.sentenceFurigana
          )}</div>`
        : ""}
      ${(example.sentenceMeaning.pl || example.sentenceMeaning.en)
        ? `<div>${displayTranslation(
            example.sentenceMeaning.pl,
            example.sentenceMeaning.en
          )}</div>`
        : ""}
      ${example.sentence ? `
        <div class="sentence-actions">
          <button
            type="button"
            class="button secondary"
            data-listen-sentence="${index}"
          >
            Odsłuchaj zdanie
          </button>
          <button
            type="button"
            class="button secondary"
            data-check-sentence="${index}"
          >
            Nagraj i sprawdź wymowę
          </button>
        </div>
        <p
          id="sentenceStatus${index}"
          class="sentence-status"
          aria-live="polite"
        ></p>
      ` : ""}
    </article>
  `).join("");

  $("#detail").innerHTML = `
    <div class="hero">
      <div class="bigkanji">
        ${renderFurigana(item.character, item.characterFurigana)}
      </div>
      <div>
        <h2>${escapeHTML(item.character)}</h2>
        <div>${displayTranslation(item.meanings.pl, item.meanings.en)}</div>
        ${item.jlpt
          ? `<span class="tag">JLPT ${escapeHTML(item.jlpt)} · przybliżony</span>`
          : ""}
        ${item.grade
          ? `<span class="tag">Klasa ${escapeHTML(item.grade)}</span>`
          : ""}
        ${item.schoolStage
          ? `<span class="tag">${escapeHTML(item.schoolStage)}</span>`
          : ""}
        ${item.strokes
          ? `<span class="tag">${escapeHTML(item.strokes)} kresek</span>`
          : ""}
      </div>
    </div>

    <div class="example">
      <h3>Odczyty</h3>
      <p><b>On’yomi:</b> ${escapeHTML(item.onyomi.join("、") || "—")}</p>
      <p><b>Kun’yomi:</b> ${escapeHTML(item.kunyomi.join("、") || "—")}</p>
      <div class="actions">
        <button type="button" id="editSelected" class="button">
          Edytuj kanji
        </button>
      </div>
    </div>

    <div class="example">
      <h3>Słowa i zdania (${item.examples.length})</h3>
      ${examplesHTML || '<p class="muted">Nie dodano jeszcze przykładów.</p>'}
    </div>

    <section class="practice-tools">
      <h3>Ćwiczenie pisania</h3>
      <p class="muted">Narysuj znak palcem lub myszą.</p>
      <canvas id="writingCanvas" width="640" height="440"></canvas>
      <div class="actions">
        <button type="button" id="clearCanvas" class="button secondary">
          Wyczyść
        </button>
        <button type="button" id="showKanji" class="button secondary">
          Pokaż wzór pisma
        </button>
      </div>
      <p id="practiceMessage" class="status" aria-live="polite"></p>
    </section>
  `;

  $("#editSelected").addEventListener("click", () => openEditor(character));

  $$("[data-listen-sentence]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.listenSentence);
      const example = item.examples[index];
      const status = $(`#sentenceStatus${index}`);

      if (example?.sentence) {
        speakJapanese(example.sentence, status);
      }
    });
  });

  $$("[data-check-sentence]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.checkSentence);
      const example = item.examples[index];

      if (example) {
        checkSentencePronunciation(example, index);
      }
    });
  });

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

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();

    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height
    };
  }

  canvas.addEventListener("pointerdown", event => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);

    const point = canvasPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  });

  canvas.addEventListener("pointermove", event => {
    if (!drawing) return;

    const point = canvasPoint(event);
    context.lineTo(point.x, point.y);
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

  $("#showKanji").addEventListener("click", async () => {
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (document.fonts?.load) {
      try {
        await document.fonts.load('280px "Klee One"');
      } catch {
        // Jeśli fontu nie da się załadować, canvas użyje fontu zastępczego.
      }
    }

    context.save();
    context.fillStyle = "#ded8d0";
    context.font =
      '280px "Klee One", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(item.character, canvas.width / 2, canvas.height / 2);
    context.restore();
  });
}

function speakJapanese(text, statusElement) {
  if (!("speechSynthesis" in window)) {
    statusElement.textContent =
      "Odsłuch nie jest obsługiwany przez tę przeglądarkę.";
    return;
  }

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.onerror = () => {
    statusElement.textContent = "Nie udało się odtworzyć zdania.";
  };

  speechSynthesis.speak(utterance);
}

function katakanaToHiragana(text) {
  return Array.from(String(text || ""), character => {
    const code = character.codePointAt(0);

    return code >= 0x30a1 && code <= 0x30f6
      ? String.fromCodePoint(code - 0x60)
      : character;
  }).join("");
}

function normalizeSpeechText(text) {
  return katakanaToHiragana(String(text || ""))
    .normalize("NFC")
    .replace(/[\s。、！？,.!?「」『』（）()]/g, "");
}

function expectedSentenceReading(example) {
  const segments = normalizeFurigana(
    example.sentence,
    example.sentenceFurigana
  );

  const missingKanji = [
    ...new Set(
      segments
        .filter(segment => isKanji(segment.text) && !segment.reading.trim())
        .map(segment => segment.text)
    )
  ];

  if (missingKanji.length) {
    return { reading: "", missingKanji };
  }

  const reading = segments.map(segment =>
    isKanji(segment.text) ? segment.reading : segment.text
  ).join("");

  return { reading, missingKanji: [] };
}

function firstDifference(expected, heard) {
  const expectedCharacters = Array.from(expected);
  const heardCharacters = Array.from(heard);
  const length = Math.max(expectedCharacters.length, heardCharacters.length);

  for (let index = 0; index < length; index++) {
    if (expectedCharacters[index] !== heardCharacters[index]) {
      return {
        position: index + 1,
        expected: expectedCharacters[index] || "koniec wypowiedzi",
        heard: heardCharacters[index] || "brak"
      };
    }
  }

  return null;
}

function checkSentencePronunciation(example, index) {
  const Recognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const status = $(`#sentenceStatus${index}`);

  if (!Recognition) {
    status.textContent =
      "Rozpoznawanie mowy nie jest dostępne w tej przeglądarce. Spróbuj w Chrome.";
    return;
  }

  const target = expectedSentenceReading(example);

  if (target.missingKanji.length) {
    status.textContent =
      `Najpierw wpisz furiganę osobno przy kanji: ${target.missingKanji.join("、")}.`;
    return;
  }

  const recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  status.textContent = "Słucham przez mikrofon — przeczytaj zdanie na głos.";

  recognition.onresult = event => {
    const heardRaw = event.results[0][0].transcript || "";
    const heard = normalizeSpeechText(heardRaw);
    const sentence = normalizeSpeechText(example.sentence);
    const reading = normalizeSpeechText(target.reading);

    if (heard === sentence || heard === reading) {
      status.textContent =
        `Dobrze! Rozpoznany tekst „${heardRaw}” zgadza się ze zdaniem.`;
      return;
    }

    const resultContainsKanji = Array.from(heardRaw).some(isKanji);
    const expected = resultContainsKanji ? sentence : reading;
    const difference = firstDifference(expected, heard);

    if (difference) {
      const expectedDescription = resultContainsKanji
        ? `zdania „${example.sentence}”`
        : `odczytu „${target.reading}”`;

      status.textContent =
        `Rozpoznano „${heardRaw}”, a oczekiwano ${expectedDescription}. ` +
        `Pierwsza różnica: pozycja ${difference.position}; ` +
        `oczekiwano „${difference.expected}”, rozpoznano „${difference.heard}”. ` +
        "Sprawdź ten fragment i spróbuj ponownie.";
    } else {
      status.textContent =
        `Rozpoznano „${heardRaw}”, ale wynik różni się od oczekiwanego. ` +
        `Odczyt z furigany: „${target.reading}”. Spróbuj powiedzieć całe zdanie wyraźniej.`;
    }
  };

  recognition.onerror = event => {
    status.textContent =
      `Nie udało się rozpoznać mowy (${event.error}). ` +
      "Sprawdź mikrofon i uprawnienia przeglądarki.";
  };

  recognition.onend = () => {
    if (status.textContent.startsWith("Słucham")) {
      status.textContent = "Nie rozpoznano wypowiedzi. Spróbuj ponownie.";
    }
  };

  try {
    recognition.start();
  } catch {
    status.textContent =
      "Nie można uruchomić mikrofonu. Sprawdź uprawnienia przeglądarki.";
  }
}

function renderDaily() {
  $("#dailyDate").textContent = new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date());

  const pool = getFilteredRecords();

  if (!pool.length) {
    $("#dailyContent").innerHTML =
      '<p class="muted">Brak kanji w aktualnym filtrze.</p>';
    return;
  }

  const now = new Date();
  const dateKey = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");

  const filterKey = `${$("#level").value}|${$("#grade").value}`;
  let seed = 0;

  for (const character of `${dateKey}|${filterKey}`) {
    seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  }

  const item = pool[seed % pool.length];
  const doneKey = `${dateKey}|${filterKey}`;
  const done = readStorage(DAILY_KEY, {})[doneKey] === item.character;

  $("#dailyContent").innerHTML = `
    <div class="daily-content">
      <div class="daily-kanji">
        ${renderFurigana(item.character, item.characterFurigana)}
      </div>
      <div>
        <h3>${displayTranslation(item.meanings.pl, item.meanings.en)}</h3>
        <div class="actions">
          <button type="button" id="openDaily" class="button">Otwórz kartę</button>
          <button
            type="button"
            id="markDaily"
            class="button secondary"
            ${done ? "disabled" : ""}
          >
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
    daily[doneKey] = item.character;
    store(DAILY_KEY, daily);
    renderDaily();
  });
}

function renderFuriganaEditor(container, text, sourceSegments = []) {
  const characters = textCharacters(text);
  const segments = normalizeFurigana(text, sourceSegments);
  container.replaceChildren();

  const kanjiIndexes = characters
    .map((character, index) => isKanji(character) ? index : -1)
    .filter(index => index >= 0);

  if (!kanjiIndexes.length) {
    const hint = document.createElement("p");
    hint.className = "furigana-hint muted";
    hint.textContent =
      "Wpisz tekst zawierający kanji, aby dodać pola furigany.";
    container.appendChild(hint);
    return;
  }

  kanjiIndexes.forEach(index => {
    const wrapper = document.createElement("label");
    wrapper.className = "furigana-item";

    const characterLabel = document.createElement("span");
    characterLabel.className = "kanji-label";
    characterLabel.textContent = characters[index];

    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = "odczyt";
    input.value = segments[index]?.reading || "";
    input.dataset.index = String(index);
    input.setAttribute(
      "aria-label",
      `Furigana dla znaku ${characters[index]}`
    );

    wrapper.append(characterLabel, input);
    container.appendChild(wrapper);
  });

  const hint = document.createElement("p");
  hint.className = "furigana-hint muted";
  hint.textContent =
    "Wpisz odczyt osobno przy każdym kanji. Kana nie ma pola furigany.";
  container.appendChild(hint);
}

function collectFurigana(text, container) {
  const characters = textCharacters(text);
  const result = characters.map(character => ({
    text: character,
    reading: ""
  }));

  container.querySelectorAll("input[data-index]").forEach(input => {
    const index = Number(input.dataset.index);

    if (result[index] && isKanji(result[index].text)) {
      result[index].reading = input.value.trim();
    }
  });

  return result;
}

function addExampleEditor(example = {}) {
  const row = document.createElement("article");
  row.className = "example-editor";

  row.innerHTML = `
    <div class="example-editor-grid">
      <label>
        Słowo po japońsku
        <input data-field="word" value="${escapeHTML(example.word || "")}">
      </label>

      <label>
        Znaczenie słowa — polski
        <input
          data-field="wordPL"
          value="${escapeHTML(example.wordMeaning?.pl || "")}"
        >
      </label>

      <label>
        Znaczenie słowa — angielski
        <input
          data-field="wordEN"
          value="${escapeHTML(example.wordMeaning?.en || "")}"
        >
      </label>

      <label>
        Zdanie po japońsku
        <textarea data-field="sentence">${escapeHTML(example.sentence || "")}</textarea>
      </label>

      <label>
        Znaczenie zdania — polski
        <textarea data-field="sentencePL">${escapeHTML(
          example.sentenceMeaning?.pl || ""
        )}</textarea>
      </label>

      <label>
        Znaczenie zdania — angielski
        <textarea data-field="sentenceEN">${escapeHTML(
          example.sentenceMeaning?.en || ""
        )}</textarea>
      </label>
    </div>

    <section class="furigana-section">
      <h3>Furigana słowa — osobno przy każdym kanji</h3>
      <div class="furigana-editor" data-furigana="word"></div>
    </section>

    <section class="furigana-section">
      <h3>Furigana zdania — osobno przy każdym kanji</h3>
      <div class="furigana-editor" data-furigana="sentence"></div>
    </section>

    <button type="button" class="button secondary remove-example">
      Usuń przykład
    </button>
  `;

  const wordInput = row.querySelector('[data-field="word"]');
  const sentenceInput = row.querySelector('[data-field="sentence"]');
  const wordEditor = row.querySelector('[data-furigana="word"]');
  const sentenceEditor = row.querySelector('[data-furigana="sentence"]');

  renderFuriganaEditor(
    wordEditor,
    example.word || "",
    example.wordFurigana || []
  );

  renderFuriganaEditor(
    sentenceEditor,
    example.sentence || "",
    example.sentenceFurigana || []
  );

  wordInput.addEventListener("input", () => {
    const oldText = wordInput.dataset.previousText || "";
    const oldSegments = collectFurigana(oldText, wordEditor);
    const migrated = migrateFurigana(oldText, wordInput.value, oldSegments);

    renderFuriganaEditor(wordEditor, wordInput.value, migrated);
    wordInput.dataset.previousText = wordInput.value;
  });

  sentenceInput.addEventListener("input", () => {
    const oldText = sentenceInput.dataset.previousText || "";
    const oldSegments = collectFurigana(oldText, sentenceEditor);
    const migrated = migrateFurigana(
      oldText,
      sentenceInput.value,
      oldSegments
    );

    renderFuriganaEditor(sentenceEditor, sentenceInput.value, migrated);
    sentenceInput.dataset.previousText = sentenceInput.value;
  });

  wordInput.dataset.previousText = wordInput.value;
  sentenceInput.dataset.previousText = sentenceInput.value;

  row.querySelector(".remove-example").addEventListener("click", () => {
    row.remove();
  });

  $("#examples").appendChild(row);
}

function openEditor(character = "") {
  const item = records.find(record => record.character === character);

  $("#kanjiForm").reset();
  $("#examples").replaceChildren();

  $("#originalCharacter").value = item?.character || "";
  $("#character").value = item?.character || "";
  $("#gradeInput").value = item?.grade || "";
  $("#stageInput").value = item?.schoolStage || "";
  $("#jlptInput").value = item?.jlpt || "";
  $("#strokesInput").value = item?.strokes || "";
  $("#meaningPL").value = item?.meanings?.pl || "";
  $("#meaningEN").value = item?.meanings?.en || "";
  $("#onyomiInput").value = (item?.onyomi || []).join(", ");
  $("#kunyomiInput").value = (item?.kunyomi || []).join(", ");

  const characterEditor = $("#characterFuriganaEditor");
  renderFuriganaEditor(
    characterEditor,
    item?.character || "",
    item?.characterFurigana || []
  );

  $("#character").oninput = () => {
    const oldText = $("#character").dataset.previousText || "";
    const oldSegments = collectFurigana(oldText, characterEditor);
    const migrated = migrateFurigana(
      oldText,
      $("#character").value,
      oldSegments
    );

    renderFuriganaEditor(
      characterEditor,
      $("#character").value,
      migrated
    );

    $("#character").dataset.previousText = $("#character").value;
  };

  $("#character").dataset.previousText = $("#character").value;

  const knownFields = new Set([
    "character",
    "characterFurigana",
    "characterReading",
    "grade",
    "schoolStage",
    "jlpt",
    "level",
    "strokes",
    "meanings",
    "onyomi",
    "kunyomi",
    "examples",
    "words"
  ]);

  const extras = Object.fromEntries(
    Object.entries(item || {}).filter(([key]) => !knownFields.has(key))
  );

  $("#extraFields").value = Object.keys(extras).length
    ? JSON.stringify(extras, null, 2)
    : "";

  $("#formTitle").textContent = item
    ? `Edytuj kanji ${item.character}`
    : "Dodaj kanji";

  (item?.examples || []).forEach(addExampleEditor);
  if (!item) addExampleEditor();

  showTab("manage");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function saveEditor(event) {
  event.preventDefault();

  const character = $("#character").value.trim();
  if (!character) return;

  let extraFields = {};

  if ($("#extraFields").value.trim()) {
    try {
      extraFields = JSON.parse($("#extraFields").value);

      if (!extraFields ||
          Array.isArray(extraFields) ||
          typeof extraFields !== "object") {
        throw new Error("Dodatkowe pola muszą być obiektem JSON.");
      }
    } catch (error) {
      alert(`Nieprawidłowy JSON w polu dodatkowych danych: ${error.message}`);
      return;
    }
  }

  const characterFurigana = collectFurigana(
    character,
    $("#characterFuriganaEditor")
  );

  const examples = 
$$(".example-editor").map(row => {
    const get = field =>
      row.querySelector(`[data-field="${field}"]`).value.trim();

    const word = get("word");
    const sentence = get("sentence");

    return {
      word,
      wordFurigana: collectFurigana(
        word,
        row.querySelector('[data-furigana="word"]')
      ),
      wordMeaning: {
        pl: get("wordPL"),
        en: get("wordEN")
      },
      sentence,
      sentenceFurigana: collectFurigana(
        sentence,
        row.querySelector('[data-furigana="sentence"]')
      ),
      sentenceMeaning: {
        pl: get("sentencePL"),
        en: get("sentenceEN")
      }
    };
  }).filter(example =>
    example.word ||
    example.sentence ||
    example.wordMeaning.pl ||
    example.wordMeaning.en ||
    example.sentenceMeaning.pl ||
    example.sentenceMeaning.en
  );

  const originalCharacter = $("#originalCharacter").value;
  const previous = records.find(record =>
    record.character === originalCharacter ||
    record.character === character
  ) || {};

  const record = normalizeRecord({
    ...previous,
    ...extraFields,
    character,
    characterFurigana,
    grade: $("#gradeInput").value
      ? Number($("#gradeInput").value)
      : null,
    schoolStage: $("#stageInput").value,
    jlpt: $("#jlptInput").value,
    strokes: $("#strokesInput").value
      ? Number($("#strokesInput").value)
      : null,
    meanings: {
      pl: $("#meaningPL").value.trim(),
      en: $("#meaningEN").value.trim()
    },
    onyomi: $("#onyomiInput").value
      .split(/[,;،]/)
      .map(value => value.trim())
      .filter(Boolean),
    kunyomi: $("#kunyomiInput").value
      .split(/[,;،]/)
      .map(value => value.trim())
      .filter(Boolean),
    examples
  });

  if (originalCharacter && originalCharacter !== character) {
    records = records.filter(item => item.character !== originalCharacter);
  }

  const existingIndex = records.findIndex(
    item => item.character === character
  );

  if (existingIndex >= 0) {
    records[existingIndex] = record;
  } else {
    records.push(record);
  }

  selectedCharacter = character;
  saveLocalDraft();
  renderAll();
  renderDetail(character);

  $("#status").textContent =
    "Zapisano lokalnie. Pobierz JSON, aby wgrać zmiany na GitHub.";
  $("#dataMessage").textContent =
    "Zapisano kanji, furiganę oraz przykłady w lokalnym szkicu.";

  showTab("learn");
}

function exportJSON(download = true) {
  const data = {
    version: 2,
    source: "Kanji Path",
    kanji: records
  };

  const text = JSON.stringify(data, null, 2);

  if (!download) return text;

  const blob = new Blob([text], {
    type: "application/json;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "data.json";

  document.body.appendChild(link);
  link.click();
  link.remove();

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

    const imported = incoming
      .map(normalizeRecord)
      .filter(item => item.character);

    if (!imported.length) {
      throw new Error("Nie znaleziono rekordów kanji.");
    }

    if ($("#importMode").value === "replace") {
      records = imported;
    } else {
      const byCharacter = new Map(
        records.map(item => [item.character, item])
      );

      imported.forEach(item => byCharacter.set(item.character, item));
      records = [...byCharacter.values()];
    }

    selectedCharacter = "";
    saveLocalDraft();
    renderAll();

    $("#detail").innerHTML =
      '<p class="muted">Wybierz znak z listy.</p>';
    $("#dataMessage").textContent =
      `Zaimportowano ${imported.length} rekordów.`;
  } catch (error) {
    $("#dataMessage").textContent =
      `Import nie powiódł się: ${error.message}`;
  } finally {
    $("#importFile").value = "";
  }
}

function startQuiz() {
  const pool = getFilteredRecords().filter(
    item => item.meanings?.pl || item.meanings?.en
  );

  if (pool.length < 2) {
    $("#quizContent").innerHTML =
      '<p class="muted">Quiz wymaga co najmniej dwóch kanji ze znaczeniami.</p>';
    return;
  }

  const question = pool[Math.floor(Math.random() * pool.length)];

  const choices = [
    question,
    ...pool
      .filter(item => item.character !== question.character)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
  ].sort(() => Math.random() - 0.5);

  $("#quizContent").innerHTML = `
    <p>Wybierz znaczenie znaku:</p>
    <div class="bigkanji">
      ${renderFurigana(
        question.character,
        question.characterFurigana
      )}
    </div>
    <div class="quiz-choices">
      ${choices.map(item => `
        <button
          class="button quiz-choice"
          data-answer="${escapeHTML(item.character)}"
          type="button"
        >
          ${displayTranslation(item.meanings.pl, item.meanings.en)}
        </button>
      `).join("")}
    </div>
    <p id="quizFeedback" class="quiz-feedback" aria-live="polite"></p>
  `;

  $$("#quizContent [data-answer]").forEach(button => {
    button.addEventListener("click", () => {
      $("#quizFeedback").textContent =
        button.dataset.answer === question.character
          ? "Dobrze!"
          : `Nie tym razem. Poprawne kanji: ${question.character}`;
    });
  });
}

$("#kanjiForm").addEventListener("submit", saveEditor);
$("#addExample").addEventListener("click", () => addExampleEditor());
$("#newEntry").addEventListener("click", () => openEditor(""));
$("#startQuiz").addEventListener("click", startQuiz);
$("#exportFile").addEventListener("click", () => exportJSON(true));

$("#importFile").addEventListener("change", event => {
  importJSON(event.target.files?.[0]);
});

$("#copyJson").addEventListener("click", async () => {
  const text = exportJSON(false);

  try {
    await navigator.clipboard.writeText(text);
    $("#status").textContent = "JSON skopiowany do schowka.";
  } catch {
    exportJSON(true);
    $("#status").textContent =
      "Nie można skopiować — pobrano plik JSON.";
  }
});

$("#refresh").addEventListener("click", () => {
  if (
    readStorage(DRAFT_KEY, null) &&
    !confirm("Odświeżenie usunie lokalny szkic i wczyta data.json. Kontynuować?")
  ) {
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
$("#level").addEventListener("change", renderAll);
$("#grade").addEventListener("change", renderAll);

$("#clear").addEventListener("click", () => {
  $("#search").value = "";
  $("#level").value = "all";
  $("#grade").value = "all";
  renderAll();
});

$$(".tab").forEach(button => {
  button.addEventListener("click", () => {
    showTab(button.dataset.tab);

    if (button.dataset.tab === "quiz") {
      startQuiz();
    }
  });
});

loadJSON();
