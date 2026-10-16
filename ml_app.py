from fastapi import FastAPI
from ml.api import router

app = FastAPI(title="Exmentify ML")
app.include_router(router)


@app.get("/")
def root():
    return {"status": "ok"}