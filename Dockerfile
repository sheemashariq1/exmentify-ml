FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY frontend ./frontend

ENV PORT=8000
EXPOSE 8000

# GEMINI_API_KEY is supplied at runtime via environment variables
# (e.g. AWS App Runner env vars) — never baked into the image.
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
