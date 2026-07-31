# ---- Production Dockerfile: FastAPI backend ----

FROM python:3.12-slim AS base

# Prevent Python from writing .pyc files / buffering stdout
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first so this layer is cached unless requirements change
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY app ./app

# Run as a non-root user
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

# Basic container-level health check (EKS/K8s probes are configured separately)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
