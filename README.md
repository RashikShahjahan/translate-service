# Translate Service

Bengali to English translation service

## Requirements

- Python 3.14+
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
OCR_MODEL=gemini-3.1-flash-lite-preview # Only gemini supported
TRANSLATION_MODEL=mlx-community/translategemma-12b-it-4bit # Only trnaslate gemma models supported
APP_HOST=127.0.0.1
APP_PORT=8000
```

## Run The App

### Option 1: Start everything with one command

This starts both the FastAPI server and the Huey worker:

```bash
./start-services.sh
```

The API will be available at `http://127.0.0.1:8000`.

### Option 2: Start the API manually

```bash
cd src
uv run python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### Option 3: Start only the worker

```bash
./start-worker.sh
```



## Notes
Currently only supports local deployment on Apple silicon computers.
The default local setup runs one API process and one worker process.


## API Docs

Once the server is running, open:

- `http://127.0.0.1:8000/docs`
- `http://127.0.0.1:8000/redoc`

## Todos
Batch inference
Scheduling
Add chunking
options for using API for translation and local model for ocr
english to bengali
