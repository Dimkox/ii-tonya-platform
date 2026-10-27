FROM python@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
WORKDIR /app
COPY runtime/semantic-tags/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
COPY runtime/semantic-tags/engine.py runtime/semantic-tags/server.py runtime/semantic-tags/assets.json ./
USER 1000:1000
CMD ["python", "server.py"]
