FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /app/requirements.txt
COPY helper.py socket_server.py make-parser-fixtures.py managed-private-parser.py /app/
WORKDIR /app
ENTRYPOINT ["python", "-I", "/app/managed-private-parser.py"]
