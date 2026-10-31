FROM python@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
WORKDIR /app
COPY runtime/semantic-tags/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
COPY runtime/semantic-tags/engine.py runtime/semantic-tags/server.py runtime/semantic-tags/assets.json ./
USER 1000:1000
CMD ["python", "server.py"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["python", "-I", "-c", "import json,os,socket;s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(3);s.connect(os.environ.get('SEMANTIC_SOCKET','/run/semantic-tags/semantic.sock'));s.sendall(b'{\"operation\":\"state\"}\\n');data=s.makefile('rb').readline(4097);assert len(data)<=4096 and data.endswith(b'\\n');r=json.loads(data);assert r.get('ok') is True and r.get('result',{}).get('model');s.close()"]
