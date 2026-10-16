"""
Exmentify backend — FastAPI app that serves the static frontend and
streams AI-generated exam-prep content from the Google Gemini API.
"""
import json
import os
import time
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

from google import genai
from google.genai import types as genai_types
from dotenv import load_dotenv, find_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR.parent / "frontend"

# Look for .env in a few likely places: wherever the terminal's current
# working directory is (walking upward), the project root (one level above
# backend/), and inside backend/ itself — covers every way people tend to
# run this locally, regardless of which folder their terminal is in.
load_dotenv(find_dotenv(usecwd=True))
load_dotenv(dotenv_path=BASE_DIR.parent / ".env")
load_dotenv(dotenv_path=BASE_DIR / ".env")

MODEL = "gemini-flash-lite-latest"

# API key is read only from the environment. Never hardcode it, never log it.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
client: Optional[genai.Client] = (
    genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
)

# Startup diagnostic — prints only whether a key was found, never the key
# itself. Check your terminal output if AI features say "not configured".
print(f"[Exmentify] GEMINI_API_KEY loaded: {bool(GEMINI_API_KEY)}", flush=True)

app = FastAPI(title="Exmentify API")


def load_json(filename: str) -> Any:
    with open(DATA_DIR / filename, "r", encoding="utf-8") as f:
        return json.load(f)


EXAMS = load_json("exams.json")["exams"]
SUBJECTS = load_json("subjects.json")
PYQS = load_json("pyqs.json")["pyqs"]

VALID_EXAM_IDS = {e["id"] for e in EXAMS}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    exam_id: str
    subject_id: str
    topic_id: str
    mode: str  # "explain" | "notes" | "practice" | "pyq_solution"
    language: str = "english"
    extra: dict = {}


class ContestResult(BaseModel):
    topic_id: str
    correct: bool
    time_taken_seconds: int


class ContestFeedbackRequest(BaseModel):
    contest_id: str
    results: list[ContestResult]


class DoubtMessage(BaseModel):
    role: str  # "user" | "assistant"
    text: str


class DoubtRequest(BaseModel):
    exam_id: str
    subject_id: str
    topic_id: str
    question: str
    history: list[DoubtMessage] = []


class StudyPlanRequest(BaseModel):
    exam_id: str
    exam_date: str  # ISO date, e.g. "2026-09-15"
    focus_subjects: list[str] = []  # subject_ids; empty = cover everything


class CheatSheetRequest(BaseModel):
    exam_id: str
    subject_id: str


class FlashcardRequest(BaseModel):
    exam_id: str
    subject_id: str
    topic_id: str
    count: int = 8


class DiagnoseMistakeRequest(BaseModel):
    exam_id: str
    subject_id: str
    topic_id: str
    question_text: str
    your_answer: str
    correct_answer: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_topic_meta(exam_id: str, subject_id: str, topic_id: str) -> Optional[dict]:
    """Validate that a topic actually belongs to the given exam/subject."""
    for subject in SUBJECTS.get(exam_id, []):
        if subject["subject_id"] == subject_id:
            for topic in subject["topics"]:
                if topic["topic_id"] == topic_id:
                    return {"subject": subject["name"], "topic": topic["name"]}
    return None


def sse_event(data: str, event: Optional[str] = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    # Each line of data must be prefixed individually per the SSE spec.
    payload = "\n".join(f"data: {line}" for line in data.split("\n")) or "data: "
    return f"{prefix}{payload}\n\n"


async def stream_gemini(system: str, user_prompt: str, max_tokens: int = 2000) -> AsyncGenerator[str, None]:
    if client is None:
        yield sse_event(
            "AI service is not configured (missing GEMINI_API_KEY). Please retry later.",
            event="error",
        )
        yield sse_event("error", event="done")
        return

    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            config = genai_types.GenerateContentConfig(
                system_instruction=system,
                max_output_tokens=max_tokens,
            )
            stream = client.models.generate_content_stream(
                model=MODEL,
                contents=user_prompt,
                config=config,
            )
            for chunk in stream:
                if chunk.text:
                    yield sse_event(chunk.text)
            yield sse_event("ok", event="done")
            return
        except Exception as e:
            # Log the real reason to the terminal for debugging — with the key
            # redacted, in case it ever ends up embedded in an error message —
            # while the browser only ever sees a safe, generic message.
            detail = str(e)
            if GEMINI_API_KEY:
                detail = detail.replace(GEMINI_API_KEY, "<redacted>")
            print(
                f"[Exmentify] Gemini call failed (attempt {attempt}/{max_attempts}): "
                f"{type(e).__name__}: {detail}",
                flush=True,
            )
            # Google's model endpoints occasionally return a transient 503
            # ("high demand") — worth a couple of quick automatic retries
            # before surfacing an error, since a retry often just succeeds.
            is_transient = "503" in detail or "UNAVAILABLE" in detail or "overloaded" in detail.lower()
            if is_transient and attempt < max_attempts:
                time.sleep(1.5 * attempt)
                continue
            # Never leak raw stack traces to the client — surface a graceful,
            # retry-able error state instead.
            yield sse_event(
                "Couldn't generate this right now. Please retry.", event="error"
            )
            yield sse_event("error", event="done")
            return


PLAIN_TEXT_RULE = (
    "Write in plain text only — no Markdown syntax at all (no #, ##, **, $$, backticks, "
    "or bullet dashes). Use plain paragraph breaks and, if needed, simple numbered lines "
    "like '1.' for structure. Write math inline in plain words or simple notation "
    "(e.g. 'O(n log n)', 'i * 20 + j') instead of LaTeX."
)

PROMPTS = {
    "explain": (
        "You are a patient, encouraging exam-prep tutor for Indian competitive exams. "
        "Explain the concept clearly with a short intuition, a worked example, and a one-line "
        "summary. Keep it focused and exam-relevant. "
        "If a simple diagram would meaningfully aid understanding (e.g. a tree, a graph, a "
        "state machine, a pipeline, a process flow), include exactly ONE Mermaid diagram, "
        "wrapped in a single fenced block starting with three backticks then 'mermaid' on its "
        "own line, and ending with three backticks on its own line. Place it right after the "
        "intuition section. Keep the diagram small (under 10 nodes). If a diagram would not "
        "genuinely help, omit it entirely — do not force one. "
        "Everywhere else in your response, write in plain text only — no Markdown, no LaTeX, "
        "no other code fences, no # or **."
    ),
    "notes": (
        "You are an exam-prep tutor. Produce crisp, bullet-point revision notes for the given "
        "topic — the kind a student would skim the night before an exam. Prioritize high-yield "
        "facts and common gotchas. For bullets, start each line with '- ' (a hyphen and a "
        "space) rather than a Markdown '*' or '•'. " + PLAIN_TEXT_RULE
    ),
    "practice": (
        "You are an exam question setter. Generate practice multiple-choice questions in the "
        "style of GATE Computer Science, at the difficulty level specified in the prompt. "
        "Return strictly a JSON array, each item shaped as "
        '{"question": str, "options": [str,str,str,str], "correct_option_index": int, '
        '"explanation": str}. Return only the JSON array, no prose, no markdown fences. '
        "Inside the question/explanation text, do not use Markdown or LaTeX — plain text only."
    ),
    "pyq_solution": (
        "You are an exam-prep tutor. Solve the given previous-year question step by step, "
        "explaining the reasoning at each step so the student learns the underlying method, "
        "not just the final answer. " + PLAIN_TEXT_RULE
    ),
}


LANGUAGE_INSTRUCTIONS = {
    "english": "Respond entirely in English.",
    "hindi": "Respond entirely in Hindi, using Devanagari script throughout your response.",
    "hinglish": "Respond in Hinglish throughout — a natural, conversational mix of Hindi and English written in Roman/English script (not Devanagari), the way Indian students actually talk to each other.",
}


def build_user_prompt(req: GenerateRequest, meta: dict) -> str:
    lang_instruction = LANGUAGE_INSTRUCTIONS.get(req.language, LANGUAGE_INSTRUCTIONS["english"])
    base = (
        f"Subject: {meta['subject']}\nTopic: {meta['topic']}\n"
        f"LANGUAGE INSTRUCTION (follow this strictly for your entire response): {lang_instruction}\n"
    )
    if req.mode == "practice":
        count = req.extra.get("count", 5)
        difficulty = req.extra.get("difficulty", "medium")
        return base + f"Generate {count} {difficulty}-difficulty practice questions on this topic."
    if req.mode == "pyq_solution":
        pyq_id = req.extra.get("pyq_id")
        pyq = next((p for p in PYQS if p["pyq_id"] == pyq_id), None)
        if not pyq:
            return base + "Solve a representative previous-year question on this topic."
        opts = "\n".join(f"{i}. {o}" for i, o in enumerate(pyq["options"]))
        return (
            base
            + f"Question: {pyq['question_text']}\nOptions:\n{opts}\n"
            + f"Correct option index: {pyq['correct_option_index']}\n"
            + "Explain step by step why this is correct and why the others are wrong."
        )
    if req.mode == "explain":
        return base + "Explain this topic to a student preparing for the exam."
    if req.mode == "notes":
        return base + "Generate revision notes for this topic."
    return base


# ---------------------------------------------------------------------------
# Routes — catalog
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/exams")
def get_exams():
    return {"exams": EXAMS}


@app.get("/api/subjects/{exam_id}")
def get_subjects(exam_id: str):
    if exam_id not in VALID_EXAM_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown exam_id '{exam_id}'.")
    return {"subjects": SUBJECTS.get(exam_id, [])}


@app.get("/api/pyqs/{exam_id}/{topic_id}")
def get_pyqs(exam_id: str, topic_id: str):
    if exam_id not in VALID_EXAM_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown exam_id '{exam_id}'.")
    valid_topics = {
        t["topic_id"] for s in SUBJECTS.get(exam_id, []) for t in s["topics"]
    }
    if topic_id not in valid_topics:
        raise HTTPException(
            status_code=400,
            detail=f"'{topic_id}' is not a valid topic under exam '{exam_id}'.",
        )
    matches = [p for p in PYQS if p["exam_id"] == exam_id and p["topic_id"] == topic_id]
    if not matches:
        return {"pyqs": [], "message": "Not seeded yet for this topic — check back soon."}
    # Never leak the correct answer in the list view.
    safe = [{k: v for k, v in p.items() if k != "correct_option_index"} for p in matches]
    return {"pyqs": safe}
@app.get("/api/contest-pyqs/{exam_id}/{topic_id}")
def get_contest_pyqs(exam_id: str, topic_id: str):
    if exam_id not in VALID_EXAM_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown exam_id '{exam_id}'.")
    valid_topics = {
        t["topic_id"] for s in SUBJECTS.get(exam_id, []) for t in s["topics"]
    }
    if topic_id not in valid_topics:
        raise HTTPException(
            status_code=400,
            detail=f"'{topic_id}' is not a valid topic under exam '{exam_id}'.",
        )
    matches = [p for p in PYQS if p["exam_id"] == exam_id and p["topic_id"] == topic_id]
    if not matches:
        return {"pyqs": [], "message": "Not seeded yet for this topic — check back soon."}
    # Contest mode needs correct_option_index client-side to grade instantly —
    # this endpoint is only ever called from the contest flow, never regular PYQ browsing.
    return {"pyqs": matches}

# ---------------------------------------------------------------------------
# Routes — AI generation (all streaming)
# ---------------------------------------------------------------------------

def validate_request(req: GenerateRequest) -> dict:
    if req.exam_id not in VALID_EXAM_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown exam_id '{req.exam_id}'.")
    meta = get_topic_meta(req.exam_id, req.subject_id, req.topic_id)
    if meta is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"'{req.topic_id}' does not belong to subject '{req.subject_id}' "
                f"under exam '{req.exam_id}'."
            ),
        )
    return meta


@app.post("/api/explain")
def explain(req: GenerateRequest):
    meta = validate_request(req)
    prompt = build_user_prompt(req, meta)
    return StreamingResponse(
        stream_gemini(PROMPTS["explain"], prompt, max_tokens=2500), media_type="text/event-stream"
    )


@app.post("/api/notes")
def notes(req: GenerateRequest):
    meta = validate_request(req)
    prompt = build_user_prompt(req, meta)
    return StreamingResponse(
        stream_gemini(PROMPTS["notes"], prompt, max_tokens=1200), media_type="text/event-stream"
    )


@app.post("/api/practice")
def practice(req: GenerateRequest):
    meta = validate_request(req)
    prompt = build_user_prompt(req, meta)
    return StreamingResponse(
        stream_gemini(PROMPTS["practice"], prompt, max_tokens=4000), media_type="text/event-stream"
    )


@app.post("/api/pyq-solution")
def pyq_solution(req: GenerateRequest):
    meta = validate_request(req)
    prompt = build_user_prompt(req, meta)
    return StreamingResponse(
        stream_gemini(PROMPTS["pyq_solution"], prompt, max_tokens=2500), media_type="text/event-stream"
    )


@app.post("/api/contest-feedback")
def contest_feedback(req: ContestFeedbackRequest):
    if not req.results:
        raise HTTPException(status_code=400, detail="No contest results provided.")
    lines = [
        f"- topic: {r.topic_id}, correct: {r.correct}, time_taken_seconds: {r.time_taken_seconds}"
        for r in req.results
    ]
    prompt = (
        "Here are a student's results from a weekly practice contest:\n"
        + "\n".join(lines)
        + "\n\nGive short, warm, personalized feedback on what to revise next. "
        "Never mention rank, score comparisons, or how other students performed — "
        "focus only on this student's own patterns (weak topics, slow topics, careless mistakes)."
    )
    system = (
        "You are a supportive, non-judgmental exam-prep coach. You never compare the student "
        "to others or mention leaderboards or ranks."
    )
    return StreamingResponse(stream_gemini(system, prompt, max_tokens=800), media_type="text/event-stream")


@app.post("/api/ask-doubt")
def ask_doubt(req: DoubtRequest):
    meta = get_topic_meta(req.exam_id, req.subject_id, req.topic_id)
    if meta is None:
        raise HTTPException(
            status_code=400,
            detail=f"'{req.topic_id}' does not belong to subject '{req.subject_id}' under exam '{req.exam_id}'.",
        )
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    history_lines = [f"{m.role}: {m.text}" for m in req.history[-6:]]  # cap context length
    history_block = ("\n".join(history_lines) + "\n") if history_lines else ""
    prompt = (
        f"Subject: {meta['subject']}\nTopic: {meta['topic']}\n"
        f"{history_block}"
        f"student: {req.question}"
    )
    system = (
        "You are a friendly exam-prep tutor answering a specific follow-up question about the "
        "given topic. Be direct and concise — a few sentences is usually enough, only go longer "
        "if the question genuinely needs it. " + PLAIN_TEXT_RULE
    )
    return StreamingResponse(stream_gemini(system, prompt, max_tokens=900), media_type="text/event-stream")


@app.post("/api/study-plan")
def study_plan(req: StudyPlanRequest):
    if req.exam_id not in VALID_EXAM_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown exam_id '{req.exam_id}'.")

    from datetime import date

    try:
        target_date = date.fromisoformat(req.exam_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="exam_date must be in YYYY-MM-DD format.")
    today = date.today()
    if target_date <= today:
        raise HTTPException(status_code=400, detail="Exam date must be in the future.")
    days_available = (target_date - today).days

    subjects_list = SUBJECTS.get(req.exam_id, [])
    if req.focus_subjects:
        subjects_list = [s for s in subjects_list if s["subject_id"] in req.focus_subjects]
    if not subjects_list:
        raise HTTPException(status_code=400, detail="No matching subjects found for this exam.")

    topic_lines = []
    for s in subjects_list:
        names = ", ".join(t["name"] for t in s["topics"])
        topic_lines.append(f"{s['name']}: {names}")

    prompt = (
        f"Today's date: {today.isoformat()}. Exam date: {target_date.isoformat()} "
        f"({days_available} days from now).\n"
        f"Topics to cover:\n" + "\n".join(topic_lines) + "\n\n"
        "Create a realistic day-by-day (or week-by-week if the timeframe is long) revision "
        "plan covering these topics, grouping related topics together, and including light "
        "buffer/revision days near the end. Be encouraging and realistic about pacing."
    )
    system = (
        "You are an experienced exam-prep coach building a personalized study schedule. "
        + PLAIN_TEXT_RULE
    )
    return StreamingResponse(stream_gemini(system, prompt, max_tokens=3000), media_type="text/event-stream")


@app.post("/api/cheat-sheet")
def cheat_sheet(req: CheatSheetRequest):
    if req.exam_id not in VALID_EXAM_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown exam_id '{req.exam_id}'.")
    subject = next(
        (s for s in SUBJECTS.get(req.exam_id, []) if s["subject_id"] == req.subject_id), None
    )
    if subject is None:
        raise HTTPException(
            status_code=400, detail=f"'{req.subject_id}' is not a valid subject under '{req.exam_id}'."
        )
    topic_names = [t["name"] for t in subject["topics"]]
    prompt = (
        f"Subject: {subject['name']}\nTopics: {', '.join(topic_names)}\n\n"
        "Create a compact, exam-ready cheat sheet: 4-6 high-yield facts, formulas, or "
        "definitions per topic that a student should have memorized."
    )
    system = (
        "You are creating a dense, high-yield reference sheet for last-minute exam revision. "
        "Return strictly a JSON array, each item shaped as "
        '{"topic": str, "points": [{"label": str, "detail": str}]}. '
        '"label" is a short term, formula name, or keyword (2-6 words). "detail" is a single, '
        "concise sentence explaining or defining it. 4-6 points per topic. Return only the "
        "JSON array, no prose, no markdown fences, no LaTeX — plain text only inside the strings."
    )
    return StreamingResponse(stream_gemini(system, prompt, max_tokens=3000), media_type="text/event-stream")


@app.post("/api/flashcards")
def flashcards(req: FlashcardRequest):
    meta = get_topic_meta(req.exam_id, req.subject_id, req.topic_id)
    if meta is None:
        raise HTTPException(
            status_code=400,
            detail=f"'{req.topic_id}' does not belong to subject '{req.subject_id}' under exam '{req.exam_id}'.",
        )
    count = max(1, min(req.count, 15))
    prompt = (
        f"Subject: {meta['subject']}\nTopic: {meta['topic']}\n"
        f"Generate {count} flashcards for spaced-repetition review of this topic."
    )
    system = (
        "You are creating flashcards for exam revision. Return strictly a JSON array, each "
        'item shaped as {"front": str, "back": str}. "front" is a short question, term, or '
        'prompt; "back" is the concise answer or definition. Return only the JSON array, no '
        "prose, no markdown fences. Keep both front and back short — one or two sentences max."
    )
    return StreamingResponse(stream_gemini(system, prompt, max_tokens=2000), media_type="text/event-stream")


@app.post("/api/diagnose-mistake")
def diagnose_mistake(req: DiagnoseMistakeRequest):
    meta = get_topic_meta(req.exam_id, req.subject_id, req.topic_id)
    if meta is None:
        raise HTTPException(
            status_code=400,
            detail=f"'{req.topic_id}' does not belong to subject '{req.subject_id}' under exam '{req.exam_id}'.",
        )
    if not req.question_text.strip() or not req.your_answer.strip():
        raise HTTPException(status_code=400, detail="Question and your answer are both required.")

    correct_line = f"\nCorrect answer (if known): {req.correct_answer}" if req.correct_answer.strip() else ""
    prompt = (
        f"Subject: {meta['subject']}\nTopic: {meta['topic']}\n"
        f"Question: {req.question_text}\nStudent's answer: {req.your_answer}{correct_line}\n\n"
        "Diagnose the likely misconception behind this specific wrong answer — not just why "
        "the correct answer is correct, but what mental model or mistake probably led the "
        "student here. Be specific and kind, not generic."
    )
    system = (
        "You are an exam-prep tutor specializing in diagnosing exactly why a student's "
        "answer went wrong, so they fix the underlying misunderstanding, not just this one "
        "question. " + PLAIN_TEXT_RULE
    )
    return StreamingResponse(stream_gemini(system, prompt, max_tokens=900), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Static frontend (mounted last so /api/* routes take precedence)
# ---------------------------------------------------------------------------

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
