from dotenv import load_dotenv
load_dotenv()

from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from ml import predictor
from ml.generate_data import TOPICS
from ml.explain import build_chain

router = APIRouter(prefix="/ml", tags=["ML - Weak Topic Radar"])
ROOT = Path(__file__).resolve().parent.parent

class AttemptIn(BaseModel):
    user: str
    topic: str
    correct: bool
    difficulty: int = 2
    time_taken: float = 60.0


@router.get("/topics")
def topics():
    return TOPICS


@router.post("/attempt")
def attempt(a: AttemptIn):
    if a.topic not in TOPICS:
        raise HTTPException(400, "Unknown topic")
    predictor.record_attempt(a.user, a.topic, a.correct, a.difficulty, a.time_taken)
    return {"status": "recorded"}


@router.get("/weak-topics/{user}")
def weak(user: str):
    return predictor.weak_topics(user)


@router.get("/next-question/{user}")
def nxt(user: str):
    return predictor.next_question(user)


@router.post("/demo-seed/{user}")
def seed(user: str):
    predictor.seed_demo(user)
    return {"status": "seeded"}


@router.get("/dashboard")
def dashboard():
    return FileResponse(ROOT / "frontend" / "ml_dashboard.html")

@router.get("/explain/{user}")
def explain(user: str):
    nq = predictor.next_question(user)
    try:
        text = build_chain().invoke({
            "topic": nq["topic"],
            "difficulty": nq["suggested_difficulty"],
            "readiness": nq["readiness_percent"],
        })
    except Exception as e:
        raise HTTPException(503, f"Explanation unavailable: {e}")
    return {**nq, "content": text}

