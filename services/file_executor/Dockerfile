FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN useradd --uid 10001 --system executor
RUN mkdir -p /executor-io /var/lib/file-executor && chown -R executor:executor /executor-io /var/lib/file-executor
USER executor
CMD ["python", "-m", "file_executor.main"]
