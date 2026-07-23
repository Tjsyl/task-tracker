FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY seed_users.py .

# SQLite file lives on a mounted volume so it survives container recreation.
RUN mkdir -p /data
ENV TASK_TRACKER_DB=/data/task_tracker.db

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
