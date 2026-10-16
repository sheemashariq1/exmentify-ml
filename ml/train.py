import json
from pathlib import Path
import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (ConfusionMatrixDisplay, RocCurveDisplay,
                             accuracy_score, classification_report, roc_auc_score)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parent.parent
CAT = ["topic"]
NUM = ["difficulty", "past_accuracy", "time_taken", "days_since_practice"]

df = pd.read_csv(ROOT / "data" / "attempts.csv")
X, y = df[CAT + NUM], df["correct"]
X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)


def make(clf):
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore"), CAT),
        ("num", StandardScaler(), NUM),
    ])
    return Pipeline([("pre", pre), ("clf", clf)])


candidates = {
    "LogisticRegression": make(LogisticRegression(max_iter=1000)),
    "GradientBoosting": make(GradientBoostingClassifier(random_state=42)),
}

best_name, best_model, best_auc = None, None, -1
for name, pipe in candidates.items():
    pipe.fit(X_tr, y_tr)
    auc = roc_auc_score(y_te, pipe.predict_proba(X_te)[:, 1])
    print(f"{name}: ROC-AUC = {auc:.3f}")
    if auc > best_auc:
        best_name, best_model, best_auc = name, pipe, auc

pred = best_model.predict(X_te)
acc = accuracy_score(y_te, pred)
print(f"\nBest model: {best_name}  accuracy={acc:.3f}  AUC={best_auc:.3f}")
print(classification_report(y_te, pred))

(ROOT / "models").mkdir(exist_ok=True)
(ROOT / "docs").mkdir(exist_ok=True)
joblib.dump(best_model, ROOT / "models" / "weak_topic_model.joblib")
(ROOT / "models" / "metrics.json").write_text(
    json.dumps({"model": best_name, "accuracy": round(acc, 3), "roc_auc": round(best_auc, 3)}, indent=2))

RocCurveDisplay.from_estimator(best_model, X_te, y_te)
plt.title(f"ROC curve - {best_name}")
plt.savefig(ROOT / "docs" / "roc_curve.png", dpi=150, bbox_inches="tight")
plt.close()
ConfusionMatrixDisplay.from_predictions(y_te, pred)
plt.title("Confusion matrix")
plt.savefig(ROOT / "docs" / "confusion_matrix.png", dpi=150, bbox_inches="tight")
print("Saved model and charts in models/ and docs/")