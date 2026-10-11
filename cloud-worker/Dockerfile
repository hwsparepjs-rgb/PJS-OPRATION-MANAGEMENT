FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PJS_CLOUD_WORKER_NAME=pjs-cloud-readonly \
    PJS_MAX_JOBS=6
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY analysis.py main.py ./
RUN useradd --create-home --uid 10001 oms && chown -R oms:oms /app
USER oms
CMD ["python", "main.py"]
