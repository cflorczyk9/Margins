# TODO

## V1.1 Ingestion And Maintenance

- Add real lint/health logic for stale summaries, missing tracker rows, and extraction gaps.
- Make ingest update tracker, log, and bucket overviews incrementally after each approved source.
- Add a true compile pass that promotes recurring concepts and entities from later ingests.

## Post-refactor

- **Stream the API ingest response.** Currently we fire one synchronous request to Gemini and wait for the full structured-JSON response (180s timeout). Long transcripts can push 60-120s of model latency, which makes the UI feel hung. Switch to streaming: render partial fields (summary first, then takeaways, then connections, etc.) as they arrive. Replaces the timeout-as-workaround with real progress signal. See `app.js:343` (`API_REQUEST_TIMEOUT_MS`) and `generateGeminiJsonContent`.
