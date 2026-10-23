from fastapi.responses import RedirectResponse

from fastapi import FastAPI
from ml.api import router

app = FastAPI(title="Exmentify ML")
app.include_router(router)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/ml/dashboard")

@app.get("/health")
def health():
    return {"status": "ok"}