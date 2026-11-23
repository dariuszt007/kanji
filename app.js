"use strict";

const DATA_URL = "./data.json";
const DRAFT_KEY = "kanjipath.draft.v7";
const SETTINGS_KEY = "kanjipath.settings.v7";
const MASTERED_KEY = "kanjipath.mastered.v1";
const DAILY_KEY = "kanjipath.daily.v1";

const $ = selector => document.querySelector(selector);
const 
$$ = selector => [...document.querySelectorAll(selector)];

let records = [];
let selectedCharacter = "";
let currentFlashcard = "";
let revealed = false;
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
    console.warn("Nie udało się zapisać w localStorage:", error);
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

function chars(text) {
  return Array.from(String(text || ""));
}

function isKanji(character) {
  return /\p{Script=Han}/u.test(character);
}

function normalizeFurigana(text, source) {
  const characters = chars(text);
  const parts = Array.isArray(source) ? source : [];

  return characters.map((character, index) => {
    const saved = parts[index];

    return {
      text: character,
      reading: isKanji(character) && saved?.text === character
        ? String(saved.reading || "")
        : ""
    };
  });
}

function migrateFurigana(oldText, newText, oldParts) {
  const oldChars = chars(oldText);
  const newChars = chars(newText);
  const normalized = normalizeFurigana(oldText, oldParts);
  const used = new Set();

  return newChars.map((character, index) => {
    if (!isKanji(character)) return { text: character, reading: "" };

    let found = oldChars[index] === character && !used.has(index)
      ? index
      : oldChars.findIndex((oldCharacter, oldIndex) =>
          oldCharacter === character &&
          isKanji(oldCharacter) &&
          !used.has(oldIndex)
        );

    if (found < 0) return { text: character, reading: "" };

    used.add(found);
    return { text: character, reading: normalized[found]?.reading || "" };
  });
}

function normalizeRecord(raw) {
  const meaningsSource = raw.meanings || {};
  const meanings = Array.isArray(meaningsSource)
    ? { pl: "", en: meaningsSource.join("; ") }
    : {
        ...meaningsSource,
        pl: meaningsSource.pl || "",
        en: meaningsSource.en || ""
      };

  const sourceExamples = Array.isArray(raw.examples)
    ? raw.examples
    : Array.isArray(raw.words)
      ? raw.words.map(word => typeof word === "string" ? { word } : word)
      : [];

  const character = String(raw.character || "").trim();
  let characterFurigana = raw.characterFurigana;

  if (
    !Array.isArray(characterFurigana) &&
    chars(character).length === 1 &&
    isKanji(character) &&
    raw.characterReading
  ) {
    characterFurigana = [{ text: character, reading: raw.characterReading }];
  }

  return {
    ...raw,
    character,
    characterFurigana: normalizeFurigana(character, characterFurigana),
    grade: raw.grade ?? "",
    schoolStage: raw.schoolStage || "",
    jlpt: raw.jlpt || raw.level || "",
    strokes: raw.strokes ?? "",
    meanings,
    onyomi: Array.isArray(raw.onyomi) ? raw.onyomi : [],
    kunyomi: Array.isArray(raw.kunyomi) ? raw.kunyomi : [],
    examples: sourceExamples.map(example => ({
      ...example,
      word: String(example.word || ""),
      wordFurigana: normalizeFurigana(
        String(example.word || ""),
        example.wordFurigana
      ),
      wordMeaning: {
        ...(example.wordMeaning || {}),
        pl: example.wordMeaning?.pl || "",
        en: example.wordMeaning?.en ||
          (Array.isArray(example.meanings) ? example.meanings.join("; ") : "")
      },
      sentence: String(example.sentence || example.ja || ""),
      sentenceFurigana: normalizeFurigana(
        String(example.sentence || example.ja || ""),
        example.sentenceFurigana
      ),
      sentenceMeaning: {
        ...(example.sentenceMeaning || {}),
        pl: example.sentenceMeaning?.pl || "",
        en: example.sentenceMeaning?.en || example.en || ""
      }
    }))
  };
}

function setStatus(text) {
  $("#status").textContent = text;
}

function setMessage(text) {
  $("#dataMessage").textContent = text;
}

function saveDraft() {
  store(DRAFT_KEY, { version: 7, kanji: records });
}

function translation(pl, en) {
  const polish = String(pl || "").trim();
  const english = String(en || "").trim();

  if (settings.language === "en") {
    return escapeHTML(english || polish || "Translation unavailable");
  }

  if (settings.language === "both" && polish && english) {
    return `${escapeHTML(polish)} <span class="muted">/</span> ${escapeHTML(english)}`;
  }

  return escapeHTML(
    settings.language === "both"
      ? polish || english || "Brak tłumaczenia / Translation unavailable"
      : polish || english || "Brak tłumaczenia"
  );
}

function rubyText(text, furigana) {
  return normalizeFurigana(text, furigana).map(part => {
    const character = escapeHTML(part.text);
    const reading = escapeHTML(part.reading);
    return isKanji(part.text) && reading
      ? `<ruby>${character}<rt>${reading}</rt></ruby>`
      : character;
  }).join("");
}

function showTab(id) {
  $$(".view").forEach(section => {
    section.classList.toggle("hidden", section.id !== id);
  });

  $$(".tab").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === id);
  });

  if (id === "flashcards") renderFlashcard();
}

async function loadData(useDraft = true) {
  setStatus("Wczytuję data.json…");

  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) throw new Error(`Serwer zwrócił HTTP ${response.status}`);

    const data = await response.json();
    const fileRecords = Array.isArray(data) ? data : data.kanji;

    if (!Array.isArray(fileRecords)) {
      throw new Error('Plik JSON powinien zawierać tablicę "kanji".');
    }

    const draft = useDraft ? readStorage(DRAFT_KEY, null) : null;
    const source = Array.isArray(draft?.kanji) ? draft.kanji : fileRecords;

    records = source.map(normalizeRecord).filter(item => item.character);
    setStatus(`Wczytano ${records.length} kanji.`);
    renderAll();
  } catch (error) {
    const draft = useDraft ? readStorage(DRAFT_KEY, null) : null;

    if (Array.isArray(draft?.kanji)) {
      records = draft.kanji.map(normalizeRecord).filter(item => item.character);
      setStatus(`Nie wczytano data.json; pokazuję lokalny szkic (${records.length} kanji).`);
      setMessage("Sprawdź, czy data.json znajduje się obok index.html.");
      renderAll();
      return;
    }

    records = [];
    setStatus("Nie wczytano data.json.");
    setMessage(`${error.message} Przyciski działają, ale baza jest pusta.`);
    renderAll();
  }
}

function filteredRecords() {
  const query = $("#search").value.trim().toLowerCase();
  const level = $("#level").value;
  const grade = $("#grade").value;

  return records.filter(item => {
    if (level !== "all" && item.jlpt !== level) return false;
    if (grade !== "all" && String(item.grade) !== grade) return false;

    const exampleParts = item.examples.flatMap(example => [
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
      ...exampleParts
    ].join(" ").toLowerCase();

    return !query || searchable.includes(query);
  }).sort((a, b) => a.character.localeCompare(b.character));
}

function renderAll() {
  renderList();
  renderDaily();
  renderFlashcard();
  if (selectedCharacter) renderDetail(selectedCharacter);
}

function renderList() {
  const all = filteredRecords();
  const shown = all.slice(0, 300);

  $("#count").textContent = `${all.length} wyników`;
  $("#listHint").textContent = all.length > shown.length
    ? `Pokazuję pierwsze ${shown.length}; wpisz wyszukiwanie, aby zawęzić listę.`
    : "";

  $("#cards").innerHTML = shown.length
    ? shown.map(item => `
      <button
        type="button"
        class="tile ${item.character === selectedCharacter ? "selected" : ""}"
        data-character="${escapeHTML(item.character)}"
      >
        <span class="glyph">${rubyText(item.character, item.characterFurigana)}</span>
        <small>${translation(item.meanings.pl, item.meanings.en)}</small>
      </button>
    `).join("")
    : '<p class="muted">Brak kanji do wyświetlenia. Sprawdź data.json albo dodaj nowy znak.</p>';

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

  const examples = item.examples.map((example, index) => `
    <article class="example">
      ${example.word
        ? `<h3>${rubyText(example.word, example.wordFurigana)}</h3>`
        : ""}
      ${example.wordMeaning?.pl || example.wordMeaning?.en
        ? `<p>${translation(example.wordMeaning.pl, example.wordMeaning.en)}</p>`
        : ""}
      ${example.sentence
        ? `<div class="example-ja">${rubyText(
            example.sentence,
            example.sentenceFurigana
          )}</div>`
        : ""}
      ${example.sentenceMeaning?.pl
        ? `<p><b>PL:</b> ${escapeHTML(example.sentenceMeaning.pl)}</p>`
        : ""}
      ${example.sentenceMeaning?.en
        ? `<p><b>EN:</b> ${escapeHTML(example.sentenceMeaning.en)}</p>`
        : ""}
      ${example.sentence ? `
        <div class="sentence-actions">
          <button class="button secondary" type="button" data-speak="${index}">
            Odsłuchaj zdanie
          </button>
          <button class="button secondary" type="button" data-recognize="${index}">
            Nagraj i sprawdź wymowę
          </button>
          <button class="button secondary" type="button" data-edit-sentence="${index}">
            Edytuj to zdanie
          </button>
        </div>
        <p class="sentence-status" id="sentenceStatus${index}" aria-live="polite"></p>
        <div id="sentenceEditor${index}" class="hidden"></div>
      ` : ""}
    </article>
  `).join("");

  $("#detail").innerHTML = `
    <div class="hero">
      <div class="bigkanji">${rubyText(item.character, item.characterFurigana)}</div>
      <div>
        <h2>${escapeHTML(item.character)}</h2>
        <p>${translation(item.meanings.pl, item.meanings.en)}</p>
        ${item.jlpt ? `<span class="tag">JLPT ${escapeHTML(item.jlpt)}</span>` : ""}
        ${item.grade ? `<span class="tag">Klasa ${escapeHTML(item.grade)}</span>` : ""}
        ${item.strokes ? `<span class="tag">${escapeHTML(item.strokes)} kresek</span>` : ""}
      </div>
    </div>

    <div class="example">
      <h3>Odczyty</h3>
      <p><b>On’yomi:</b> ${escapeHTML(item.onyomi.join("、") || "—")}</p>
      <p><b>Kun’yomi:</b> ${escapeHTML(item.kunyomi.join("、") || "—")}</p>
      <button id="editKanjiButton" class="button" type="button">Edytuj kanji</button>
    </div>

    <div class="example">
      <h3>Słowa i zdania</h3>
      ${examples || '<p class="muted">Brak przykładów.</p>'}
    </div>

    <section class="practice-tools">
      <h3>Ćwiczenie pisania</h3>
      <p class="muted">Rysuj palcem lub myszą. Wzór używa fontu Klee One.</p>
      <canvas id="writingCanvas" width="640" height="440"></canvas>
      <div class="actions">
        <button id="clearCanvas" class="button secondary" type="button">Wyczyść</button>
        <button id="showKanji" class="button secondary" type="button">Pokaż wzór</button>
      </div>
      <p id="practiceMessage" class="status" aria-live="polite"></p>
    </section>
  `;

  $("#editKanjiButton").addEventListener("click", () => {
    setMessage("Dodawanie nie edytuje istniejących wpisów. Zmień dane w data.json lub zaimportuj poprawioną bazę.");
  });

  $$("[data-speak]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.speak);
      const status = $(`#sentenceStatus${index}`);
      speakJapanese(item.examples[index]?.sentence, status);
    });
  });

  $$("[data-recognize]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.recognize);
      checkSentence(item.examples[index], index);
    });
  });

  $$("[data-edit-sentence]").forEach(button => {\\     button.addEventListener("click", () => {\\       openSentenceEditor(item, Number(button.dataset.editSentence));\\     });\\   });\\ \\   setupWriting(item);\\ }\\ \\ function openSentenceEditor(record, index) {\\   const example = record.examples[index];\\   const box = $(`#sentenceEditor${index}`);\\   if (!example || !box) return;\\ \\   if (!box.classList.contains("hidden")) {\\     box.className = "hidden";\\     box.replaceChildren();\\     return;\\   }\\ \\   box.className = "inline-sentence-editor";\\   box.replaceChildren();\\ \\   const sentenceInput = document.createElement("textarea");\\   sentenceInput.value = example.sentence;\\   sentenceInput.dataset.previousText = example.sentence;\\ \\   const furigana = document.createElement("div");\\   furigana.className = "furigana-editor";\\   renderFuriganaEditor(furigana, example.sentence, example.sentenceFurigana);\\ \\   sentenceInput.addEventListener("input", () => {\\     const oldText = sentenceInput.dataset.previousText || "";\\     const oldFurigana = collectFurigana(oldText, furigana);\\     const nextFurigana = migrateFurigana(oldText, sentenceInput.value, oldFurigana);\\     renderFuriganaEditor(furigana, sentenceInput.value, nextFurigana);\\     sentenceInput.dataset.previousText = sentenceInput.value;\\   });\\ \\   const polishInput = document.createElement("textarea");\\   polishInput.value = example.sentenceMeaning?.pl || "";\\ \\   const englishInput = document.createElement("textarea");\\   englishInput.value = example.sentenceMeaning?.en || "";\\ \\   box.append(\\     makeLabel("Tekst japoński", sentenceInput),\\     makeHeadingSection("Furigana — osobno nad każdym kanji", furigana),\\     makeLabel("Tłumaczenie polskie", polishInput),\\     makeLabel("Tłumaczenie angielskie", englishInput)\\   );\\ \\   const actions = document.createElement("div");\\   actions.className = "actions";\\ \\   const save = document.createElement("button");\\   save.type = "button";\\   save.className = "button";\\   save.textContent = "Zapisz zdanie";\\ \\   const cancel = document.createElement("button");\\   cancel.type = "button";\\   cancel.className = "button secondary";\\   cancel.textContent = "Anuluj";\\ \\   actions.append(save, cancel);\\   box.appendChild(actions);\\ \\   save.addEventListener("click", () => {\\     example.sentence = sentenceInput.value.trim();\\     example.sentenceFurigana = collectFurigana(example.sentence, furigana);\\     example.sentenceMeaning = {\\       ...example.sentenceMeaning,\\       pl: polishInput.value.trim(),\\       en: englishInput.value.trim()\\     };\\ \\     saveDraft();\\     renderDetail(record.character);\\     setMessage("Zapisano zmiany w tym zdaniu.");\\   });\\ \\   cancel.addEventListener("click", () => {\\     box.className = "hidden";\\     box.replaceChildren();\\   });\\ }\\ \\ function makeLabel(text, control) {\\   const label = document.createElement("label");\\   label.append(document.createTextNode(text), control);\\   return label;\\ }\\ \\ function makeHeadingSection(title, content) {\\   const section = document.createElement("section");\\   section.className = "furigana-section";\\   const heading = document.createElement("h3");\\   heading.textContent = title;\\   section.append(heading, content);\\   return section;\\ }\\ \\ function setupWriting(item) {\\   const canvas = $("#writingCanvas");\\   const context = canvas.getContext("2d");\\   let drawing = false;\\ \\   context.lineWidth = 8;\\   context.lineCap = "round";\\   context.strokeStyle = "#252b32";\\ \\   const point = event => {\\     const rect = canvas.getBoundingClientRect();\\     return {\\       x: (event.clientX - rect.left) * canvas.width / rect.width,\\       y: (event.clientY - rect.top) * canvas.height / rect.height\\     };\\   };\\ \\   canvas.addEventListener("pointerdown", event => {\\     drawing = true;\\     canvas.setPointerCapture(event.pointerId);\\     const p = point(event);\\     context.beginPath();\\     context.moveTo(p.x, p.y);\\   });\\ \\   canvas.addEventListener("pointermove", event => {\\     if (!drawing) return;\\     const p = point(event);\\     context.lineTo(p.x, p.y);\\     context.stroke();\\   });\\ \\   canvas.addEventListener("pointerup", () => {\\     drawing = false;\\     context.closePath();\\   });\\ \\   canvas.addEventListener("pointercancel", () => {\\     drawing = false;\\   });\\ \\   $("#clearCanvas").addEventListener("click", () => {\\     context.clearRect(0, 0, canvas.width, canvas.height);\\   });\\ \\   $("#showKanji").addEventListener("click", async () => {\\     context.clearRect(0, 0, canvas.width, canvas.height);\\     try {\\       if (document.fonts?.load) await document.fonts.load('280px "Klee One"');\\     } catch {}\\ \\     context.fillStyle = "#ded8d0";\\     context.textAlign = "center";\\     context.textBaseline = "middle";\\     context.font = '280px "Klee One", "Yu Gothic", sans-serif';\\     context.fillText(item.character, canvas.width / 2, canvas.height / 2);\\   });\\ }\\ \\ function speakJapanese(text, status) {\\   if (!text) return;\\ \\   if (!("speechSynthesis" in window)) {\\     status.textContent = "Odsłuch nie jest obsługiwany w tej przeglądarce.";\\     return;\\   }\\ \\   speechSynthesis.cancel();\\   const utterance = new SpeechSynthesisUtterance(text);\\   utterance.lang = "ja-JP";\\   speechSynthesis.speak(utterance);\\ }\\ \\ function normalizeSpeech(text) {\\   return Array.from(String(text || ""), char => {\\     const code = char.codePointAt(0);\\     return code >= 0x30a1 && code <= 0x30f6\\       ? String.fromCodePoint(code - 0x60)\\       : char;\\   }).join("")\\     .normalize("NFC")\\     .replace(/[\s。、！？,.!?「」『』（）()]/g, "");\\ }\\ \\ function sentenceReading(example) {\\   const parts = normalizeFurigana(example.sentence, example.sentenceFurigana);\\   const missing = parts.filter(part => isKanji(part.text) && !part.reading.trim());\\ \\   if (missing.length) {\\     return {\\       reading: "",\\       missing: [...new Set(missing.map(part => part.text))]\\     };\\   }\\ \\   return {\\     reading: parts.map(part => isKanji(part.text) ? part.reading : part.text).join(""),\\     missing: []\\   };\\ }\\ \\ function checkSentence(example, index) {\\   const status = $(`#sentenceStatus${index}`);\\   const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;\\ \\   if (!Recognition) {\\     status.textContent = "Rozpoznawanie mowy nie jest dostępne. Spróbuj w Chrome.";\\     return;\\   }\\ \\   const target = sentenceReading(example);\\   if (target.missing.length) {\\     status.textContent = `Uzupełnij furiganę przy kanji: ${target.missing.join("、")}.`;\\     return;\\   }\\ \\   const recognition = new Recognition();\\   recognition.lang = "ja-JP";\\   recognition.interimResults = false;\\   recognition.maxAlternatives = 1;\\   status.textContent = "Słucham — przeczytaj zdanie na głos.";\\ \\   recognition.onresult = event => {\\     const heardRaw = event.results[0][0].transcript || "";\\     const heard = normalizeSpeech(heardRaw);\\     const expectedText = normalizeSpeech(example.sentence);\\     const expectedReading = normalizeSpeech(target.reading);\\ \\     if (heard === expectedText || heard === expectedReading) {\\       status.textContent = `Dobrze! Rozpoznany tekst: „${heardRaw}”.`;\\     } else {\\       status.textContent =\\         `Nie zgadza się z wpisanym zdaniem. Rozpoznano „${heardRaw}”; ` +\\         `sprawdź wymowę i furiganę. Oczekiwany odczyt: „${target.reading}”. ` +\\         "Rozpoznawanie mowy może też pomylić się przy transkrypcji.";\\     }\\   };\\ \\   recognition.onerror = event => {\\     status.textContent =\\       `Błąd mikrofonu lub rozpoznawania (${event.error}). Sprawdź uprawnienia.`;\\   };\\ \\   recognition.onend = () => {\\     if (status.textContent.startsWith("Słucham")) {\\       status.textContent = "Nie rozpoznano wypowiedzi. Spróbuj ponownie.";\\     }\\   };\\ \\   try {\\     recognition.start();\\   } catch {\\     status.textContent = "Nie można uruchomić mikrofonu. Sprawdź uprawnienia strony.";\\   }\\ }\\ \\ function renderDaily() {\\   const date = new Date();\\   $("#dailyDate").textContent = new Intl.DateTimeFormat("pl-PL", {\\     weekday: "long",\\     day: "numeric",\\     month: "long"\\   }).format(date);\\ \\   const list = filteredRecords();\\   if (!list.length) {\\     $("#dailyContent").innerHTML = '<p class="muted">Brak kanji w bazie lub filtrze.</p>';\\     return;\\   }\\ \\   const dayNumber = Math.floor(Date.now() / 86400000);\\   const item = list[dayNumber % list.length];\\ \\   $("#dailyContent").innerHTML = `\\     <div class="daily-content">\\       <div class="daily-kanji">${rubyText(item.character, item.characterFurigana)}</div>\\       <div>\\         <h3>${translation(item.meanings.pl, item.meanings.en)}</h3>\\         <button id="openDaily" class="button" type="button">Otwórz kartę</button>\\       </div>\\     </div>\\   `;\\ \\   $("#openDaily").addEventListener("click", () => {\\     selectedCharacter = item.character;\\     renderList();\\     renderDetail(item.character);\\     $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });\\   });\\ }\\ \\ /* Fiszki */\\ \\ function masteredSet() {\\   const saved = readStorage(MASTERED_KEY, []);\\   return new Set(Array.isArray(saved) ? saved : []);\\ }\\ \\ function flashcardPool() {\\   let pool = filteredRecords();\\ \\   if ($("#hideMastered").checked) {\\     const mastered = masteredSet();\\     pool = pool.filter(item => !mastered.has(item.character));\\   }\\ \\   return pool;\\ }\\ \\ function renderFlashcard() {\\   const pool = flashcardPool();\\ \\   if (!pool.length) {\\     $("#flashcard").innerHTML =\\       '<div class="flashcard-empty">Brak fiszek. Wczytaj lub dodaj kanji albo zmień filtry.</div>';\\     $("#flashcardProgress").textContent = "0 fiszek";\\     $("#previousFlashcard").disabled = true;\\     $("#nextFlashcard").disabled = true;\\     $("#revealFlashcard").disabled = true;\\     $("#markMastered").disabled = true;\\     $("#shuffleFlashcards").disabled = true;\\     return;\\   }\\ \\   let index = pool.findIndex(item => item.character === currentFlashcard);\\   if (index < 0) {\\     index = 0;\\     currentFlashcard = pool[0].character;\\     revealed = false;\\   }\\ \\   const item = pool[index];\\   const mastered = masteredSet().has(item.character);\\ \\   $("#flashcardProgress").textContent =\\     `Fiszka ${index + 1} z ${pool.length}${mastered ? " · opanowana" : ""}`;\\ \\   $("#flashcard").innerHTML = revealed\\     ? `\\       <div class="flashcard-back">\\         <p class="flashcard-label">ODPOWIEDŹ</p>\\         <div class="flashcard-answer-kanji">\\           ${rubyText(item.character, item.characterFurigana)}\\         </div>\\         <p><b>Znaczenie:</b> ${translation(item.meanings.pl, item.meanings.en)}</p>\\         <p><b>On’yomi:</b> ${escapeHTML(item.onyomi.join("、") || "—")}</p>\\         <p><b>Kun’yomi:</b> ${escapeHTML(item.kunyomi.join("、") || "—")}</p>\\         ${item.grade ? `<p><b>Klasa:</b> ${escapeHTML(item.grade)}</p>` : ""}\\         ${item.jlpt ? `<p><b>JLPT:</b> ${escapeHTML(item.jlpt)}</p>` : ""}\\         ${renderFlashcardExamples(item.examples)}\\       </div>\\     `\\     : `\\       <div class="flashcard-front">\\         <p class="flashcard-label">KANJI</p>\\         <div class="flashcard-kanji">${escapeHTML(item.character)}</div>\\         <p class="flashcard-prompt">Przypomnij sobie odczyt i znaczenie, a potem odsłoń odpowiedź.</p>\\       </div>\\     `;\\ \\   $("#revealFlashcard").textContent = revealed ? "Ukryj odpowiedź" : "Pokaż odpowiedź";\\   $("#markMastered").textContent = mastered ? "Usuń z opanowanych" : "Oznacz jako opanowane";\\   $("#previousFlashcard").disabled = pool.length < 2;\\   $("#nextFlashcard").disabled = pool.length < 2;\\   $("#revealFlashcard").disabled = false;\\   $("#markMastered").disabled = false;\\   $("#shuffleFlashcards").disabled = pool.length < 2;\\ }\\ \\ function renderFlashcardExamples(examples) {\\   const useful = examples.filter(example => example.word || example.sentence);\\   if (!useful.length) return "";\\ \\   return `\\     <section class="flashcard-examples">\\       <h3>Przykłady</h3>\\       ${useful.slice(0, 3).map(example => `\\         <div class="flashcard-example">\\           ${example.word\\             ? `<p>${rubyText(example.word, example.wordFurigana)}</p>`\\             : ""}\\           ${example.wordMeaning?.pl || example.wordMeaning?.en\\             ? `<p>${translation(example.wordMeaning.pl, example.wordMeaning.en)}</p>`\\             : ""}\\           ${example.sentence\\             ? `<p>${rubyText(example.sentence, example.sentenceFurigana)}</p>`\\             : ""}\\           ${example.sentenceMeaning?.pl\\             ? `<p><b>PL:</b> ${escapeHTML(example.sentenceMeaning.pl)}</p>`\\             : ""}\\           ${example.sentenceMeaning?.en\\             ? `<p><b>EN:</b> ${escapeHTML(example.sentenceMeaning.en)}</p>`\\             : ""}\\         </div>\\       `).join("")}\\     </section>\\   `;\\ }\\ \\ function moveFlashcard(step) {\\   const pool = flashcardPool();\\   if (!pool.length) return;\\ \\   let index = pool.findIndex(item => item.character === currentFlashcard);\\   if (index < 0) index = 0;\\ \\   index = (index + step + pool.length) % pool.length;\\   currentFlashcard = pool[index].character;\\   revealed = false;\\   renderFlashcard();\\ }\\ \\ function toggleMastered() {\\   const pool = flashcardPool();\\   const item = pool.find(entry => entry.character === currentFlashcard);\\   if (!item) return;\\ \\   const mastered = masteredSet();\\ \\   if (mastered.has(item.character)) {\\     mastered.delete(item.character);\\     $("#flashcardMessage").textContent = `${item.character} usunięto z opanowanych.`;\\   } else {\\     mastered.add(item.character);\\     $("#flashcardMessage").textContent = `${item.character} oznaczono jako opanowane.`;\\   }\\ \\   store(MASTERED_KEY, [...mastered]);\\   renderFlashcard();\\ }\\ \\ function shuffleFlashcards() {\\   const pool = flashcardPool();\\   if (pool.length < 2) return;\\ \\   for (let i = pool.length - 1; i > 0; i--) {\\     const j = Math.floor(Math.random() * (i + 1));\\     [pool[i], pool[j]] = [pool[j], pool[i]];\\   }\\ \\   currentFlashcard = pool[0].character;\\   revealed = false;\\   $("#flashcardMessage").textContent = "Wylosowano inną fiszkę.";\\   renderFlashcard();\\ }\\ \\ /* Edytor furigany i formularz dodawania */\\ \\ function renderFuriganaEditor(container, text, source = []) {\\   const characters = chars(text);\\   const segments = normalizeFurigana(text, source);\\   container.replaceChildren();\\ \\   const indexes = characters\\     .map((character, index) => isKanji(character) ? index : -1)\\     .filter(index => index >= 0);\\ \\   if (!indexes.length) {\\     const hint = document.createElement("p");\\     hint.className = "furigana-hint muted";\\     hint.textContent = "Wpisz tekst zawierający kanji, aby dodać furiganę.";\\     container.appendChild(hint);\\     return;\\   }\\ \\   indexes.forEach(index => {\\     const label = document.createElement("label");\\     label.className = "furigana-item";\\ \\     const kanji = document.createElement("span");\\     kanji.className = "kanji-label";\\     kanji.textContent = characters[index];\\ \\     const input = document.createElement("input");\\     input.type = "text";\\     input.placeholder = "odczyt";\\     input.autocomplete = "off";\\     input.value = segments[index]?.reading || "";\\     input.dataset.index = String(index);\\     input.setAttribute("aria-label", `Furigana dla ${characters[index]}`);\\ \\     label.append(kanji, input);\\     container.appendChild(label);\\   });\\ \\   const hint = document.createElement("p");\\   hint.className = "furigana-hint muted";\\   hint.textContent = "Każde pole dotyczy jednego kanji; kana pozostaje bez furigany.";\\   container.appendChild(hint);\\ }\\ \\ function collectFurigana(text, container) {\\   const result = chars(text).map(character => ({ text: character, reading: "" }));\\ \\   container.querySelectorAll("input[data-index]").forEach(input => {\\     const index = Number(input.dataset.index);\\     if (result[index] && isKanji(result[index].text)) {\\       result[index].reading = input.value.trim();\\     }\\   });\\ \\   return result;\\ }\\ \\ function addExampleEditor() {\\   const row = document.createElement("article");\\   row.className = "example-editor";\\ \\   row.innerHTML = `\\     <div class="example-editor-grid">\\       <label>Słowo po japońsku\\         <input data-field="word">\\       </label>\\       <label>Znaczenie słowa — polski\\         <input data-field="wordPL">\\       </label>\\       <label>Znaczenie słowa — angielski\\         <input data-field="wordEN">\\       </label>\\       <label>Zdanie po japońsku\\         <textarea data-field="sentence"></textarea>\\       </label>\\       <label>Tłumaczenie zdania — polski\\         <textarea data-field="sentencePL"></textarea>\\       </label>\\       <label>Tłumaczenie zdania — angielski\\         <textarea data-field="sentenceEN"></textarea>\\       </label>\\     </div>\\ \\     <section class="furigana-section">\\       <h3>Furigana słowa — osobno przy każdym kanji</h3>\\       <div class="furigana-editor" data-editor="word"></div>\\     </section>\\     <section class="furigana-section">\\       <h3>Furigana zdania — osobno przy każdym kanji</h3>\\       <div class="furigana-editor" data-editor="sentence"></div>\\     </section>\\     <button class="button secondary remove-example" type="button">Usuń przykład</button>\\   `;\\ \\   const word = row.querySelector('[data-field="word"]');\\   const sentence = row.querySelector('[data-field="sentence"]');\\   const wordEditor = row.querySelector('[data-editor="word"]');\\   const sentenceEditor = row.querySelector('[data-editor="sentence"]');\\ \\   renderFuriganaEditor(wordEditor, "");\\   renderFuriganaEditor(sentenceEditor, "");\\ \\   word.dataset.oldText = "";\\   sentence.dataset.oldText = "";\\ \\   word.addEventListener("input", () => {\\     const previous = word.dataset.oldText || "";\\     const oldFurigana = collectFurigana(previous, wordEditor);\\     renderFuriganaEditor(\\       wordEditor,\\       word.value,\\       migrateFurigana(previous, word.value, oldFurigana)\\     );\\     word.dataset.oldText = word.value;\\   });\\ \\   sentence.addEventListener("input", () => {\\     const previous = sentence.dataset.oldText || "";\\     const oldFurigana = collectFurigana(previous, sentenceEditor);\\     renderFuriganaEditor(\\       sentenceEditor,\\       sentence.value,\\       migrateFurigana(previous, sentence.value, oldFurigana)\\     );\\     sentence.dataset.oldText = sentence.value;\\   });\\ \\   row.querySelector(".remove-example").addEventListener("click", () => row.remove());\\   $("#examples").appendChild(row);\\ }\\ \\ function resetForm() {\\   $("#kanjiForm").reset();\\   $("#examples").replaceChildren();\\   $("#character").dataset.oldText = "";\\   renderFuriganaEditor($("#characterFuriganaEditor"), "");\\   addExampleEditor();\\ }\\ \\ function bindCharacterInput() {\\   const input = $("#character");\\   const editor = $("#characterFuriganaEditor");\\   input.dataset.oldText = "";\\ \\   input.addEventListener("input", () => {\\     const previous = input.dataset.oldText || "";\\     const oldFurigana = collectFurigana(previous, editor);\\     renderFuriganaEditor(\\       editor,\\       input.value,\\       migrateFurigana(previous, input.value, oldFurigana)\\     );\\     input.dataset.oldText = input.value;\\   });\\ }\\ \\ function addNewKanji(event) {\\   event.preventDefault();\\ \\   const character = $("#character").value.trim();\\   if (!character) {\\     setMessage("Wpisz znak kanji.");\\     return;\\   }\\ \\   if (records.some(item => item.character === character)) {\\     setMessage(`${character} już jest w bazie. Formularz służy tylko do dodawania.`);\\     return;\\   }\\ \\   let extras = {};\\   if ($("#extraFields").value.trim()) {\\     try {\\       extras = JSON.parse($("#extraFields").value);\\       if (!extras || Array.isArray(extras) || typeof extras !== "object") {\\         throw new Error("Wartość powinna być obiektem JSON.");\\       }\\     } catch (error) {\\       setMessage(`Błąd w dodatkowych polach: ${error.message}`);\\       return;\\     }\\   }\\ \\   const examples = $$(".example-editor").map(row => {
    const get = name => row.querySelector(`[data-field="${name}"]`).value.trim();
    const word = get("word");
    const sentence = get("sentence");

    return {
      word,
      wordFurigana: collectFurigana(word, row.querySelector('[data-editor="word"]')),
      wordMeaning: { pl: get("wordPL"), en: get("wordEN") },
      sentence,
      sentenceFurigana: collectFurigana(
        sentence,
        row.querySelector('[data-editor="sentence"]')
      ),
      sentenceMeaning: { pl: get("sentencePL"), en: get("sentenceEN") }
    };
  }).filter(example =>
    example.word || example.sentence ||
    example.wordMeaning.pl || example.wordMeaning.en ||
    example.sentenceMeaning.pl || example.sentenceMeaning.en
  );

  const record = normalizeRecord({
    ...extras,
    character,
    characterFurigana: collectFurigana(
      character,
      $("#characterFuriganaEditor")
    ),
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

  records.push(record);
  selectedCharacter = character;
  currentFlashcard = character;
  saveDraft();
  renderAll();
  resetForm();
  setStatus(`Dodano kanji ${character}.`);
  setMessage("Zapisano lokalnie. Użyj eksportu JSON lub Excela, aby zrobić kopię.");
  showTab("learn");
  renderDetail(character);
}

/* Import i eksport */

function exportJSON() {
  return JSON.stringify({ version: 7, source: "Kanji Path", kanji: records }, null, 2);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadJSON() {
  downloadBlob(
    new Blob([exportJSON()], { type: "application/json;charset=utf-8" }),
    "data.json"
  );
  setMessage("Pobrano data.json.");
}

async function copyJSON() {
  try {
    await navigator.clipboard.writeText(exportJSON());
    setMessage("JSON skopiowany do schowka.");
  } catch {
    downloadJSON();
    setMessage("Schowek niedostępny — pobrano plik JSON.");
  }
}

function parseCellJSON(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  try {
    return JSON.parse(String(value)) ?? fallback;
  } catch {
    return fallback;
  }
}

function exportExcel() {
  if (!window.XLSX) {
    setMessage("Nie załadowano biblioteki Excel. Sprawdź połączenie z internetem i odśwież stronę.");
    return;
  }

  const rows = [];

  records.forEach(item => {
    const examples = item.examples.length ? item.examples : [{}];

    examples.forEach(example => {
      rows.push({
        Kanji: item.character,
        "Furigana kanji JSON": JSON.stringify(item.characterFurigana),
        Klasa: item.grade,
        "Etap szkoły": item.schoolStage,
        JLPT: item.jlpt,
        Kreski: item.strokes,
        "Znaczenie PL": item.meanings.pl,
        "Meaning EN": item.meanings.en,
        "Onyomi JSON": JSON.stringify(item.onyomi),
        "Kunyomi JSON": JSON.stringify(item.kunyomi),
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

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Kanji");
  XLSX.writeFile(workbook, "kanjipath.xlsx");
  setMessage("Wyeksportowano kanjipath.xlsx.");
}

function importExcelRows(rows) {
  const grouped = new Map();

  rows.forEach(row => {
    const character = String(row.Kanji || "").trim();
    if (!character) return;

    if (!grouped.has(character)) {
      grouped.set(character, {
        ...parseCellJSON(row["Dodatkowe pola JSON"], {}),
        character,
        characterFurigana: parseCellJSON(row["Furigana kanji JSON"], []),
        grade: row.Klasa === "" ? null : Number(row.Klasa),
        schoolStage: String(row["Etap szkoły"] || ""),
        jlpt: String(row.JLPT || ""),
        strokes: row.Kreski === "" ? null : Number(row.Kreski),
        meanings: {
          pl: String(row["Znaczenie PL"] || ""),
          en: String(row["Meaning EN"] || "")
        },
        onyomi: parseCellJSON(row["Onyomi JSON"], []),
        kunyomi: parseCellJSON(row["Kunyomi JSON"], []),
        examples: []
      });
    }

    const record = grouped.get(character);
    const word = String(row["Słowo JP"] || "");
    const sentence = String(row["Zdanie JP"] || "");

    if (word || sentence || row["Znaczenie słowa PL"] ||
        row["Znaczenie słowa EN"] || row["Tłumaczenie zdania PL"] ||
        row["Sentence translation EN"]) {
      record.examples.push({
        word,
        wordFurigana: parseCellJSON(row["Furigana słowa JSON"], []),
        wordMeaning: {
          pl: String(row["Znaczenie słowa PL"] || ""),
          en: String(row["Znaczenie słowa EN"] || "")
        },
        sentence,
        sentenceFurigana: parseCellJSON(row["Furigana zdania JSON"], []),
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
    setMessage("Nie załadowano biblioteki Excel. Sprawdź połączenie z internetem.");
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw new Error("Plik nie zawiera arkusza.");

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: "" });
    const imported = importExcelRows(rows);
    if (!imported.length) throw new Error("Nie znaleziono kanji w arkuszu.");

    if ($("#importMode").value === "replace") {
      records = imported;
    } else {
      const map = new Map(records.map(item => [item.character, item]));
      imported.forEach(item => map.set(item.character, item));
      records = [...map.values()];
    }

    selectedCharacter = "";
    currentFlashcard = "";
    saveDraft();
    renderAll();
    setStatus(`Wczytano ${records.length} kanji.`);
    setMessage(`Import Excel zakończony: ${imported.length} kanji.`);
  } catch (error) {
    setMessage(`Import Excel nie powiódł się: ${error.message}`);
  } finally {
    $("#excelFile").value = "";
  }
}

async function importJSONFile(file) {
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    const imported = (Array.isArray(parsed) ? parsed : parsed.kanji)
      .map(normalizeRecord)
      .filter(item => item.character);

    if (!imported.length) throw new Error('Nie znaleziono tablicy "kanji".');

    if ($("#importMode").value === "replace") {
      records = imported;
    } else {
      const map = new Map(records.map(item => [item.character, item]));
      imported.forEach(item => map.set(item.character, item));
      records = [...map.values()];
    }

    selectedCharacter = "";
    currentFlashcard = "";
    saveDraft();
    renderAll();
    setMessage(`Import JSON zakończony: ${imported.length} kanji.`);
  } catch (error) {
    setMessage(`Import JSON nie powiódł się: ${error.message}`);
  } finally {
    $("#jsonFile").value = "";
  }
}

/* Zdarzenia — podpinane niezależnie od wyniku wczytywania data.json */

$("#kanjiForm").addEventListener("submit", addNewKanji);
$("#addExample").addEventListener("click", addExampleEditor);
$("#resetForm").addEventListener("click", resetForm);

$("#search").addEventListener("input", () => {
  renderList();
  renderDaily();
  renderFlashcard();
});

$("#level").addEventListener("change", renderAll);
$("#grade").addEventListener("change", renderAll);

$("#clearFilters").addEventListener("click", () => {
  $("#search").value = "";
  $("#level").value = "all";
  $("#grade").value = "all";
  renderAll();
});

$("#language").value = settings.language || "pl";
$("#language").addEventListener("change", () => {
  settings.language = $("#language").value;
  store(SETTINGS_KEY, settings);
  renderAll();
});

$("#importExcel").addEventListener("click", () => $("#excelFile").click());
$("#excelFile").addEventListener("change", event => importExcel(event.target.files?.[0]));
$("#exportExcel").addEventListener("click", exportExcel);
$("#importJson").addEventListener("click", () => $("#jsonFile").click());
$("#jsonFile").addEventListener("change", event => importJSONFile(event.target.files?.[0]));
$("#exportJson").addEventListener("click", downloadJSON);
$("#copyJson").addEventListener("click", copyJSON);

$("#refresh").addEventListener("click", async () => {
  if (!confirm("Wczytać ponownie data.json i usunąć lokalny szkic?")) return;
  localStorage.removeItem(DRAFT_KEY);
  await loadData(false);
});

$("#hideMastered").addEventListener("change", renderFlashcard);
$("#revealFlashcard").addEventListener("click", () => {
  revealed = !revealed;
  renderFlashcard();
});
$("#previousFlashcard").addEventListener("click", () => moveFlashcard(-1));
$("#nextFlashcard").addEventListener("click", () => moveFlashcard(1));
$("#markMastered").addEventListener("click", () => {
  const item = flashcardPool().find(entry => entry.character === currentFlashcard);
  if (!item) return;

  const mastered = masteredSet();

  if (mastered.has(item.character)) {
    mastered.delete(item.character);
    $("#flashcardMessage").textContent = `${item.character} usunięto z opanowanych.`;
  } else {
    mastered.add(item.character);
    $("#flashcardMessage").textContent = `${item.character} oznaczono jako opanowane.`;
  }

  store(MASTERED_KEY, [...mastered]);
  renderFlashcard();
});
$("#shuffleFlashcards").addEventListener("click", () => {
  const pool = flashcardPool();
  if (pool.length < 2) return;

  const current = currentFlashcard;
  let next = current;
  while (next === current) {
    next = pool[Math.floor(Math.random() * pool.length)].character;
  }

  currentFlashcard = next;
  revealed = false;
  $("#flashcardMessage").textContent = "Wylosowano inną fiszkę.";
  renderFlashcard();
});

$$(".tab").forEach(button => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});

let touchStartX = 0;
$("#flashcard").addEventListener("touchstart", event => {
  touchStartX = event.changedTouches[0].clientX;
}, { passive: true });

$("#flashcard").addEventListener("touchend", event => {
  const delta = event.changedTouches[0].clientX - touchStartX;
  if (Math.abs(delta) > 70) moveFlashcard(delta < 0 ? 1 : -1);
}, { passive: true });

/* Start aplikacji: przyciski są już podłączone, zanim zacznie się pobieranie JSON. */
bindCharacterInput();
renderFuriganaEditor($("#characterFuriganaEditor"), "");
addExampleEditor();
renderAll();
loadData(true);
