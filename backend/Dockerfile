FROM python:3.11-slim

WORKDIR /app

RUN pip install uv

COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen
RUN uv run python -m spacy download en_core_web_sm

COPY . .

EXPOSE 8000

CMD ["uv", "run", "python", "run_agent.py"]
