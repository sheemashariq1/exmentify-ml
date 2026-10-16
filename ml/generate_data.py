from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "attempts.csv"

TOPICS = [
    "Engineering Mathematics", "Discrete Mathematics", "Digital Logic",
    "Computer Organization", "Programming & Data Structures", "Algorithms",
    "Theory of Computation", "Compiler Design", "Operating Systems",
    "Databases", "Computer Networks",
]


def generate(n_users=250, attempts_per_user=30, seed=42):
    rng = np.random.default_rng(seed)
    rows = []
    for u in range(n_users):
        skill = {t: rng.beta(2, 2) for t in TOPICS}  # hidden true skill 0..1
        hist = {t: [] for t in TOPICS}
        last_day = {t: 0.0 for t in TOPICS}
        day = 0.0
        for _ in range(attempts_per_user):
            day += rng.uniform(0, 3)
            t = str(rng.choice(TOPICS))
            diff = int(rng.integers(1, 4))  # 1 easy, 2 medium, 3 hard
            past_acc = float(np.mean(hist[t])) if hist[t] else 0.5
            days_since = day - last_day[t] if hist[t] else 7.0
            # forgetting: more days since practice -> lower chance
            logit = 4 * (skill[t] - 0.5) - 0.8 * (diff - 2) - 0.05 * days_since
            p = 1 / (1 + np.exp(-logit))
            correct = int(rng.random() < p)
            time_taken = max(10.0, rng.normal(60 + 25 * diff - 30 * skill[t], 15))
            rows.append({
                "user_id": u, "topic": t, "difficulty": diff,
                "past_accuracy": round(past_acc, 3),
                "time_taken": round(float(time_taken), 1),
                "days_since_practice": round(float(days_since), 2),
                "correct": correct,
            })
            hist[t].append(correct)
            last_day[t] = day
    return pd.DataFrame(rows)


if __name__ == "__main__":
    OUT.parent.mkdir(exist_ok=True)
    df = generate()
    df.to_csv(OUT, index=False)
    print(f"Saved {len(df)} rows to {OUT}")
    print(df.head())