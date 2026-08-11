FROM python:3.11.15-slim-bookworm@sha256:d29f48a31a8b408ed19272ca1e7b10ebae13b240a27e862d3d4217c528e2e0c3

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TMPDIR=/tmp

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 65532 jarvis \
    && useradd --uid 65532 --gid jarvis --no-create-home --shell /usr/sbin/nologin jarvis

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN python -m pip install .

USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["python", "-m", "jarvis_api"]
