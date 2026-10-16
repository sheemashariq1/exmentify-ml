import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from ml.generate_data import TOPICS

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "models" / "weak_topic_model.joblib"
STATE_PATH = ROOT / "data" / "user_state.json"
_lock = threading.Lock()
_model = None


def _get_model():
    global _model
    if _model is None:
        _model = joblib.load(MODEL_PATH)
    return _model


def _load():
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {}


def _save(state):
    STATE_PATH.write_text(json.dumps(state, indent=2))


def record_attempt(user, topic, correct, difficulty=2, time_taken=60.0, ts=None):
    ts = ts or datetime.now(timezone.utc)
    with _lock:
        state = _load()
        t = state.setdefault(user, {}).setdefault(
            topic, {"attempts": 0, "correct": 0, "avg_time": 60.0, "last_ts": None})
        t["avg_time"] = (t["avg_time"] * t["attempts"] + time_taken) / (t["attempts"] + 1)
        t["attempts"] += 1
        t["correct"] += int(correct)
        t["last_ts"] = ts.isoformat()
        _save(state)


def weak_topics(user):
    state = _load().get(user, {})
    now = datetime.now(timezone.utc)
    rows = []
    for topic in TOPICS:
        s = state.get(topic)
        if s and s["attempts"]:
            past_acc = s["correct"] / s["attempts"]
            days = (now - datetime.fromisoformat(s["last_ts"])).total_seconds() / 86400
            avg_time, attempts = s["avg_time"], s["attempts"]
        else:
            past_acc, days, avg_time, attempts = 0.5, 7.0, 60.0, 0
        rows.append({"topic": topic, "difficulty": 2, "past_accuracy": past_acc,
                     "time_taken": avg_time, "days_since_practice": days,
                     "_attempts": attempts})
    df = pd.DataFrame(rows)
    probs = _get_model().predict_proba(
        df[["topic", "difficulty", "past_accuracy", "time_taken", "days_since_practice"]])[:, 1]
    out = []
    for r, p in zip(rows, probs):
        out.append({"topic": r["topic"], "readiness_percent": round(float(p) * 100, 1),
                    "attempts": r["_attempts"]})
    out.sort(key=lambda x: x["readiness_percent"])
    for i, item in enumerate(out):
        item["status"] = "weak" if i < 4 else "medium" if i < 7 else "strong"
    return out


def next_question(user):
    weakest = weak_topics(user)[0]
    p = weakest["readiness_percent"]
    difficulty = 1 if p < 40 else 2 if p < 65 else 3
    return {"topic": weakest["topic"], "suggested_difficulty": difficulty,
            "readiness_percent": p}

def reset_user(user):
    with _lock:
        state = _load()
        state.pop(user, None)
        _save(state)

def seed_demo(user, n=120, seed=7):
    rng = np.random.default_rng(seed)
    reset_user(user)
    skill = {t: 0.5 for t in TOPICS}
    for t in ["Operating Systems", "Databases", "Algorithms", "Programming & Data Structures"]:
        skill[t] = 0.9
    for t in ["Theory of Computation", "Compiler Design", "Computer Networks"]:
        skill[t] = 0.1
    now = datetime.now(timezone.utc)
    events = []
    for _ in range(n):
        t = str(rng.choice(TOPICS))
        diff = int(rng.integers(1, 4))
        p = 1 / (1 + np.exp(-(4 * (skill[t] - 0.5) - 0.8 * (diff - 2))))
        events.append((now - timedelta(days=float(rng.uniform(0, 10))), t, diff,
                       bool(rng.random() < p), float(rng.normal(70, 15))))
    for ts, t, diff, ok, tt in sorted(events):
        record_attempt(user, t, ok, diff, max(10.0, tt), ts)