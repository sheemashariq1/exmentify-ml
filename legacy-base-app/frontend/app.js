const API = "/api";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const themeSelect = document.getElementById("themeSelect");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeSelect.value = theme;
  localStorage.setItem("exmentify_theme", theme);
}
applyTheme(localStorage.getItem("exmentify_theme") || "dark");
themeSelect.addEventListener("change", () => {
  applyTheme(themeSelect.value);
});

// ---------------------------------------------------------------------------
// View router
// ---------------------------------------------------------------------------
const views = {
  exams: document.getElementById("view-exams"),
  subjects: document.getElementById("view-subjects"),
  workspace: document.getElementById("view-workspace"),
  contestIntro: document.getElementById("view-contest-intro"),
  contest: document.getElementById("view-contest"),
  results: document.getElementById("view-results"),
  bookmarks: document.getElementById("view-bookmarks"),
  badges: document.getElementById("view-badges"),
  studyPlan: document.getElementById("view-study-plan"),
  cheatSheet: document.getElementById("view-cheat-sheet"),
};
function showView(name) {
  Object.values(views).forEach((v) => (v.hidden = true));
  views[name].hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll("[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.back));
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  examId: null,
  subjects: [],
  subjectId: null,
  topicId: null,
  subjectName: null,
  topicName: null,
  mode: "explain",
  selectedPyqId: null,
  contest: { questions: [], index: 0, results: [], startedAt: null, contestId: null },
  doubtHistory: [],
};

// ---------------------------------------------------------------------------
// Study streak (localStorage-backed)
// ---------------------------------------------------------------------------
function recordStudyActivity() {
  const today = new Date().toISOString().slice(0, 10);
  const raw = localStorage.getItem("exmentify_activity_days");
  const days = raw ? JSON.parse(raw) : [];
  if (!days.includes(today)) {
    days.push(today);
    localStorage.setItem("exmentify_activity_days", JSON.stringify(days));
  }
  renderStreak();
}

function computeStreak() {
  const raw = localStorage.getItem("exmentify_activity_days");
  const days = new Set(raw ? JSON.parse(raw) : []);
  let streak = 0;
  let cursor = new Date();
  // Count backward from today; a gap of a day breaks the streak.
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (streak === 0 && key === new Date().toISOString().slice(0, 10)) {
      // Today not yet logged — check yesterday instead so the streak
      // doesn't zero out before the day is over.
      cursor.setDate(cursor.getDate() - 1);
      continue;
    } else {
      break;
    }
  }
  return streak;
}

function renderStreak() {
  const streak = computeStreak();
  const pill = document.getElementById("streakPill");
  document.getElementById("streakCount").textContent = streak;
  pill.hidden = streak === 0;
}

// ---------------------------------------------------------------------------
// Bookmarks (localStorage-backed)
// ---------------------------------------------------------------------------
function getBookmarks() {
  const raw = localStorage.getItem("exmentify_bookmarks");
  return raw ? JSON.parse(raw) : [];
}
function isBookmarked(examId, subjectId, topicId) {
  return getBookmarks().some(
    (b) => b.examId === examId && b.subjectId === subjectId && b.topicId === topicId
  );
}
function toggleBookmark(examId, subjectId, topicId, subjectName, topicName) {
  let bookmarks = getBookmarks();
  const exists = bookmarks.some(
    (b) => b.examId === examId && b.subjectId === subjectId && b.topicId === topicId
  );
  if (exists) {
    bookmarks = bookmarks.filter(
      (b) => !(b.examId === examId && b.subjectId === subjectId && b.topicId === topicId)
    );
  } else {
    bookmarks.push({ examId, subjectId, topicId, subjectName, topicName });
  }
  localStorage.setItem("exmentify_bookmarks", JSON.stringify(bookmarks));
  return !exists;
}

// ---------------------------------------------------------------------------
// Exam select
// ---------------------------------------------------------------------------
async function loadExams() {
  const res = await fetch(`${API}/exams`);
  const data = await res.json();
  const grid = document.getElementById("examGrid");
  grid.innerHTML = "";
  data.exams.forEach((exam) => {
    const card = document.createElement("button");
    card.className = "exam-card" + (exam.status !== "active" ? " disabled" : "");
    card.innerHTML = `
      <span class="status-pill ${exam.status}">${exam.status === "active" ? "Active" : "Coming soon"}</span>
      <h3>${exam.name}</h3>
      <p>${exam.tagline}</p>
    `;
    if (exam.status === "active") {
      card.addEventListener("click", () => openExam(exam));
    }
    grid.appendChild(card);
  });
}

async function openExam(exam) {
  state.examId = exam.id;
  document.getElementById("examTitle").textContent = exam.name;
  const res = await fetch(`${API}/subjects/${exam.id}`);
  const data = await res.json();
  state.subjects = data.subjects;
  renderSubjects();
  updateContestButtonState();
  showView("subjects");
}

function weightageWidth(w) {
  return { low: "30%", medium: "60%", high: "95%" }[w] || "40%";
}

function renderSubjects() {
  const container = document.getElementById("subjectList");
  container.innerHTML = "";
  state.subjects.forEach((subject) => {
    const block = document.createElement("div");
    block.className = "subject-block";
    const topics = subject.topics
      .map((t) => {
        const bookmarked = isBookmarked(state.examId, subject.subject_id, t.topic_id);
        return `
      <div class="topic-row" data-subject="${subject.subject_id}" data-topic="${t.topic_id}"
           data-subject-name="${subject.name}" data-topic-name="${t.name}">
        <span class="topic-name">${t.name}</span>
        <div class="weightage-bar"><div class="weightage-bar-fill" style="width:${weightageWidth(t.weightage)}"></div></div>
        <span class="weightage-label">${t.weightage}</span>
        <button class="topic-bookmark-star ${bookmarked ? "active" : ""}" data-star-subject="${subject.subject_id}" data-star-topic="${t.topic_id}" data-star-subject-name="${subject.name}" data-star-topic-name="${t.name}" title="Bookmark">${bookmarked ? "★" : "☆"}</button>
      </div>`;
      })
      .join("");
    block.innerHTML = `
      <div class="subject-block-head">
        <h2>${subject.name}</h2>
        <div class="subject-actions">
          <button class="subject-action-btn" data-cheat-subject="${subject.subject_id}" data-cheat-name="${subject.name}">Cheat Sheet</button>
          <button class="subject-action-btn" data-booklet-subject="${subject.subject_id}" data-booklet-name="${subject.name}">Revision Booklet</button>
        </div>
      </div>
      ${topics}`;
    container.appendChild(block);
  });
  container.querySelectorAll(".topic-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".topic-bookmark-star")) return; // star handled separately
      openTopic(row.dataset.subject, row.dataset.topic, row.dataset.subjectName, row.dataset.topicName);
    });
  });
  container.querySelectorAll(".topic-bookmark-star").forEach((star) => {
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      const nowBookmarked = toggleBookmark(
        state.examId,
        star.dataset.starSubject,
        star.dataset.starTopic,
        star.dataset.starSubjectName,
        star.dataset.starTopicName
      );
      star.textContent = nowBookmarked ? "★" : "☆";
      star.classList.toggle("active", nowBookmarked);
    });
  });
  container.querySelectorAll("[data-cheat-subject]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCheatSheet(btn.dataset.cheatSubject, btn.dataset.cheatName);
    });
  });
  container.querySelectorAll("[data-booklet-subject]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      generateRevisionBooklet(btn.dataset.bookletSubject, btn.dataset.bookletName, btn);
    });
  });
}

// ---------------------------------------------------------------------------
// Topic workspace
// ---------------------------------------------------------------------------
function openTopic(subjectId, topicId, subjectName, topicName) {
  state.subjectId = subjectId;
  state.topicId = topicId;
  state.subjectName = subjectName;
  state.topicName = topicName;
  state.mode = "explain";
  state.selectedPyqId = null;
  state.doubtHistory = [];

  document.getElementById("workspaceSubject").textContent = subjectName;
  document.getElementById("workspaceTopic").textContent = topicName;
  document.querySelectorAll(".mode-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === "explain"));
  document.getElementById("pyqPickerWrap").hidden = true;
  document.getElementById("difficultyLabel").hidden = true;
  document.getElementById("difficultySelect").hidden = true;
  document.getElementById("normalOutputWrap").hidden = false;
  document.getElementById("doubtWrap").hidden = true;
  document.getElementById("doubtMessages").innerHTML = `<p class="placeholder">Ask anything specific about this topic — a follow-up question, a confusing step, anything.</p>`;
  document.getElementById("flashcardsWrap").hidden = true;
  document.getElementById("diagnoseWrap").hidden = true;
  document.getElementById("flashcardStage").innerHTML = `<p class="placeholder">Hit Generate to build a flashcard set for this topic.</p>`;
  document.getElementById("flashcardNav").hidden = true;
  document.getElementById("diagnosePanel").hidden = true;
  updateBookmarkBtnLabel();
  resetOutput();
  showView("workspace");
}

function updateBookmarkBtnLabel() {
  const btn = document.getElementById("bookmarkTopicBtn");
  const bookmarked = isBookmarked(state.examId, state.subjectId, state.topicId);
  btn.textContent = bookmarked ? "★ Bookmarked" : "☆ Bookmark this topic";
  btn.classList.toggle("active-bookmark", bookmarked);
}

document.getElementById("bookmarkTopicBtn").addEventListener("click", () => {
  toggleBookmark(state.examId, state.subjectId, state.topicId, state.subjectName, state.topicName);
  updateBookmarkBtnLabel();
});

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", async () => {
    document.querySelectorAll(".mode-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.mode = tab.dataset.mode;
    resetOutput();

    const pyqPickerWrap = document.getElementById("pyqPickerWrap");
    const difficultyLabel = document.getElementById("difficultyLabel");
    const difficultySelect = document.getElementById("difficultySelect");
    const normalOutputWrap = document.getElementById("normalOutputWrap");
    const doubtWrap = document.getElementById("doubtWrap");
    const flashcardsWrap = document.getElementById("flashcardsWrap");
    const diagnoseWrap = document.getElementById("diagnoseWrap");

    pyqPickerWrap.hidden = state.mode !== "pyq_solution";
    difficultyLabel.hidden = state.mode !== "practice";
    difficultySelect.hidden = state.mode !== "practice";
    doubtWrap.hidden = state.mode !== "doubt";
    flashcardsWrap.hidden = state.mode !== "flashcards";
    diagnoseWrap.hidden = state.mode !== "diagnose";
    normalOutputWrap.hidden = ["doubt", "flashcards", "diagnose"].includes(state.mode);

    if (state.mode === "pyq_solution") {
      await loadPyqPicker();
    }
  });
});

async function loadPyqPicker() {
  const picker = document.getElementById("pyqPicker");
  picker.innerHTML = `<p class="placeholder">Loading questions…</p>`;
  const res = await fetch(`${API}/pyqs/${state.examId}/${state.topicId}`);
  const data = await res.json();
  state.pyqListCache = data.pyqs || [];
  if (!data.pyqs || data.pyqs.length === 0) {
    picker.innerHTML = `<p class="placeholder">${data.message || "No PYQs seeded yet for this topic."}</p>`;
    return;
  }
  picker.innerHTML = "";
  data.pyqs.forEach((p) => {
    const item = document.createElement("div");
    item.className = "pyq-picker-item";
    item.textContent = `${p.year} — ${p.question_text}`;
    item.addEventListener("click", () => {
      state.selectedPyqId = p.pyq_id;
      state.selectedPyqText = p.question_text;
      state.selectedPyqYear = p.year;
      picker.querySelectorAll(".pyq-picker-item").forEach((el) => el.classList.remove("selected"));
      item.classList.add("selected");
    });
    picker.appendChild(item);
  });
}

function resetOutput() {
  document.getElementById("outputContent").innerHTML = `<p class="placeholder">Pick a mode above and hit Generate — content streams in live.</p>`;
  document.getElementById("downloadPdfBtn").hidden = true;
  state.lastGeneratedText = "";
  state.lastGeneratedQuestions = null;
}

// ---------------------------------------------------------------------------
// SSE streaming helper (fetch-based, since EventSource can't POST)
// ---------------------------------------------------------------------------
async function streamPost(url, body, onChunk, onError, onDone) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Request failed." }));
      onError(err.detail || "Request failed.");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop();
      for (const raw of events) {
        const lines = raw.split("\n");
        let eventType = "message";
        let data = [];
        for (const line of lines) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        const payload = data.join("\n");
        if (eventType === "error") {
          onError(payload);
        } else if (eventType === "done") {
          onDone(payload);
        } else {
          onChunk(payload);
        }
      }
    }
  } catch (e) {
    onError("Connection lost. Please retry.");
  }
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------
const generateBtn = document.getElementById("generateBtn");
generateBtn.addEventListener("click", () => {
  if (state.mode === "pyq_solution" && !state.selectedPyqId) {
    alert("Pick a previous-year question first.");
    return;
  }
  runGenerate();
});

const MODE_URL = {
  explain: "/explain",
  notes: "/notes",
  practice: "/practice",
  pyq_solution: "/pyq-solution",
};

function runGenerate() {
  const output = document.getElementById("outputContent");
  output.innerHTML = "";
  generateBtn.disabled = true;

  const extra =
    state.mode === "pyq_solution"
      ? { pyq_id: state.selectedPyqId }
      : state.mode === "practice"
        ? { count: 5, difficulty: document.getElementById("difficultySelect").value }
        : {};

  const body = {
    exam_id: state.examId,
    subject_id: state.subjectId,
    topic_id: state.topicId,
    mode: state.mode,
    language: document.getElementById("langSelect").value,
    extra,
  };

  let fullText = "";
  const url = API + MODE_URL[state.mode];

  streamPost(
    url,
    body,
    (chunk) => {
      fullText += chunk;
      if (state.mode !== "practice") {
        output.textContent = fullText;
      } else {
        output.textContent = "Generating practice set…";
      }
    },
    (errMsg) => {
      output.innerHTML = `<p class="error-msg">${errMsg}</p><button class="retry-btn" id="retryBtn">Retry</button>`;
      const retryBtn = document.getElementById("retryBtn");
      if (retryBtn) retryBtn.addEventListener("click", runGenerate);
      generateBtn.disabled = false;
    },
    () => {
      generateBtn.disabled = false;
      state.lastGeneratedText = fullText;
      recordStudyActivity();
      const topicKey = `${state.examId}:${state.subjectId}:${state.topicId}`;
      recordTopicProgress(topicKey);
      recordTopicEver(topicKey);
      if (state.mode === "practice") {
        state.lastGeneratedQuestions = renderPracticeSet(fullText, output);
      } else if (state.mode === "explain") {
        renderWithOptionalDiagram(fullText, output);
        state.lastGeneratedQuestions = null;
      } else {
        state.lastGeneratedQuestions = null;
      }
      document.getElementById("downloadPdfBtn").hidden = false;
    }
  );
}

// Detects a single ```mermaid fenced block in the response, renders it as an
// actual diagram, and shows the remaining text as normal plain prose.
function renderWithOptionalDiagram(text, output) {
  const match = text.match(/```mermaid\s*([\s\S]*?)```/);
  if (!match) {
    output.textContent = text;
    return;
  }
  const diagramSrc = match[1].trim();
  const remainingText = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();

  output.innerHTML = "";
  const before = document.createElement("p");
  before.style.whiteSpace = "pre-wrap";
  before.textContent = remainingText;
  output.appendChild(before);

  const diagramBox = document.createElement("div");
  diagramBox.className = "diagram-container";
  diagramBox.id = "diagram-" + Date.now();
  output.appendChild(diagramBox);

  if (window.mermaid) {
    try {
      window.mermaid
        .render(diagramBox.id + "-svg", diagramSrc)
        .then(({ svg }) => {
          diagramBox.innerHTML = svg;
        })
        .catch(() => {
          diagramBox.remove();
        });
    } catch (err) {
      diagramBox.remove();
    }
  }
}

function renderPracticeSet(text, output) {
  try {
    const cleaned = text.trim().replace(/^```json/, "").replace(/```$/, "");
    const questions = JSON.parse(cleaned);
    output.innerHTML = "";
    questions.forEach((q, i) => {
      const block = document.createElement("div");
      block.style.marginBottom = "18px";
      block.innerHTML = `<strong>${i + 1}. ${q.question}</strong>`;
      const list = document.createElement("div");
      list.style.marginTop = "8px";
      q.options.forEach((opt, idx) => {
        const row = document.createElement("div");
        row.style.padding = "4px 0";
        row.textContent = `${String.fromCharCode(65 + idx)}. ${opt}` + (idx === q.correct_option_index ? "  ✓" : "");
        list.appendChild(row);
      });
      block.appendChild(list);
      const exp = document.createElement("p");
      exp.style.color = "var(--text-dim)";
      exp.style.fontSize = "13px";
      exp.textContent = q.explanation || "";
      block.appendChild(exp);
      output.appendChild(block);
    });
    return questions;
  } catch (e) {
    output.textContent = text; // fall back to raw text if parsing fails
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ask a Doubt (open follow-up chat, scoped to the current topic)
// ---------------------------------------------------------------------------
function appendDoubtBubble(role, text) {
  const container = document.getElementById("doubtMessages");
  const placeholder = container.querySelector(".placeholder");
  if (placeholder) placeholder.remove();
  const bubble = document.createElement("div");
  bubble.className = `doubt-bubble ${role}`;
  bubble.textContent = text;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

function sendDoubt() {
  const input = document.getElementById("doubtInput");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  input.disabled = true;
  document.getElementById("doubtSendBtn").disabled = true;

  appendDoubtBubble("user", question);
  const assistantBubble = appendDoubtBubble("assistant", "…");
  let fullText = "";

  streamPost(
    `${API}/ask-doubt`,
    {
      exam_id: state.examId,
      subject_id: state.subjectId,
      topic_id: state.topicId,
      question,
      history: state.doubtHistory,
    },
    (chunk) => {
      fullText += chunk;
      assistantBubble.textContent = fullText;
      document.getElementById("doubtMessages").scrollTop = document.getElementById("doubtMessages").scrollHeight;
    },
    (errMsg) => {
      assistantBubble.textContent = errMsg;
      assistantBubble.classList.add("error-msg");
      input.disabled = false;
      document.getElementById("doubtSendBtn").disabled = false;
    },
    () => {
      state.doubtHistory.push({ role: "user", text: question });
      state.doubtHistory.push({ role: "assistant", text: fullText });
      recordStudyActivity();
      incrementStat("doubts_asked");
      input.disabled = false;
      document.getElementById("doubtSendBtn").disabled = false;
      input.focus();
    }
  );
}

document.getElementById("doubtSendBtn").addEventListener("click", sendDoubt);
document.getElementById("doubtInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendDoubt();
});


// ---------------------------------------------------------------------------
// Contest mode
// ---------------------------------------------------------------------------
function getNextContestUnlockDate() {
  return localStorage.getItem("exmentify_next_contest_unlock"); // ISO date or null
}
function setNextContestUnlockDate(isoDate) {
  localStorage.setItem("exmentify_next_contest_unlock", isoDate);
}
function isContestLocked() {
  const unlock = getNextContestUnlockDate();
  if (!unlock) return false;
  return new Date().toISOString().slice(0, 10) < unlock;
}
function updateContestButtonState() {
  const btn = document.getElementById("startContestBtn");
  const sub = btn.querySelector(".contest-cta-sub");
  if (isContestLocked()) {
    const unlock = getNextContestUnlockDate();
    const daysLeft = Math.max(
      1,
      Math.ceil((new Date(unlock) - new Date()) / 86400000)
    );
    btn.disabled = true;
    btn.classList.add("locked");
    sub.textContent = `Unlocks in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — ${unlock}`;
  } else {
    btn.disabled = false;
    btn.classList.remove("locked");
    sub.textContent = "Timed practice, zero leaderboard";
  }
}

document.getElementById("startContestBtn").addEventListener("click", () => {
  if (isContestLocked()) return; // button is disabled in this state anyway, this is just a safety guard
  openContestPicker();
});

const contestSelectedTopics = new Set();

function openContestPicker() {
  contestSelectedTopics.clear();
  const picker = document.getElementById("contestTopicPicker");
  picker.innerHTML = "";
  state.subjects.forEach((subject) => {
    const block = document.createElement("div");
    block.className = "contest-topic-picker-subject";
    const heading = document.createElement("h3");
    heading.textContent = subject.name;
    block.appendChild(heading);
    subject.topics.forEach((topic) => {
      const row = document.createElement("label");
      row.className = "contest-topic-checkbox";
      row.innerHTML = `
        <input type="checkbox" data-topic-id="${topic.topic_id}" data-topic-name="${topic.name}" />
        <span class="cb-name">${topic.name}</span>
        <span class="cb-count">${topic.weightage}</span>
      `;
      const checkbox = row.querySelector("input");
      checkbox.addEventListener("change", () => {
        row.classList.toggle("checked", checkbox.checked);
        if (checkbox.checked) {
          contestSelectedTopics.add(topic.topic_id);
        } else {
          contestSelectedTopics.delete(topic.topic_id);
        }
        updateBeginButtonState();
      });
      block.appendChild(row);
    });
    picker.appendChild(block);
  });
  updateBeginButtonState();
  showView("contestIntro");
}

function updateBeginButtonState() {
  const btn = document.getElementById("beginContestBtn");
  const n = contestSelectedTopics.size;
  btn.disabled = n === 0;
  btn.textContent = n === 0 ? "Select a topic to begin" : `Begin — ${n} topic${n > 1 ? "s" : ""} selected`;
}

document.getElementById("beginContestBtn").addEventListener("click", async () => {
  const topicIdToName = {};
  state.subjects.forEach((s) => s.topics.forEach((t) => (topicIdToName[t.topic_id] = t.name)));

  let pool = [];
  for (const topicId of contestSelectedTopics) {
    const r = await fetch(`${API}/contest-pyqs/${state.examId}/${topicId}`);
    const d = await r.json();
    if (d.pyqs) {
      d.pyqs.forEach((p) => (p.topic_name = topicIdToName[topicId]));
      pool = pool.concat(d.pyqs);
    }
  }
  if (pool.length === 0) {
    alert("No questions seeded yet for the topic(s) you picked — try selecting a different topic.");
    return;
  }
  pool = pool.sort(() => Math.random() - 0.5).slice(0, 5);

  state.contest = {
    questions: pool,
    index: 0,
    results: [],
    startedAt: Date.now(),
    contestId: "week_" + new Date().toISOString().slice(0, 10),
  };
  showView("contest");
  renderContestQuestion();
});

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];
let timerInterval = null;
let questionStart = null;

function renderContestQuestion() {
  const c = state.contest;
  const q = c.questions[c.index];
  document.getElementById("contestTopicLabel").textContent = q.topic_name || "";
  document.getElementById("contestQuestion").textContent = q.question_text;
  document.getElementById("contestProgress").textContent = `Question ${c.index + 1} of ${c.questions.length}`;
  document.getElementById("contestProgressBar").style.width = `${(c.index / c.questions.length) * 100}%`;
  const optionsEl = document.getElementById("contestOptions");
  optionsEl.innerHTML = "";
  q.options.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.className = "contest-option";
    btn.innerHTML = `<span class="contest-option-badge">${OPTION_LETTERS[idx]}</span><span>${opt}</span>`;
    btn.addEventListener("click", () => selectContestOption(idx, btn));
    optionsEl.appendChild(btn);
  });
  document.getElementById("contestNextBtn").disabled = true;

  questionStart = Date.now();
  clearInterval(timerInterval);
  timerInterval = setInterval(updateFlipClock, 200);
  updateFlipClock();
}

function updateFlipClock() {
  const elapsed = Math.floor((Date.now() - questionStart) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  document.getElementById("flipClock").textContent = `${mm}:${ss}`;
}

let answeredThisQuestion = false;
function selectContestOption(idx, btn) {
  if (answeredThisQuestion) return;
  answeredThisQuestion = true;
  clearInterval(timerInterval);
  const c = state.contest;
  const q = c.questions[c.index];
  const timeTaken = Math.floor((Date.now() - questionStart) / 1000);
  const correct = idx === q.correct_option_index;

  document.querySelectorAll(".contest-option").forEach((el, i) => {
    el.disabled = true;
    if (i === q.correct_option_index) el.classList.add("correct");
    if (i === idx && !correct) el.classList.add("incorrect");
  });
  btn.classList.add("selected");

  c.results.push({ topic_id: q.topic_id, correct, time_taken_seconds: timeTaken });
  document.getElementById("contestNextBtn").disabled = false;
}

document.getElementById("contestNextBtn").addEventListener("click", () => {
  const c = state.contest;
  answeredThisQuestion = false;
  c.index += 1;
  if (c.index >= c.questions.length) {
    document.getElementById("contestProgressBar").style.width = "100%";
    finishContest();
  } else {
    renderContestQuestion();
  }
});

function finishContest() {
  clearInterval(timerInterval);
  const c = state.contest;
  const session = {
    contest_id: c.contestId,
    scheduled_date: new Date().toISOString().slice(0, 10),
    rescheduled_to: null,
    questions: c.results.map((r) => ({ ...r })),
    status: "completed",
  };
  localStorage.setItem(`exmentify_contest_${c.contestId}`, JSON.stringify(session));
  renderScoreBreakdown();
  showView("results");
  loadContestFeedback();
  launchConfetti();
  recordStudyActivity();
  incrementStat("contests_completed");
  incrementStat("questions_answered", c.results.length);

  const defaultUnlock = new Date();
  defaultUnlock.setDate(defaultUnlock.getDate() + 7);
  setNextContestUnlockDate(defaultUnlock.toISOString().slice(0, 10));
}

function renderScoreBreakdown() {
  const results = state.contest.results;
  const correctCount = results.filter((r) => r.correct).length;
  const total = results.length;
  const pct = Math.round((correctCount / total) * 100);

  document.getElementById("scoreHeadline").innerHTML =
    `<span class="score-number">${correctCount}</span><span class="score-fraction">/${total}</span>`;

  const box = document.getElementById("scoreBreakdown");
  const dots = results
    .map((r) => `<span class="score-dot ${r.correct ? "correct" : "incorrect"}"></span>`)
    .join("");
  box.innerHTML = `
    <div class="score-number">${pct}%</div>
    <div class="score-label">${correctCount} of ${total} correct</div>
    <div class="score-dots">${dots}</div>
  `;
}

function loadContestFeedback() {
  const el = document.getElementById("feedbackContent");
  el.innerHTML = `<p class="placeholder">Generating your personalized feedback…</p>`;
  let fullText = "";
  streamPost(
    `${API}/contest-feedback`,
    { contest_id: state.contest.contestId, results: state.contest.results },
    (chunk) => {
      fullText += chunk;
      el.textContent = fullText;
    },
    (errMsg) => {
      el.innerHTML = `<p class="error-msg">${errMsg}</p><button class="retry-btn" id="retryFeedbackBtn">Retry</button>`;
      const retryBtn = document.getElementById("retryFeedbackBtn");
      if (retryBtn) retryBtn.addEventListener("click", loadContestFeedback);
    },
    () => { }
  );
}

document.getElementById("doneBtn").addEventListener("click", () => showView("subjects"));

// ---------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------
document.getElementById("rescheduleBtn").addEventListener("click", () => {
  const input = document.getElementById("rescheduleDate").value;
  const msgEl = document.getElementById("rescheduleMsg");
  if (!input) {
    msgEl.textContent = "Pick a date first.";
    msgEl.className = "reschedule-msg err";
    return;
  }
  const original = new Date();
  const chosen = new Date(input);
  const diffDays = Math.abs((chosen - original) / (1000 * 60 * 60 * 24));
  if (diffDays > 7) {
    msgEl.textContent = "That's more than 7 days from today — pick a date within a week so your rhythm stays consistent.";
    msgEl.className = "reschedule-msg err";
    return;
  }
  const key = `exmentify_contest_${state.contest.contestId}`;
  const session = JSON.parse(localStorage.getItem(key) || "{}");
  session.rescheduled_to = input;
  localStorage.setItem(key, JSON.stringify(session));
  setNextContestUnlockDate(input);
  msgEl.textContent = `Rescheduled — your next contest unlocks on ${input}.`;
  msgEl.className = "reschedule-msg ok";
});

// ---------------------------------------------------------------------------
// PDF export (client-side, via jsPDF — no backend involved)
// ---------------------------------------------------------------------------
const MODE_LABEL = {
  explain: "Explanation",
  notes: "Revision Notes",
  practice: "Practice Questions",
  pyq_solution: "PYQ Solution",
};

function newPdfDoc(title, subtitle) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const usableWidth = pageWidth - margin * 2;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, margin, y);
  y += 22;

  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(90, 90, 90);
    doc.text(subtitle, margin, y);
    doc.setTextColor(20, 20, 20);
    y += 20;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  function ensureSpace(lineHeight) {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y + lineHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function writeParagraph(text, opts = {}) {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 11);
    const lines = doc.splitTextToSize(text, usableWidth);
    lines.forEach((line) => {
      ensureSpace(16);
      doc.text(line, margin, y);
      y += opts.lineGap || 16;
    });
    y += opts.paraGap || 6;
  }

  return { doc, writeParagraph, ensureSpace, get y() { return y; } };
}

function savePdfSafely(doc, filename) {
  try {
    doc.save(filename);
  } catch (e) {
    try {
      const blobUrl = doc.output("bloburl");
      const win = window.open(blobUrl, "_blank");
      if (!win) {
        alert("Your browser blocked the PDF from opening. Allow pop-ups for this page, or try again on the deployed app.");
      }
    } catch (e2) {
      alert("Couldn't generate the PDF here. This works normally once the app is deployed and opened in a regular browser tab.");
    }
  }
}

function buildAndSavePdf() {
  const mode = state.mode;
  const label = MODE_LABEL[mode] || "Content";
  const subtitle = `${state.subjectName} — ${state.topicName}`;
  const filenameBase = `exmentify_${mode}_${state.topicId}`.replace(/[^a-z0-9_]/gi, "_");

  if (mode === "practice" && state.lastGeneratedQuestions) {
    const { doc, writeParagraph } = newPdfDoc(label, subtitle);
    state.lastGeneratedQuestions.forEach((q, i) => {
      writeParagraph(`${i + 1}. ${q.question}`, { bold: true, paraGap: 4 });
      q.options.forEach((opt, idx) => {
        const marker = idx === q.correct_option_index ? " (correct)" : "";
        writeParagraph(`${String.fromCharCode(65 + idx)}. ${opt}${marker}`, { size: 10.5, paraGap: 2 });
      });
      if (q.explanation) writeParagraph(q.explanation, { size: 10, paraGap: 14 });
    });
    savePdfSafely(doc, `${filenameBase}.pdf`);
    return;
  }

  if (mode === "pyq_solution") {
    const { doc, writeParagraph } = newPdfDoc(label, subtitle);
    if (state.selectedPyqText) {
      writeParagraph(`Question (${state.selectedPyqYear || "—"}): ${state.selectedPyqText}`, { bold: true, paraGap: 12 });
    }
    writeParagraph(state.lastGeneratedText || "No content generated yet.");
    savePdfSafely(doc, `${filenameBase}.pdf`);
    return;
  }

  const { doc, writeParagraph } = newPdfDoc(label, subtitle);
  const cleanText = (state.lastGeneratedText || "No content generated yet.").replace(
    /```mermaid\s*[\s\S]*?```/,
    "[Diagram shown in-app — not included in PDF export]"
  );
  writeParagraph(cleanText);
  savePdfSafely(doc, `${filenameBase}.pdf`);
}

document.getElementById("downloadPdfBtn").addEventListener("click", buildAndSavePdf);

function downloadPyqListPdf() {
  if (!state.pyqListCache || state.pyqListCache.length === 0) {
    alert("No PYQs loaded for this topic yet.");
    return;
  }
  const subtitle = `${state.subjectName} — ${state.topicName}`;
  const { doc, writeParagraph } = newPdfDoc("Previous Year Questions", subtitle);
  state.pyqListCache.forEach((p, i) => {
    writeParagraph(`${i + 1}. (${p.year}) ${p.question_text}`, { bold: true, paraGap: 4 });
    p.options.forEach((opt, idx) => {
      writeParagraph(`${String.fromCharCode(65 + idx)}. ${opt}`, { size: 10.5, paraGap: 2 });
    });
    writeParagraph("", { paraGap: 8 });
  });
  const filenameBase = `exmentify_pyqs_${state.topicId}`.replace(/[^a-z0-9_]/gi, "_");
  savePdfSafely(doc, `${filenameBase}.pdf`);
}
document.getElementById("downloadPyqListBtn").addEventListener("click", downloadPyqListPdf);

// ---------------------------------------------------------------------------
// Bookmarks view
// ---------------------------------------------------------------------------
document.getElementById("bookmarksNavBtn").addEventListener("click", () => {
  renderBookmarksView();
  showView("bookmarks");
});

function renderBookmarksView() {
  const list = document.getElementById("bookmarksList");
  const bookmarks = getBookmarks();
  if (bookmarks.length === 0) {
    list.innerHTML = `<p class="placeholder">No bookmarks yet — star a topic from any subject list to save it here.</p>`;
    return;
  }
  list.innerHTML = "";
  bookmarks.forEach((b) => {
    const item = document.createElement("div");
    item.className = "bookmark-item";
    item.innerHTML = `
      <div>
        <div class="bookmark-item-name">${b.topicName}</div>
        <div class="bookmark-item-sub">${b.subjectName}</div>
      </div>
      <button class="bookmark-remove-btn">Remove</button>
    `;
    item.addEventListener("click", async (e) => {
      if (e.target.closest(".bookmark-remove-btn")) return;
      state.examId = b.examId;
      const res = await fetch(`${API}/subjects/${b.examId}`);
      const data = await res.json();
      state.subjects = data.subjects;
      openTopic(b.subjectId, b.topicId, b.subjectName, b.topicName);
    });
    item.querySelector(".bookmark-remove-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleBookmark(b.examId, b.subjectId, b.topicId, b.subjectName, b.topicName);
      renderBookmarksView();
    });
    list.appendChild(item);
  });
}

// ---------------------------------------------------------------------------
// Study Plan
// ---------------------------------------------------------------------------
document.getElementById("studyPlanNavBtn").addEventListener("click", () => {
  showView("studyPlan");
});

document.getElementById("generateStudyPlanBtn").addEventListener("click", () => {
  const dateInput = document.getElementById("examDateInput").value;
  if (!dateInput) {
    alert("Pick your exam date first.");
    return;
  }
  if (!state.examId) {
    alert("Pick an exam from the home screen first, so I know which syllabus to plan around.");
    return;
  }
  const panel = document.getElementById("studyPlanPanel");
  const content = document.getElementById("studyPlanContent");
  const actions = document.getElementById("studyPlanActions");
  panel.hidden = false;
  actions.hidden = true;
  content.innerHTML = `<p class="placeholder">Building your plan…</p>`;
  let fullText = "";

  streamPost(
    `${API}/study-plan`,
    { exam_id: state.examId, exam_date: dateInput, focus_subjects: [] },
    (chunk) => {
      fullText += chunk;
      content.textContent = fullText;
    },
    (errMsg) => {
      content.innerHTML = `<p class="error-msg">${errMsg}</p><button class="retry-btn" id="retryPlanBtn">Retry</button>`;
      const retryBtn = document.getElementById("retryPlanBtn");
      if (retryBtn) retryBtn.addEventListener("click", () => document.getElementById("generateStudyPlanBtn").click());
    },
    () => {
      state.lastStudyPlanText = fullText;
      actions.hidden = false;
      recordStudyActivity();
    }
  );
});

document.getElementById("downloadStudyPlanBtn").addEventListener("click", () => {
  const { doc, writeParagraph } = newPdfDoc("Study Plan", state.examId || "");
  writeParagraph(state.lastStudyPlanText || "No plan generated yet.");
  savePdfSafely(doc, "exmentify_study_plan.pdf");
});

// ---------------------------------------------------------------------------
// Cheat Sheet (per subject) — structured card layout
// ---------------------------------------------------------------------------
const CHEAT_CARD_COLORS = ["var(--amber)", "var(--periwinkle)", "var(--teal)", "var(--coral)"];

function openCheatSheet(subjectId, subjectName) {
  document.getElementById("cheatSheetTitle").textContent = `${subjectName} — Cheat Sheet`;
  const content = document.getElementById("cheatSheetContent");
  content.innerHTML = `<p class="placeholder">Generating…</p>`;
  showView("cheatSheet");
  let fullText = "";

  streamPost(
    `${API}/cheat-sheet`,
    { exam_id: state.examId, subject_id: subjectId },
    (chunk) => {
      fullText += chunk;
      content.innerHTML = `<p class="placeholder">Generating…</p>`;
    },
    (errMsg) => {
      content.innerHTML = `<p class="error-msg">${errMsg}</p><button class="retry-btn" id="retryCheatBtn">Retry</button>`;
      const retryBtn = document.getElementById("retryCheatBtn");
      if (retryBtn) retryBtn.addEventListener("click", () => openCheatSheet(subjectId, subjectName));
    },
    () => {
      state.lastCheatSheetSubject = subjectName;
      try {
        const cleaned = fullText.trim().replace(/^```json/, "").replace(/```$/, "");
        const data = JSON.parse(cleaned);
        state.lastCheatSheetData = data;
        renderCheatSheetCards(data, content);
      } catch (e) {
        content.textContent = fullText; // fall back to raw text if parsing fails
        state.lastCheatSheetData = null;
      }
      recordStudyActivity();
    }
  );
}

function renderCheatSheetCards(data, content) {
  content.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "cheat-grid";
  data.forEach((topicBlock, i) => {
    const color = CHEAT_CARD_COLORS[i % CHEAT_CARD_COLORS.length];
    const card = document.createElement("div");
    card.className = "cheat-card";
    card.style.setProperty("--cheat-accent", color);
    const pointsHtml = topicBlock.points
      .map(
        (p, idx) => `
      <div class="cheat-point">
        <span class="cheat-point-num">${idx + 1}</span>
        <div>
          <div class="cheat-point-label">${p.label}</div>
          <div class="cheat-point-detail">${p.detail}</div>
        </div>
      </div>`
      )
      .join("");
    card.innerHTML = `<h3 class="cheat-card-title">${topicBlock.topic}</h3>${pointsHtml}`;
    grid.appendChild(card);
  });
  content.appendChild(grid);
}

document.getElementById("downloadCheatSheetBtn").addEventListener("click", () => {
  const { doc, writeParagraph } = newPdfDoc("Cheat Sheet", state.lastCheatSheetSubject || "");
  if (state.lastCheatSheetData) {
    state.lastCheatSheetData.forEach((topicBlock) => {
      writeParagraph(topicBlock.topic, { bold: true, size: 13, paraGap: 6 });
      topicBlock.points.forEach((p) => {
        writeParagraph(`${p.label} — ${p.detail}`, { size: 10.5, paraGap: 4 });
      });
      writeParagraph("", { paraGap: 8 });
    });
  } else {
    writeParagraph(state.lastGeneratedText || "No content generated yet.");
  }
  savePdfSafely(doc, "exmentify_cheat_sheet.pdf");
});

// ---------------------------------------------------------------------------
// Revision Booklet (combines Notes across every topic in a subject into one PDF)
// ---------------------------------------------------------------------------
async function generateRevisionBooklet(subjectId, subjectName, triggerBtn) {
  const subject = state.subjects.find((s) => s.subject_id === subjectId);
  if (!subject) return;
  const originalLabel = triggerBtn.textContent;
  const { doc, writeParagraph } = newPdfDoc("Revision Booklet", subjectName);

  for (let i = 0; i < subject.topics.length; i++) {
    const topic = subject.topics[i];
    triggerBtn.textContent = `Generating ${i + 1}/${subject.topics.length}…`;
    triggerBtn.disabled = true;

    const notesText = await new Promise((resolve) => {
      let fullText = "";
      streamPost(
        `${API}/notes`,
        {
          exam_id: state.examId,
          subject_id: subjectId,
          topic_id: topic.topic_id,
          mode: "notes",
          language: "english",
          extra: {},
        },
        (chunk) => {
          fullText += chunk;
        },
        () => resolve(`[Couldn't generate notes for ${topic.name} — skipped]`),
        () => resolve(fullText)
      );
    });

    writeParagraph(topic.name, { bold: true, size: 14, paraGap: 6 });
    writeParagraph(notesText, { paraGap: 16 });
  }

  triggerBtn.textContent = originalLabel;
  triggerBtn.disabled = false;
  const filenameBase = `exmentify_booklet_${subjectId}`.replace(/[^a-z0-9_]/gi, "_");
  savePdfSafely(doc, `${filenameBase}.pdf`);
  recordStudyActivity();
}

// ---------------------------------------------------------------------------
// Confetti (contest completion celebration)
// ---------------------------------------------------------------------------
function launchConfetti() {
  const canvas = document.getElementById("confettiCanvas");
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = "block";

  const colors = ["#E8A33D", "#8B7FD6", "#5FA8A0", "#D6602F"];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.3,
    size: 4 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    speedY: 2 + Math.random() * 3,
    speedX: -1.5 + Math.random() * 3,
    rotation: Math.random() * 360,
    rotationSpeed: -6 + Math.random() * 12,
  }));

  let frame = 0;
  const maxFrames = 150;
  function tick() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((p) => {
      p.x += p.speedX;
      p.y += p.speedY;
      p.rotation += p.rotationSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    if (frame < maxFrames) {
      requestAnimationFrame(tick);
    } else {
      canvas.style.display = "none";
    }
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Quote of the day
// ---------------------------------------------------------------------------
const MOTIVATIONAL_QUOTES = [
  "Consistency beats intensity. Show up today.",
  "You don't need to feel ready. You just need to start.",
  "Every topic you revise is a future exam question you'll recognize.",
  "Small daily progress beats a big last-minute cram.",
  "The syllabus is long. Your session doesn't have to be.",
  "Confusion today is just clarity in progress.",
  "You're not behind. You're exactly where your effort has taken you.",
  "One topic at a time. That's the whole strategy.",
  "Discipline is choosing between what you want now and what you want most.",
  "Your future self is counting on today's version of you.",
];

function renderQuoteOfDay() {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000
  );
  const quote = MOTIVATIONAL_QUOTES[dayOfYear % MOTIVATIONAL_QUOTES.length];
  const el = document.getElementById("quoteOfDay");
  if (el) el.textContent = `"${quote}"`;
}

// ---------------------------------------------------------------------------
// Daily goal + progress ring
// ---------------------------------------------------------------------------
const GOAL_RING_CIRCUMFERENCE = 263.9;

function getDailyGoalTarget() {
  return parseInt(localStorage.getItem("exmentify_daily_goal") || "3", 10);
}
function setDailyGoalTarget(n) {
  localStorage.setItem("exmentify_daily_goal", String(Math.max(1, Math.min(n, 10))));
}
function getTodayTopicSet() {
  const today = new Date().toISOString().slice(0, 10);
  const raw = localStorage.getItem(`exmentify_today_topics_${today}`);
  return new Set(raw ? JSON.parse(raw) : []);
}
function recordTopicProgress(topicKey) {
  const today = new Date().toISOString().slice(0, 10);
  const set = getTodayTopicSet();
  set.add(topicKey);
  localStorage.setItem(`exmentify_today_topics_${today}`, JSON.stringify([...set]));
  renderGoalRing();
}
function renderGoalRing() {
  const target = getDailyGoalTarget();
  const done = getTodayTopicSet().size;
  const pct = Math.min(done / target, 1);
  document.getElementById("goalRingFill").style.strokeDashoffset = String(
    GOAL_RING_CIRCUMFERENCE * (1 - pct)
  );
  document.getElementById("goalRingPct").textContent = `${Math.round(pct * 100)}%`;
  document.getElementById("goalProgressText").textContent = `${done} / ${target} topics`;

  const statusEl = document.getElementById("goalStatusText");
  if (done === 0) statusEl.textContent = "Let's get started";
  else if (pct < 1) statusEl.textContent = "Keep going";
  else statusEl.textContent = "Goal crushed! 🎉";
}
document.getElementById("goalIncreaseBtn").addEventListener("click", () => {
  setDailyGoalTarget(getDailyGoalTarget() + 1);
  renderGoalRing();
});
document.getElementById("goalDecreaseBtn").addEventListener("click", () => {
  setDailyGoalTarget(getDailyGoalTarget() - 1);
  renderGoalRing();
});

// ---------------------------------------------------------------------------
// Achievement badges
// ---------------------------------------------------------------------------
function getStat(key) {
  return parseInt(localStorage.getItem(`exmentify_stat_${key}`) || "0", 10);
}
function incrementStat(key, by = 1) {
  localStorage.setItem(`exmentify_stat_${key}`, String(getStat(key) + by));
}

const BADGE_DEFS = [
  { id: "streak_3", icon: "🔥", name: "3-Day Streak", desc: "Study 3 days in a row", check: () => computeStreak() >= 3 },
  { id: "streak_7", icon: "🔥", name: "7-Day Streak", desc: "Study 7 days in a row", check: () => computeStreak() >= 7 },
  { id: "first_contest", icon: "🏁", name: "First Contest", desc: "Complete a Weekly Contest", check: () => getStat("contests_completed") >= 1 },
  { id: "five_contests", icon: "🎯", name: "Contest Regular", desc: "Complete 5 Weekly Contests", check: () => getStat("contests_completed") >= 5 },
  { id: "fifty_questions", icon: "📚", name: "50 Questions", desc: "Answer 50 contest questions", check: () => getStat("questions_answered") >= 50 },
  { id: "first_bookmark", icon: "🔖", name: "Curator", desc: "Bookmark your first topic", check: () => getBookmarks().length >= 1 },
  { id: "explorer", icon: "🧭", name: "Explorer", desc: "Study 10 different topics", check: () => getExplorerCount() >= 10 },
  { id: "doubt_asker", icon: "💬", name: "Curious Mind", desc: "Ask 5 doubts", check: () => getStat("doubts_asked") >= 5 },
];

function getExplorerCount() {
  const raw = localStorage.getItem("exmentify_topics_ever");
  return raw ? JSON.parse(raw).length : 0;
}
function recordTopicEver(topicKey) {
  const raw = localStorage.getItem("exmentify_topics_ever");
  const set = new Set(raw ? JSON.parse(raw) : []);
  set.add(topicKey);
  localStorage.setItem("exmentify_topics_ever", JSON.stringify([...set]));
}

document.getElementById("badgesNavBtn").addEventListener("click", () => {
  renderBadgesView();
  showView("badges");
});

function renderBadgesView() {
  const container = document.getElementById("badgesList");
  container.innerHTML = "";
  BADGE_DEFS.forEach((badge) => {
    const earned = badge.check();
    const card = document.createElement("div");
    card.className = `badge-card ${earned ? "earned" : ""}`;
    card.innerHTML = `
      <div class="badge-icon">${badge.icon}</div>
      <div class="badge-name">${badge.name}</div>
      <div class="badge-desc">${badge.desc}</div>
    `;
    container.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// Flashcards
// ---------------------------------------------------------------------------
let flashcardState = { cards: [], index: 0 };

document.getElementById("generateFlashcardsBtn").addEventListener("click", () => {
  const stage = document.getElementById("flashcardStage");
  const nav = document.getElementById("flashcardNav");
  stage.innerHTML = `<p class="placeholder">Generating flashcards…</p>`;
  nav.hidden = true;
  let fullText = "";

  streamPost(
    `${API}/flashcards`,
    { exam_id: state.examId, subject_id: state.subjectId, topic_id: state.topicId, count: 8 },
    (chunk) => {
      fullText += chunk;
    },
    (errMsg) => {
      stage.innerHTML = `<p class="error-msg">${errMsg}</p><button class="retry-btn" id="retryFlashBtn">Retry</button>`;
      const retryBtn = document.getElementById("retryFlashBtn");
      if (retryBtn) retryBtn.addEventListener("click", () => document.getElementById("generateFlashcardsBtn").click());
    },
    () => {
      try {
        const cleaned = fullText.trim().replace(/^```json/, "").replace(/```$/, "");
        const cards = JSON.parse(cleaned);
        flashcardState = { cards, index: 0 };
        renderFlashcard();
        nav.hidden = false;
        recordStudyActivity();
      } catch (e) {
        stage.innerHTML = `<p class="error-msg">Couldn't parse the flashcard set. Try Generate again.</p>`;
      }
    }
  );
});

function renderFlashcard() {
  const { cards, index } = flashcardState;
  const stage = document.getElementById("flashcardStage");
  if (!cards.length) return;
  const card = cards[index];
  stage.innerHTML = `
    <div class="flashcard" id="flashcardEl">
      <div class="flashcard-face front">${card.front}</div>
      <div class="flashcard-face back">${card.back}</div>
      <div class="flashcard-hint">Click to flip</div>
    </div>
  `;
  document.getElementById("flashcardEl").addEventListener("click", (e) => {
    e.currentTarget.classList.toggle("flipped");
  });
  document.getElementById("flashcardProgress").textContent = `Card ${index + 1} of ${cards.length}`;
}
document.getElementById("flashcardPrevBtn").addEventListener("click", () => {
  if (flashcardState.index > 0) {
    flashcardState.index -= 1;
    renderFlashcard();
  }
});
document.getElementById("flashcardNextBtn").addEventListener("click", () => {
  if (flashcardState.index < flashcardState.cards.length - 1) {
    flashcardState.index += 1;
    renderFlashcard();
  }
});

// ---------------------------------------------------------------------------
// Diagnose My Mistake
// ---------------------------------------------------------------------------
document.getElementById("diagnoseBtn").addEventListener("click", () => {
  const questionText = document.getElementById("diagnoseQuestion").value.trim();
  const yourAnswer = document.getElementById("diagnoseYourAnswer").value.trim();
  const correctAnswer = document.getElementById("diagnoseCorrectAnswer").value.trim();
  if (!questionText || !yourAnswer) {
    alert("Fill in at least the question and your answer.");
    return;
  }
  const panel = document.getElementById("diagnosePanel");
  const content = document.getElementById("diagnoseContent");
  panel.hidden = false;
  content.innerHTML = `<p class="placeholder">Diagnosing…</p>`;
  let fullText = "";

  streamPost(
    `${API}/diagnose-mistake`,
    {
      exam_id: state.examId,
      subject_id: state.subjectId,
      topic_id: state.topicId,
      question_text: questionText,
      your_answer: yourAnswer,
      correct_answer: correctAnswer,
    },
    (chunk) => {
      fullText += chunk;
      content.textContent = fullText;
    },
    (errMsg) => {
      content.innerHTML = `<p class="error-msg">${errMsg}</p><button class="retry-btn" id="retryDiagnoseBtn">Retry</button>`;
      const retryBtn = document.getElementById("retryDiagnoseBtn");
      if (retryBtn) retryBtn.addEventListener("click", () => document.getElementById("diagnoseBtn").click());
    },
    () => recordStudyActivity()
  );
});

// ---------------------------------------------------------------------------
// Name entry (lightweight personalization, no real auth)
// ---------------------------------------------------------------------------
function getUserName() {
  return localStorage.getItem("exmentify_user_name") || "";
}
function setUserName(name) {
  localStorage.setItem("exmentify_user_name", name);
}
function renderGreeting() {
  const name = getUserName();
  const el = document.getElementById("userGreeting");
  const btn = document.getElementById("changeNameBtn");
  if (el) el.textContent = name ? `Welcome back, ${name} 👋` : "";
  if (btn) btn.hidden = !name;
}
function checkNameEntry() {
  const name = getUserName();
  if (!name) {
    document.getElementById("nameEntryOverlay").hidden = false;
    document.getElementById("nameInput").focus();
  } else {
    renderGreeting();
  }
}
function submitName() {
  const val = document.getElementById("nameInput").value.trim();
  if (!val) return;
  setUserName(val);
  document.getElementById("nameEntryOverlay").hidden = true;
  renderGreeting();
}
document.getElementById("nameSubmitBtn").addEventListener("click", submitName);
document.getElementById("nameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitName();
});
document.getElementById("changeNameBtn").addEventListener("click", () => {
  document.getElementById("nameInput").value = getUserName();
  document.getElementById("nameEntryOverlay").hidden = false;
  document.getElementById("nameInput").focus();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
renderStreak();
renderQuoteOfDay();
renderGoalRing();
checkNameEntry();
loadExams();
