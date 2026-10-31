FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /app/requirements.txt
COPY helper.py socket_server.py /app/
COPY rus.traineddata eng.traineddata /models/
RUN echo 'e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225  /models/rus.traineddata' | sha256sum -c - && echo '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2  /models/eng.traineddata' | sha256sum -c -
USER 1000:1000
WORKDIR /app
ENTRYPOINT ["python", "-I", "/app/socket_server.py", "/run/private-parser/parser.sock", "1000"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["python", "-I", "-c", "import socket;s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(3);s.connect('/run/private-parser/parser.sock');s.close()"]
