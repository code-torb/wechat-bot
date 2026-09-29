FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN useradd --uid 10001 --system executor
USER executor
CMD ["python", "-m", "file_executor.main"]
