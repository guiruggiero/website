FROM --platform=linux/arm64 public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

RUN pip install --upgrade pip \
    && apt-get update && apt-get install -y \
    gcc \
    g++ \
    make \
    git \
    portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

# Fallback version for setuptools-scm when git metadata is missing
ENV SETUPTOOLS_SCM_PRETEND_VERSION=0.1.7

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY server.py agent.py ./

ENV HOST="0.0.0.0"
ENV PORT=8080

EXPOSE 8080

CMD ["python", "server.py"]
