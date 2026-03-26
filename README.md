# Environment

- `OCR_MODEL`: OCR model name. Default: `gemini-3.1-flash-lite-preview`
- `TRANSLATION_MODEL`: Translation model name. Default: `mlx-community/translategemma-12b-it-4bit`
- `SOURCE_LANG_CODE`: Source language code for translation. Default: `bn`
- `TARGET_LANG_CODE`: Target language code for translation. Default: `en`
- `TRANSLATION_BATCH_SIZE`: Number of queued text files to translate per scheduled run. Default: `16`


# Todo

- Publish to docx command
- Failure/retry mechanisms
- Memory aware processing
- Stress test max batch size
- Run on entire book
