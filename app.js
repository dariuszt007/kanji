"use strict";

const DATA_URL = "./data.json";
const SETTINGS_KEY = "kanjipath.settings.v6";
const DAILY_KEY = "kanjipath.daily.v6";
const DRAFT_KEY = "kanjipath.local-draft.v4";
const MASTERED_KEY = "kanjipath.mastered.v1";

const $ = selector => document.querySelector(selector);
const 
$$ = selector => [...document.querySelectorAll(selector)];

let records = [];
let selectedCharacter = "";
let flashcardCharacter = "";
let flashcardRevealed = false;
let flashcardOrder = [];
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
  const segments = Array.isArray(source) ? source : [];

  return characters.map((character, index) => {
    const saved = segments[index];

    return {
      text: character,
      reading: isKanji(character) && saved?.text === character
        ? String(saved.reading || "")
        : ""
    };
  });
}

function migrateFurigana(oldText, newText, oldSegments) {
  const oldCharacters = textCharacters(oldText);
  const newCharacters = textCharacters(newText);
  const oldNormalized = normalizeFurigana(oldText, oldSegments);
  const usedIndexes = new Set();

  return newCharacters.map((character, newIndex) => {
    if (!isKanji(character)) {
      return { text: character, reading: "" };
    }

    let matchIndex = -1;

    if (oldCharacters[newIndex] === character && !usedIndexes.has(newIndex)) {
      matchIndex = newIndex;
    } else {
      matchIndex = oldCharacters.findIndex((oldCharacter, index) =>
        oldCharacter === character &&
        isKanji(oldCharacter) &&
        !usedIndexes.has(index)
      );
    }

    if (matchIndex < 0) {
      return { text: character, reading: "" };
    }

    usedIndexes.add(matchIndex);

    return {
      text: character,
      reading: oldNormalized[matchIndex]?.reading || ""
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
    characterFurigana: normalizeFurigana(character, characterFurigana),
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
  store(DRAFT_KEY, { version: 4, kanji: records });
}

function setDataMessage(message) {
  $("#dataMessage").textContent = message;
}

function getMastered() {
  const value = readStorage(MASTERED_KEY, []);
  return new Set(Array.isArray(value) ? value : []);
}

function saveMastered(set) {
  store(MASTERED_KEY, [...set]);
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
  return normalizeFurigana(text, segments).map(part => {
    const character = escapeHTML(part.text);
    const reading = escapeHTML(part.reading);

    if (isKanji(part.text) && reading) {
      return `<ruby>${character}<rt>${reading}</rt></ruby>`;
    }

    return character;
  }).join("");
}

function showTab(id) {
  $$(".view").forEach(view => {
    view.classList.toggle("hidden", view.id !== id);
  });

  $$(".tab").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === id);
  });

  if (id === "flashcards") {
    refreshFlashcards();
  }
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

  refreshFlashcards();
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
          >Odsłuchaj zdanie</button>
          <button
            type="button"
            class="button secondary"
            data-check-sentence="${index}"
          >Nagraj i sprawdź wymowę</button>
          <button
            type="button"
            class="button secondary"
            data-edit-sentence="${index}"
          >Edytuj to zdanie</button>
        </div>
        <p id="sentenceStatus${index}" class="sentence-status" aria-live="polite"></p>
        <div id="sentenceEditor${index}" class="hidden"></div>
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
        <button type="button" id="clearCanvas" class="button secondary">Wyczyść</button>
        <button type="button" id="showKanji" class="button secondary">Pokaż wzór pisma</button>
      </div>
      <p id="practiceMessage" class="status" aria-live="polite"></p>
    </section>
  `;

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

  $$("[data-edit-sentence]").forEach(button => {\\     button.addEventListener("click", () => {\\       const index = Number(button.dataset.editSentence);\\       openSingleSentenceEditor(item, index);\\     });\\   });\\ \\   setupPracticeTools(item);\\ }\\ \\ function createLabel(text, control) {\\   const label = document.createElement("label");\\   label.append(document.createTextNode(text), control);\\   return label;\\ }\\ \\ function openSingleSentenceEditor(item, index) {\\   const example = item.examples[index];\\   const container = $(`#sentenceEditor${index}`);\\   if (!example || !container) return;\\ \\   if (!container.classList.contains("hidden")) {\\     container.classList.add("hidden");\\     container.replaceChildren();\\     return;\\   }\\ \\   container.className = "inline-sentence-editor";\\   container.replaceChildren();\\ \\   const sentenceInput = document.createElement("textarea");\\   sentenceInput.value = example.sentence || "";\\   sentenceInput.dataset.previousText = sentenceInput.value;\\ \\   const furiganaEditor = document.createElement("div");\\   furiganaEditor.className = "furigana-editor";\\ \\   renderFuriganaEditor(\\     furiganaEditor,\\     sentenceInput.value,\\     example.sentenceFurigana\\   );\\ \\   sentenceInput.addEventListener("input", () => {\\     const oldText = sentenceInput.dataset.previousText || "";\\     const oldSegments = collectFurigana(oldText, furiganaEditor);\\     const migrated = migrateFurigana(\\       oldText,\\       sentenceInput.value,\\       oldSegments\\     );\\ \\     renderFuriganaEditor(furiganaEditor, sentenceInput.value, migrated);\\     sentenceInput.dataset.previousText = sentenceInput.value;\\   });\\ \\   const polishInput = document.createElement("textarea");\\   polishInput.value = example.sentenceMeaning?.pl || "";\\ \\   const englishInput = document.createElement("textarea");\\   englishInput.value = example.sentenceMeaning?.en || "";\\ \\   container.appendChild(\\     createLabel("Tekst zdania po japońsku", sentenceInput)\\   );\\ \\   const furiganaSection = document.createElement("section");\\   furiganaSection.className = "furigana-section";\\ \\   const furiganaHeading = document.createElement("h3");\\   furiganaHeading.textContent =\\     "Furigana — odczyt wpisuje się osobno przy każdym kanji";\\ \\   furiganaSection.append(furiganaHeading, furiganaEditor);\\   container.appendChild(furiganaSection);\\ \\   container.append(\\     createLabel("Tłumaczenie polskie", polishInput),\\     createLabel("Tłumaczenie angielskie", englishInput)\\   );\\ \\   const actions = document.createElement("div");\\   actions.className = "actions";\\ \\   const saveButton = document.createElement("button");\\   saveButton.type = "button";\\   saveButton.className = "button";\\   saveButton.textContent = "Zapisz to zdanie";\\ \\   const cancelButton = document.createElement("button");\\   cancelButton.type = "button";\\   cancelButton.className = "button secondary";\\   cancelButton.textContent = "Anuluj";\\ \\   actions.append(saveButton, cancelButton);\\   container.appendChild(actions);\\ \\   saveButton.addEventListener("click", () => {\\     example.sentence = sentenceInput.value.trim();\\     example.sentenceFurigana = collectFurigana(\\       example.sentence,\\       furiganaEditor\\     );\\     example.sentenceMeaning = {\\       ...example.sentenceMeaning,\\       pl: polishInput.value.trim(),\\       en: englishInput.value.trim()\\     };\\ \\     saveLocalDraft();\\     renderDetail(item.character);\\     $("#status").textContent = "Zapisano zmiany w tym zdaniu lokalnie.";\\   });\\ \\   cancelButton.addEventListener("click", () => {\\     container.className = "hidden";\\     container.replaceChildren();\\   });\\ }\\ \\ function setupPracticeTools(item) {\\   const canvas = $("#writingCanvas");\\   const context = canvas.getContext("2d");\\   let drawing = false;\\ \\   context.lineWidth = 8;\\   context.lineCap = "round";\\   context.lineJoin = "round";\\   context.strokeStyle = "#252b32";\\ \\   function canvasPoint(event) {\\     const rect = canvas.getBoundingClientRect();\\ \\     return {\\       x: (event.clientX - rect.left) * canvas.width / rect.width,\\       y: (event.clientY - rect.top) * canvas.height / rect.height\\     };\\   }\\ \\   canvas.addEventListener("pointerdown", event => {\\     drawing = true;\\     canvas.setPointerCapture(event.pointerId);\\ \\     const point = canvasPoint(event);\\     context.beginPath();\\     context.moveTo(point.x, point.y);\\   });\\ \\   canvas.addEventListener("pointermove", event => {\\     if (!drawing) return;\\ \\     const point = canvasPoint(event);\\     context.lineTo(point.x, point.y);\\     context.stroke();\\   });\\ \\   canvas.addEventListener("pointerup", () => {\\     drawing = false;\\     context.closePath();\\   });\\ \\   canvas.addEventListener("pointercancel", () => {\\     drawing = false;\\   });\\ \\   $("#clearCanvas").addEventListener("click", () => {\\     context.clearRect(0, 0, canvas.width, canvas.height);\\     $("#practiceMessage").textContent = "";\\   });\\ \\   $("#showKanji").addEventListener("click", async () => {\\     context.clearRect(0, 0, canvas.width, canvas.height);\\ \\     if (document.fonts?.load) {\\       try {\\         await document.fonts.load('280px "Klee One"');\\       } catch {\\         // Przy braku fontu przeglądarka użyje fontu zastępczego.\\       }\\     }\\ \\     context.save();\\     context.fillStyle = "#ded8d0";\\     context.font =\\       '280px "Klee One", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';\\     context.textAlign = "center";\\     context.textBaseline = "middle";\\     context.fillText(item.character, canvas.width / 2, canvas.height / 2);\\     context.restore();\\   });\\ }\\ \\ function speakJapanese(text, statusElement) {\\   if (!("speechSynthesis" in window)) {\\     statusElement.textContent =\\       "Odsłuch nie jest obsługiwany przez tę przeglądarkę.";\\     return;\\   }\\ \\   speechSynthesis.cancel();\\ \\   const utterance = new SpeechSynthesisUtterance(text);\\   utterance.lang = "ja-JP";\\   utterance.onerror = () => {\\     statusElement.textContent = "Nie udało się odtworzyć zdania.";\\   };\\ \\   speechSynthesis.speak(utterance);\\ }\\ \\ function katakanaToHiragana(text) {\\   return Array.from(String(text || ""), character => {\\     const code = character.codePointAt(0);\\ \\     return code >= 0x30a1 && code <= 0x30f6\\       ? String.fromCodePoint(code - 0x60)\\       : character;\\   }).join("");\\ }\\ \\ function normalizeSpeechText(text) {\\   return katakanaToHiragana(String(text || ""))\\     .normalize("NFC")\\     .replace(/[\s。、！？,.!?「」『』（）()]/g, "");\\ }\\ \\ function expectedSentenceReading(example) {\\   const segments = normalizeFurigana(\\     example.sentence,\\     example.sentenceFurigana\\   );\\ \\   const missingKanji = [\\     ...new Set(\\       segments\\         .filter(segment => isKanji(segment.text) && !segment.reading.trim())\\         .map(segment => segment.text)\\     )\\   ];\\ \\   if (missingKanji.length) {\\     return { reading: "", missingKanji };\\   }\\ \\   return {\\     reading: segments.map(segment =>\\       isKanji(segment.text) ? segment.reading : segment.text\\     ).join(""),\\     missingKanji: []\\   };\\ }\\ \\ function firstDifference(expected, heard) {\\   const expectedCharacters = Array.from(expected);\\   const heardCharacters = Array.from(heard);\\   const length = Math.max(expectedCharacters.length, heardCharacters.length);\\ \\   for (let index = 0; index < length; index++) {\\     if (expectedCharacters[index] !== heardCharacters[index]) {\\       return {\\         position: index + 1,\\         expected: expectedCharacters[index] || "koniec wypowiedzi",\\         heard: heardCharacters[index] || "brak"\\       };\\     }\\   }\\ \\   return null;\\ }\\ \\ function checkSentencePronunciation(example, index) {\\   const Recognition =\\     window.SpeechRecognition || window.webkitSpeechRecognition;\\   const status = $(`#sentenceStatus${index}`);\\ \\   if (!Recognition) {\\     status.textContent =\\       "Rozpoznawanie mowy nie jest dostępne w tej przeglądarce. Spróbuj w Chrome.";\\     return;\\   }\\ \\   const target = expectedSentenceReading(example);\\ \\   if (target.missingKanji.length) {\\     status.textContent =\\       `Najpierw wpisz furiganę osobno przy kanji: ${target.missingKanji.join("、")}.`;\\     return;\\   }\\ \\   const recognition = new Recognition();\\   recognition.lang = "ja-JP";\\   recognition.interimResults = false;\\   recognition.maxAlternatives = 1;\\ \\   status.textContent =\\     "Słucham przez mikrofon — przeczytaj zdanie na głos.";\\ \\   recognition.onresult = event => {\\     const heardRaw = event.results[0][0].transcript || "";\\     const heard = normalizeSpeechText(heardRaw);\\     const expectedKanji = normalizeSpeechText(example.sentence);\\     const expectedReading = normalizeSpeechText(target.reading);\\ \\     if (heard === expectedKanji || heard === expectedReading) {\\       status.textContent =\\         `Dobrze! Rozpoznany tekst „${heardRaw}” zgadza się ze zdaniem.`;\\       return;\\     }\\ \\     const resultContainsKanji = Array.from(heardRaw).some(isKanji);\\     const expected = resultContainsKanji\\       ? expectedKanji\\       : expectedReading;\\     const difference = firstDifference(expected, heard);\\ \\     if (difference) {\\       const expectedDescription = resultContainsKanji\\         ? `zdania „${example.sentence}”`\\         : `odczytu „${target.reading}”`;\\ \\       status.textContent =\\         `Rozpoznano „${heardRaw}”, a oczekiwano ${expectedDescription}. ` +\\         `Pierwsza różnica: pozycja ${difference.position}; ` +\\         `oczekiwano „${difference.expected}”, rozpoznano „${difference.heard}”. ` +\\         "Sprawdź ten fragment i spróbuj ponownie.";\\     } else {\\       status.textContent =\\         `Rozpoznano „${heardRaw}”, ale tekst różni się od oczekiwanego. ` +\\         `Odczyt z furigany: „${target.reading}”. Spróbuj ponownie.`;\\     }\\   };\\ \\   recognition.onerror = event => {\\     status.textContent =\\       `Nie udało się rozpoznać mowy (${event.error}). ` +\\       "Sprawdź mikrofon i uprawnienia przeglądarki.";\\   };\\ \\   recognition.onend = () => {\\     if (status.textContent.startsWith("Słucham")) {\\       status.textContent = "Nie rozpoznano wypowiedzi. Spróbuj ponownie.";\\     }\\   };\\ \\   try {\\     recognition.start();\\   } catch {\\     status.textContent =\\       "Nie można uruchomić mikrofonu. Sprawdź uprawnienia przeglądarki.";\\   }\\ }\\ \\ function renderDaily() {\\   $("#dailyDate").textContent = new Intl.DateTimeFormat("pl-PL", {\\     weekday: "long",\\     day: "numeric",\\     month: "long"\\   }).format(new Date());\\ \\   const pool = getFilteredRecords();\\ \\   if (!pool.length) {\\     $("#dailyContent").innerHTML =\\       '<p class="muted">Brak kanji w aktualnym filtrze.</p>';\\     return;\\   }\\ \\   const now = new Date();\\   const dateKey = [\\     now.getFullYear(),\\     String(now.getMonth() + 1).padStart(2, "0"),\\     String(now.getDate()).padStart(2, "0")\\   ].join("-");\\ \\   const filterKey = `${$("#level").value}|${$("#grade").value}`;\\   let seed = 0;\\ \\   for (const character of `${dateKey}|${filterKey}`) {\\     seed = (seed * 31 + character.charCodeAt(0)) >>> 0;\\   }\\ \\   const item = pool[seed % pool.length];\\   const doneKey = `${dateKey}|${filterKey}`;\\   const done = readStorage(DAILY_KEY, {})[doneKey] === item.character;\\ \\   $("#dailyContent").innerHTML = `\\     <div class="daily-content">\\       <div class="daily-kanji">\\         ${renderFurigana(item.character, item.characterFurigana)}\\       </div>\\       <div>\\         <h3>${displayTranslation(item.meanings.pl, item.meanings.en)}</h3>\\         <div class="actions">\\           <button type="button" id="openDaily" class="button">Otwórz kartę</button>\\           <button\\             type="button"\\             id="markDaily"\\             class="button secondary"\\             ${done ? "disabled" : ""}\\           >\\             ${done ? "Przerobione dziś" : "Oznacz jako przerobione"}\\           </button>\\         </div>\\       </div>\\     </div>\\   `;\\ \\   $("#openDaily").addEventListener("click", () => {\\     selectedCharacter = item.character;\\     renderList();\\     renderDetail(item.character);\\     $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });\\   });\\ \\   $("#markDaily").addEventListener("click", () => {\\     const daily = readStorage(DAILY_KEY, {});\\     daily[doneKey] = item.character;\\     store(DAILY_KEY, daily);\\     renderDaily();\\   });\\ }\\ \\ function renderFuriganaEditor(container, text, sourceSegments = []) {\\   const characters = textCharacters(text);\\   const segments = normalizeFurigana(text, sourceSegments);\\   container.replaceChildren();\\ \\   const kanjiIndexes = characters\\     .map((character, index) => isKanji(character) ? index : -1)\\     .filter(index => index >= 0);\\ \\   if (!kanjiIndexes.length) {\\     const hint = document.createElement("p");\\     hint.className = "furigana-hint muted";\\     hint.textContent = "Wpisz tekst zawierający kanji, aby dodać pola furigany.";\\     container.appendChild(hint);\\     return;\\   }\\ \\   kanjiIndexes.forEach(index => {\\     const wrapper = document.createElement("label");\\     wrapper.className = "furigana-item";\\ \\     const characterLabel = document.createElement("span");\\     characterLabel.className = "kanji-label";\\     characterLabel.textContent = characters[index];\\ \\     const input = document.createElement("input");\\     input.type = "text";\\     input.autocomplete = "off";\\     input.placeholder = "odczyt";\\     input.value = segments[index]?.reading || "";\\     input.dataset.index = String(index);\\     input.setAttribute(\\       "aria-label",\\       `Furigana dla znaku ${characters[index]}`\\     );\\ \\     wrapper.append(characterLabel, input);\\     container.appendChild(wrapper);\\   });\\ \\   const hint = document.createElement("p");\\   hint.className = "furigana-hint muted";\\   hint.textContent =\\     "Wpisz odczyt osobno przy każdym kanji. Kana nie ma pola furigany.";\\   container.appendChild(hint);\\ }\\ \\ function collectFurigana(text, container) {\\   const characters = textCharacters(text);\\ \\   const result = characters.map(character => ({\\     text: character,\\     reading: ""\\   }));\\ \\   container.querySelectorAll("input[data-index]").forEach(input => {\\     const index = Number(input.dataset.index);\\ \\     if (result[index] && isKanji(result[index].text)) {\\       result[index].reading = input.value.trim();\\     }\\   });\\ \\   return result;\\ }\\ \\ function addExampleEditor(example = {}) {\\   const row = document.createElement("article");\\   row.className = "example-editor";\\ \\   row.innerHTML = `\\     <div class="example-editor-grid">\\       <label>\\         Słowo po japońsku\\         <input data-field="word" value="${escapeHTML(example.word || "")}">\\       </label>\\ \\       <label>\\         Znaczenie słowa — polski\\         <input data-field="wordPL"\\           value="${escapeHTML(example.wordMeaning?.pl || "")}">\\       </label>\\ \\       <label>\\         Znaczenie słowa — angielski\\         <input data-field="wordEN"\\           value="${escapeHTML(example.wordMeaning?.en || "")}">\\       </label>\\ \\       <label>\\         Zdanie po japońsku\\         <textarea data-field="sentence">${escapeHTML(example.sentence || "")}</textarea>\\       </label>\\ \\       <label>\\         Znaczenie zdania — polski\\         <textarea data-field="sentencePL">${escapeHTML(\\           example.sentenceMeaning?.pl || ""\\         )}</textarea>\\       </label>\\ \\       <label>\\         Znaczenie zdania — angielski\\         <textarea data-field="sentenceEN">${escapeHTML(\\           example.sentenceMeaning?.en || ""\\         )}</textarea>\\       </label>\\     </div>\\ \\     <section class="furigana-section">\\       <h3>Furigana słowa — osobno przy każdym kanji</h3>\\       <div class="furigana-editor" data-furigana="word"></div>\\     </section>\\ \\     <section class="furigana-section">\\       <h3>Furigana zdania — osobno przy każdym kanji</h3>\\       <div class="furigana-editor" data-furigana="sentence"></div>\\     </section>\\ \\     <button type="button" class="button secondary remove-example">\\       Usuń przykład\\     </button>\\   `;\\ \\   const wordInput = row.querySelector('[data-field="word"]');\\   const sentenceInput = row.querySelector('[data-field="sentence"]');\\   const wordEditor = row.querySelector('[data-furigana="word"]');\\   const sentenceEditor = row.querySelector('[data-furigana="sentence"]');\\ \\   renderFuriganaEditor(\\     wordEditor,\\     example.word || "",\\     example.wordFurigana || []\\   );\\ \\   renderFuriganaEditor(\\     sentenceEditor,\\     example.sentence || "",\\     example.sentenceFurigana || []\\   );\\ \\   wordInput.dataset.previousText = wordInput.value;\\   sentenceInput.dataset.previousText = sentenceInput.value;\\ \\   wordInput.addEventListener("input", () => {\\     const oldText = wordInput.dataset.previousText || "";\\     const oldSegments = collectFurigana(oldText, wordEditor);\\     const migrated = migrateFurigana(oldText, wordInput.value, oldSegments);\\ \\     renderFuriganaEditor(wordEditor, wordInput.value, migrated);\\     wordInput.dataset.previousText = wordInput.value;\\   });\\ \\   sentenceInput.addEventListener("input", () => {\\     const oldText = sentenceInput.dataset.previousText || "";\\     const oldSegments = collectFurigana(oldText, sentenceEditor);\\     const migrated = migrateFurigana(\\       oldText,\\       sentenceInput.value,\\       oldSegments\\     );\\ \\     renderFuriganaEditor(sentenceEditor, sentenceInput.value, migrated);\\     sentenceInput.dataset.previousText = sentenceInput.value;\\   });\\ \\   row.querySelector(".remove-example").addEventListener("click", () => {\\     row.remove();\\   });\\ \\   $("#examples").appendChild(row);\\ }\\ \\ function resetAddForm() {\\   $("#kanjiForm").reset();\\   $("#originalCharacter").value = "";\\   $("#examples").replaceChildren();\\ \\   renderFuriganaEditor(\\     $("#characterFuriganaEditor"),\\     $("#character").value,\\     []\\   );\\ \\   $("#character").dataset.previousText = $("#character").value;\\   addExampleEditor();\\ }\\ \\ function setupCharacterFuriganaInput() {\\   const input = $("#character");\\   const editor = $("#characterFuriganaEditor");\\ \\   input.addEventListener("input", () => {\\     const oldText = input.dataset.previousText || "";\\     const oldSegments = collectFurigana(oldText, editor);\\     const migrated = migrateFurigana(oldText, input.value, oldSegments);\\ \\     renderFuriganaEditor(editor, input.value, migrated);\\     input.dataset.previousText = input.value;\\   });\\ \\   input.dataset.previousText = input.value;\\ }\\ \\ function saveNewKanji(event) {\\   event.preventDefault();\\ \\   const character = $("#character").value.trim();\\   if (!character) return;\\ \\   if (records.some(item => item.character === character)) {\\     setDataMessage(\\       `Kanji ${character} jest już w bazie. Formularz służy tylko do dodawania nowych wpisów.`\\     );\\     return;\\   }\\ \\   let extraFields = {};\\ \\   if ($("#extraFields").value.trim()) {\\     try {\\       extraFields = JSON.parse($("#extraFields").value);\\ \\       if (\\         !extraFields ||\\         Array.isArray(extraFields) ||\\         typeof extraFields !== "object"\\       ) {\\         throw new Error("Dodatkowe pola muszą być obiektem JSON.");\\       }\\     } catch (error) {\\       setDataMessage(`Nieprawidłowy JSON: ${error.message}`);\\       return;\\     }\\   }\\ \\   const examples = $$(".example-editor").map(row => {
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

  const newRecord = normalizeRecord({
    ...extraFields,
    character,
    characterFurigana: collectFurigana(
      character,
      $("#characterFuriganaEditor")
    ),
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

  records.push(newRecord);
  selectedCharacter = character;
  saveLocalDraft();
  renderAll();

  setDataMessage(`Dodano kanji ${character}.`);
  $("#status").textContent =
    "Nowe kanji zapisano lokalnie. Eksportuj Excel lub skopiuj JSON, aby zachować kopię.";

  resetAddForm();
  showTab("learn");
  renderDetail(character);
}

function exportJSON() {
  return JSON.stringify({
    version: 4,
    source: "Kanji Path",
    kanji: records
  }, null, 2);
}

function parseJSONCell(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;

  try {
    return JSON.parse(String(value)) ?? fallback;
  } catch {
    return fallback;
  }
}

function exportExcel() {
  if (!window.XLSX) {
    setDataMessage(
      "Biblioteka Excel nie została załadowana. Sprawdź połączenie z internetem."
    );
    return;
  }

  const rows = [];

  records.forEach(item => {
    const examples = item.examples.length ? item.examples : [{}];

    examples.forEach(example => {
      rows.push({
        Kanji: item.character,
        "Furigana kanji JSON": JSON.stringify(item.characterFurigana),
        Klasa: item.grade ?? "",
        "Etap szkoły": item.schoolStage || "",
        JLPT: item.jlpt || "",
        Kreski: item.strokes ?? "",
        "Znaczenie PL": item.meanings?.pl || "",
        "Meaning EN": item.meanings?.en || "",
        "Onyomi JSON": JSON.stringify(item.onyomi || []),
        "Kunyomi JSON": JSON.stringify(item.kunyomi || []),
        "Słowo JP": example.word || "",
        "Furigana słowa JSON": JSON.stringify(example.wordFurigana || []),
        "Znaczenie słowa PL": example.wordMeaning?.pl || "",
        "Znaczenie słowa EN": example.wordMeaning?.en || "",
        "Zdanie JP": example.sentence || "",
        "Furigana zdania JSON": JSON.stringify(example.sentenceFurigana || []),
        "Tłumaczenie zdania PL": example.sentenceMeaning?.pl || "",
        "Sentence translation EN": example.sentenceMeaning?.en || "",
        "Dodatkowe pola JSON": JSON.stringify(item.extraFields || {})
      });
    });
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, "Kanji");
  XLSX.writeFile(workbook, "kanjipath.xlsx");

  setDataMessage("Wyeksportowano plik kanjipath.xlsx.");
}

function importExcelRows(rows) {
  const grouped = new Map();

  rows.forEach(row => {
    const character = String(row.Kanji || "").trim();
    if (!character) return;

    if (!grouped.has(character)) {
      const extras = parseJSONCell(row["Dodatkowe pola JSON"], {});

      grouped.set(character, {
        ...extras,
        character,
        characterFurigana: parseJSONCell(
          row["Furigana kanji JSON"],
          []
        ),
        grade: row.Klasa === "" || row.Klasa == null
          ? null
          : Number(row.Klasa),
        schoolStage: String(row["Etap szkoły"] || ""),
        jlpt: String(row.JLPT || ""),
        strokes: row.Kreski === "" || row.Kreski == null
          ? null
          : Number(row.Kreski),
        meanings: {
          pl: String(row["Znaczenie PL"] || ""),
          en: String(row["Meaning EN"] || "")
        },
        onyomi: parseJSONCell(row["Onyomi JSON"], []),
        kunyomi: parseJSONCell(row["Kunyomi JSON"], []),
        examples: []
      });
    }

    const record = grouped.get(character);
    const word = String(row["Słowo JP"] || "");
    const sentence = String(row["Zdanie JP"] || "");

    if (
      word ||
      sentence ||
      row["Znaczenie słowa PL"] ||
      row["Znaczenie słowa EN"] ||
      row["Tłumaczenie zdania PL"] ||
      row["Sentence translation EN"]
    ) {
      record.examples.push({
        word,
        wordFurigana: parseJSONCell(
          row["Furigana słowa JSON"],
          []
        ),
        wordMeaning: {
          pl: String(row["Znaczenie słowa PL"] || ""),
          en: String(row["Znaczenie słowa EN"] || "")
        },
        sentence,
        sentenceFurigana: parseJSONCell(
          row["Furigana zdania JSON"],
          []
        ),
        sentenceMeaning: {
          pl: String(row["Tłumaczenie zdania PL"] || ""),
          en: String(row["Sentence translation EN"] || "")
        }
      });
    }
  });

  return [...grouped.values()].map(normalizeRecord);
}

async function importExcel(file) {
  if (!file) return;

  if (!window.XLSX) {
    setDataMessage(
      "Biblioteka Excel nie została załadowana. Sprawdź połączenie z internetem."
    );
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      throw new Error("W pliku nie znaleziono arkusza.");
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
    const imported = importExcelRows(rows);

    if (!imported.length) {
      throw new Error("Nie znaleziono kanji. Sprawdź nagłówki arkusza.");
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
    $("#detail").innerHTML = '<p class="muted">Wybierz znak z listy.</p>';
    setDataMessage(`Zaimportowano z Excela ${imported.length} kanji.`);
  } catch (error) {
    setDataMessage(`Import Excela nie powiódł się: ${error.message}`);
  } finally {
    $("#excelFile").value = "";
  }
}

/* Fiszki */

function getFlashcardPool() {
  let pool = getFilteredRecords();

  if ($("#hideMastered").checked) {
    const mastered = getMastered();
    pool = pool.filter(item => !mastered.has(item.character));
  }

  return pool;
}

function refreshFlashcards() {
  const pool = getFlashcardPool();
  const characterStillAvailable = pool.some(
    item => item.character === flashcardCharacter
  );

  if (!characterStillAvailable) {
    flashcardCharacter = pool[0]?.character || "";
    flashcardRevealed = false;
  }

  renderFlashcard();
}

function getFlashcardItem() {
  const pool = getFlashcardPool();
  return pool.find(item => item.character === flashcardCharacter) || pool[0] || null;
}

function renderFlashcard() {
  const pool = getFlashcardPool();
  const item = getFlashcardItem();
  const mastered = getMastered();

  if (!item) {
    $("#flashcard").innerHTML = `
      <div class="flashcard-empty">
        ${records.length
          ? "Brak fiszek do wyświetlenia przy obecnych filtrach. Zmień filtry albo pokaż opanowane kanji."
          : "Baza nie zawiera jeszcze kanji."}
      </div>
    `;
    $("#flashcardProgress").textContent = "0 fiszek";
    $("#revealFlashcard").disabled = true;
    $("#previousFlashcard").disabled = true;
    $("#nextFlashcard").disabled = true;
    $("#markMastered").disabled = true;
    $("#shuffleFlashcards").disabled = true;
    return;
  }

  $("#revealFlashcard").disabled = false;
  $("#previousFlashcard").disabled = pool.length < 2;
  $("#nextFlashcard").disabled = pool.length < 2;
  $("#markMastered").disabled = false;
  $("#shuffleFlashcards").disabled = pool.length < 2;

  let index = pool.findIndex(card => card.character === item.character);
  if (index < 0) index = 0;

  $("#flashcardProgress").textContent =
    `Fiszka ${index + 1} z ${pool.length}` +
    (mastered.has(item.character) ? " · opanowana" : "");

  $("#flashcard").innerHTML = `
    <div id="flashcardFront" class="flashcard-front ${flashcardRevealed ? "hidden" : ""}">
      <p class="flashcard-label">KANJI</p>
      <div class="flashcard-kanji">
        ${escapeHTML(item.character)}
      </div>
      <p class="flashcard-prompt">
        Spróbuj przypomnieć sobie furiganę, znaczenie i odczyty.
      </p>
    </div>
    <div id="flashcardBack" class="flashcard-back ${flashcardRevealed ? "" : "hidden"}">
      <p class="flashcard-label">ODPOWIEDŹ</p>
      <div class="flashcard-answer-kanji">
        ${renderFurigana(item.character, item.characterFurigana)}
      </div>
      <p><b>Znaczenie:</b>
        ${displayTranslation(item.meanings.pl, item.meanings.en)}
      </p>
      <p><b>On’yomi:</b> ${escapeHTML(item.onyomi.join("、") || "—")}</p>
      <p><b>Kun’yomi:</b> ${escapeHTML(item.kunyomi.join("、") || "—")}</p>
      ${item.grade ? `<p><b>Klasa:</b> ${escapeHTML(item.grade)}</p>` : ""}
      ${item.jlpt ? `<p><b>JLPT:</b> ${escapeHTML(item.jlpt)}</p>` : ""}
      ${renderFlashcardExamples(item.examples)}
    </div>
  `;

  $("#revealFlashcard").textContent =
    flashcardRevealed ? "Ukryj odpowiedź" : "Pokaż odpowiedź";

  $("#markMastered").textContent = mastered.has(item.character)
    ? "Usuń z opanowanych"
    : "Oznacz jako opanowane";
}

function renderFlashcardExamples(examples) {
  const withExamples = examples.filter(example =>
    example.word || example.sentence
  );

  if (!withExamples.length) return "";

  return `
    <section class="flashcard-examples">
      <h3>Przykłady</h3>
      ${withExamples.slice(0, 3).map(example => `
        <div class="flashcard-example">
          ${example.word
            ? `<p>${renderFurigana(
                example.word,
                example.wordFurigana
              )}</p>`
            : ""}
          ${example.wordMeaning?.pl || example.wordMeaning?.en
            ? `<p>${displayTranslation(
                example.wordMeaning.pl,
                example.wordMeaning.en
              )}</p>`
            : ""}
          ${example.sentence
            ? `<p>${renderFurigana(
                example.sentence,
                example.sentenceFurigana
              )}</p>`
            : ""}
          ${example.sentenceMeaning?.pl || example.sentenceMeaning?.en
            ? `<p>${displayTranslation(
                example.sentenceMeaning.pl,
                example.sentenceMeaning.en
              )}</p>`
            : ""}
        </div>
      `).join("")}
    </section>
  `;
}

function moveFlashcard(direction) {
  const pool = getFlashcardPool();
  if (!pool.length) return;

  let index = pool.findIndex(item => item.character === flashcardCharacter);
  if (index < 0) index = 0;

  index = (index + direction + pool.length) % pool.length;
  flashcardCharacter = pool[index].character;
  flashcardRevealed = false;
  $("#flashcardMessage").textContent = "";
  renderFlashcard();
}

function shuffleFlashcards() {
  const pool = getFlashcardPool();

  for (let index = pool.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[other]] = [pool[other], pool[index]];
  }

  flashcardOrder = pool.map(item => item.character);
  flashcardCharacter = flashcardOrder[0] || "";
  flashcardRevealed = false;
  $("#flashcardMessage").textContent = "Wylosowano nową kolejność fiszek.";
  renderFlashcard();
}

function toggleMastered() {
  const item = getFlashcardItem();
  if (!item) return;

  const mastered = getMastered();

  if (mastered.has(item.character)) {
    mastered.delete(item.character);
    $("#flashcardMessage").textContent =
      `${item.character} usunięto z opanowanych.`;
  } else {
    mastered.add(item.character);
    $("#flashcardMessage").textContent =
      `${item.character} oznaczono jako opanowane.`;
  }

  saveMastered(mastered);
  renderFlashcard();
}

/* Edytor furigany dla nowego kanji i przykładów */

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
    hint.textContent = "Wpisz tekst zawierający kanji, aby dodać pola furigany.";
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
        <input data-field="wordPL"
          value="${escapeHTML(example.wordMeaning?.pl || "")}">
      </label>

      <label>
        Znaczenie słowa — angielski
        <input data-field="wordEN"
          value="${escapeHTML(example.wordMeaning?.en || "")}">
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

  wordInput.dataset.previousText = wordInput.value;
  sentenceInput.dataset.previousText = sentenceInput.value;

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

  row.querySelector(".remove-example").addEventListener("click", () => {
    row.remove();
  });

  $("#examples").appendChild(row);
}

function resetAddForm() {
  $("#kanjiForm").reset();
  $("#examples").replaceChildren();

  renderFuriganaEditor(
    $("#characterFuriganaEditor"),
    $("#character").value,
    []
  );

  $("#character").dataset.previousText = $("#character").value;
  addExampleEditor();
}

function setupCharacterFuriganaInput() {
  const input = $("#character");
  const editor = $("#characterFuriganaEditor");

  input.dataset.previousText = input.value;

  input.addEventListener("input", () => {
    const oldText = input.dataset.previousText || "";
    const oldSegments = collectFurigana(oldText, editor);
    const migrated = migrateFurigana(oldText, input.value, oldSegments);

    renderFuriganaEditor(editor, input.value, migrated);
    input.dataset.previousText = input.value;
  });
}

function saveNewKanji(event) {
  event.preventDefault();

  const character = $("#character").value.trim();
  if (!character) return;

  if (records.some(item => item.character === character)) {
    setDataMessage(
      `Kanji ${character} jest już w bazie. Ta zakładka służy tylko do dodawania nowych wpisów.`
    );
    return;
  }

  let extraFields = {};

  if ($("#extraFields").value.trim()) {
    try {
      extraFields = JSON.parse($("#extraFields").value);

      if (
        !extraFields ||
        Array.isArray(extraFields) ||
        typeof extraFields !== "object"
      ) {
        throw new Error("Dodatkowe pola muszą być obiektem JSON.");
      }
    } catch (error) {
      setDataMessage(`Nieprawidłowy JSON: ${error.message}`);
      return;
    }
  }

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

  const newRecord = normalizeRecord({
    ...extraFields,
    character,
    characterFurigana: collectFurigana(
      character,
      $("#characterFuriganaEditor")
    ),
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

  records.push(newRecord);
  selectedCharacter = character;
  saveLocalDraft();
  renderAll();

  setDataMessage(`Dodano kanji ${character}.`);
  $("#status").textContent =
    "Nowe kanji zapisano lokalnie. Skopiuj JSON lub eksportuj Excel, aby zachować kopię.";

  resetAddForm();
  showTab("learn");
  renderDetail(character);
}

function exportJSON() {
  return JSON.stringify({
    version: 4,
    source: "Kanji Path",
    kanji: records
  }, null, 2);
}

function parseJSONCell(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;

  try {
    return JSON.parse(String(value)) ?? fallback;
  } catch {
    return fallback;
  }
}

function exportExcel() {
  if (!window.XLSX) {
    setDataMessage(
      "Biblioteka Excel nie została załadowana. Sprawdź połączenie z internetem."
    );
    return;
  }

  const rows = [];

  records.forEach(item => {
    const examples = item.examples.length ? item.examples : [{}];

    examples.forEach(example => {
      rows.push({
        Kanji: item.character,
        "Furigana kanji JSON": JSON.stringify(item.characterFurigana),
        Klasa: item.grade ?? "",
        "Etap szkoły": item.schoolStage || "",
        JLPT: item.jlpt || "",
        Kreski: item.strokes ?? "",
        "Znaczenie PL": item.meanings?.pl || "",
        "Meaning EN": item.meanings?.en || "",
        "Onyomi JSON": JSON.stringify(item.onyomi || []),
        "Kunyomi JSON": JSON.stringify(item.kunyomi || []),
        "Słowo JP": example.word || "",
        "Furigana słowa JSON": JSON.stringify(example.wordFurigana || []),
        "Znaczenie słowa PL": example.wordMeaning?.pl || "",
        "Znaczenie słowa EN": example.wordMeaning?.en || "",
        "Zdanie JP": example.sentence || "",
        "Furigana zdania JSON": JSON.stringify(example.sentenceFurigana || []),
        "Tłumaczenie zdania PL": example.sentenceMeaning?.pl || "",
        "Sentence translation EN": example.sentenceMeaning?.en || "",
        "Dodatkowe pola JSON": JSON.stringify(item.extraFields || {})
      });
    });
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, "Kanji");
  XLSX.writeFile(workbook, "kanjipath.xlsx");

  setDataMessage("Wyeksportowano plik kanjipath.xlsx.");
}

function importExcelRows(rows) {
  const grouped = new Map();

  rows.forEach(row => {
    const character = String(row.Kanji || "").trim();
    if (!character) return;

    if (!grouped.has(character)) {
      const extras = parseJSONCell(row["Dodatkowe pola JSON"], {});

      grouped.set(character, {
        ...extras,
        character,
        characterFurigana: parseJSONCell(
          row["Furigana kanji JSON"],
          []
        ),
        grade: row.Klasa === "" || row.Klasa == null
          ? null
          : Number(row.Klasa),
        schoolStage: String(row["Etap szkoły"] || ""),
        jlpt: String(row.JLPT || ""),
        strokes: row.Kreski === "" || row.Kreski == null
          ? null
          : Number(row.Kreski),
        meanings: {
          pl: String(row["Znaczenie PL"] || ""),
          en: String(row["Meaning EN"] || "")
        },
        onyomi: parseJSONCell(row["Onyomi JSON"], []),
        kunyomi: parseJSONCell(row["Kunyomi JSON"], []),
        examples: []
      });
    }

    const record = grouped.get(character);
    const word = String(row["Słowo JP"] || "");
    const sentence = String(row["Zdanie JP"] || "");

    if (
      word ||
      sentence ||
      row["Znaczenie słowa PL"] ||
      row["Znaczenie słowa EN"] ||
      row["Tłumaczenie zdania PL"] ||
      row["Sentence translation EN"]
    ) {
      record.examples.push({
        word,
        wordFurigana: parseJSONCell(
          row["Furigana słowa JSON"],
          []
        ),
        wordMeaning: {
          pl: String(row["Znaczenie słowa PL"] || ""),
          en: String(row["Znaczenie słowa EN"] || "")
        },
        sentence,
        sentenceFurigana: parseJSONCell(
          row["Furigana zdania JSON"],
          []
        ),
        sentenceMeaning: {
          pl: String(row["Tłumaczenie zdania PL"] || ""),
          en: String(row["Sentence translation EN"] || "")
        }
      });
    }
  });

  return [...grouped.values()].map(normalizeRecord);
}

async function importExcel(file) {
  if (!file) return;

  if (!window.XLSX) {
    setDataMessage(
      "Biblioteka Excel nie została załadowana. Sprawdź połączenie z internetem."
    );
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      throw new Error("W pliku nie znaleziono arkusza.");
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
    const imported = importExcelRows(rows);

    if (!imported.length) {
      throw new Error("Nie znaleziono kanji. Sprawdź nagłówki arkusza.");
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
    $("#detail").innerHTML = '<p class="muted">Wybierz znak z listy.</p>';

    setDataMessage(`Zaimportowano z Excela ${imported.length} kanji.`);
  } catch (error) {
    setDataMessage(`Import Excela nie powiódł się: ${error.message}`);
  } finally {
    $("#excelFile").value = "";
  }
}

/* Obsługa przycisków i ustawień */

$("#kanjiForm").addEventListener("submit", saveNewKanji);
$("#addExample").addEventListener("click", () => addExampleEditor());
$("#resetForm").addEventListener("click", resetAddForm);

$("#importExcel").addEventListener("click", () => {
  $("#excelFile").click();
});

$("#excelFile").addEventListener("change", event => {
  importExcel(event.target.files?.[0]);
});

$("#exportExcel").addEventListener("click", exportExcel);

$("#copyJson").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(exportJSON());
    setDataMessage("JSON skopiowany do schowka.");
  } catch {
    setDataMessage(
      "Nie można skopiować JSON-a. Spróbuj użyć eksportu Excela."
    );
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

$("#search").addEventListener("input", () => {
  renderList();
  renderDaily();
  refreshFlashcards();
});

$("#level").addEventListener("change", () => {
  renderAll();
});

$("#grade").addEventListener("change", () => {
  renderAll();
});

$("#clear").addEventListener("click", () => {
  $("#search").value = "";
  $("#level").value = "all";
  $("#grade").value = "all";
  renderAll();
});

$("#hideMastered").addEventListener("change", refreshFlashcards);

$("#revealFlashcard").addEventListener("click", () => {
  flashcardRevealed = !flashcardRevealed;
  renderFlashcard();
});

$("#previousFlashcard").addEventListener("click", () => {
  moveFlashcard(-1);
});

$("#nextFlashcard").addEventListener("click", () => {
  moveFlashcard(1);
});

$("#markMastered").addEventListener("click", toggleMastered);
$("#shuffleFlashcards").addEventListener("click", shuffleFlashcards);

$$(".tab").forEach(button => {
  button.addEventListener("click", () => {
    showTab(button.dataset.tab);
  });
});

setupCharacterFuriganaInput();
renderFuriganaEditor($("#characterFuriganaEditor"), "", []);
addExampleEditor();
loadJSON();
