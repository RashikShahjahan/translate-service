# Environment

- `OCR_MODEL`: OCR model name. Default: `gemini-3.1-flash-lite-preview`
- `TRANSLATION_MODEL`: Translation model name. Default: `mlx-community/translategemma-12b-it-4bit`
- `SOURCE_LANG_CODE`: Source language code for translation. Default: `bn`
- `TARGET_LANG_CODE`: Target language code for translation. Default: `en`
- `TRANSLATION_BATCH_SIZE`: Number of queued text files to translate per scheduled run. Default: `8`
- `TRANSLATION_MIN_AVAILABLE_MEMORY_MB`: Only start translation when current available memory is above this threshold. Default: `8192`


# CLI

- `python src/main.py publish-docx <project_name> <output.docx>`: Publish completed translated documents for a project into a Word document.

# Todo
- Packaging
- Failure detection
- Logging
- Running in background
- Run on entire book
- Blog post
