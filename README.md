# Translate Service

FastAPI service for creating translation projects and processing Bengali source files with Celery jobs.

## Requirements

- Python 3.14+
- Redis
- `uv` recommended for dependency management
- A Gemini API key for image text extraction

## Setup

1. Create a virtual environment and install dependencies:

```bash
uv sync
```

If you are not using `uv`, install from `requirements.txt` in your own virtual environment.

2. Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_api_key_here
```

Optional environment variables:

```env
REDIS_URL=redis://127.0.0.1:6379
CELERY_BROKER_URL=redis://127.0.0.1:6379/0
CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/1
GEMINI_MODEL=gemini-3.1-flash-lite-preview
APP_HOST=127.0.0.1
APP_PORT=8000
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

## Run The App

### Option 1: Start everything with one command

This starts Redis, the Celery worker, and the FastAPI server together:

```bash
./start-services.sh
```

The API will be available at `http://127.0.0.1:8000`.

### Option 2: Start services manually

1. Start Redis:

```bash
redis-server --bind 127.0.0.1 --port 6379 --save "" --appendonly no
```

2. In a new terminal, start the Celery worker:

```bash
uv run python -m celery -A tasks.app worker --loglevel=info --pool=solo
```

3. In another terminal, start the API:

```bash
uv run python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

## What The Service Does

- Creates projects with one or more translation jobs
- Accepts text files and image files as job sources
- Extracts Bengali text from images with Gemini
- Translates Bengali text to English
- Stores project and job data in `translator.db`

## API Docs

Once the server is running, open:

- `http://127.0.0.1:8000/docs`
- `http://127.0.0.1:8000/redoc`
