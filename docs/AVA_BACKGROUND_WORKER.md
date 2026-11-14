# Ava background worker

Ava's document-processing jobs are persisted in PostgreSQL and executed by a separate worker process. The web request only creates the task; closing the voice panel or browser does not stop a queued or running task.

## Render background worker

Create a **Background Worker** service from the same repository and feature branch while this work is being tested.

- Build command: `npm install --no-audit --no-fund`
- Start command: `npm run worker:ava`
- Runtime: Node.js 20+
- Do not expose a public HTTP port.

Configure the same server-side environment variables used by the ClassDesk web service:

- `DATABASE_URL`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`
- `S3_BUCKET`
- `AWS_ENDPOINT_URL_S3`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Optional: `AVA_WORKER_POLL_MS` (defaults to 5000).

Never put provider or storage credentials in the Android app or browser bundle. The worker claims jobs transactionally using PostgreSQL row locks, retries transient failures up to three times, and recovers jobs left running after a worker interruption. Generated PDFs are saved to object storage and registered in the ClassDesk document library.

## Local verification

After installing dependencies and applying migrations to a development database:

```sh
npm run worker:ava
```

Do not point a local worker at production data while testing.
