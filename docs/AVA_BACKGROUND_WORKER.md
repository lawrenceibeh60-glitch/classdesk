# Ava background worker

Ava's long-running document tasks are stored in PostgreSQL and processed by a separate worker. Closing the voice panel or browser does not stop a queued task. The web API checks the worker heartbeat and refuses to enqueue work when no worker is online.

## Deployment configuration

The repository root contains `render.yaml`. It defines **only** the Ava background worker; it does not replace or redeploy the existing ClassDesk website. It is configured with automatic deployment disabled, runs database migrations before startup, and gives the worker time to finish a task during shutdown.

The worker uses the Render **Starter** background-worker plan in the Frankfurt region. Render does not offer a free plan for background workers, so creating this service has a recurring cost. Review the current price in Render before approving its first Blueprint sync.

After the feature branch is merged, create/review the Render Blueprint from this repository and supply these values privately in Render's initial Blueprint setup or the service Environment page. Do not put secrets in GitHub:

| Variable | Value to provide |
|---|---|
| `DATABASE_URL` | Direct PostgreSQL/Neon connection string used for Prisma migrations |
| `AI_BASE_URL` | HTTPS base URL for the configured OpenAI-compatible AI endpoint, without `/chat/completions` |
| `AI_API_KEY` | Server-side AI provider key |
| `AI_MODEL` | Exact model identifier enabled for the account |
| `S3_BUCKET` | Existing S3-compatible bucket name |
| `AWS_ENDPOINT_URL_S3` | S3-compatible endpoint URL |
| `AWS_ACCESS_KEY_ID` | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key |

`AWS_REGION` is set to `us-east-2` in the Blueprint and `AVA_WORKER_POLL_MS` defaults to `5000`. If the existing object-storage provider uses a different region, change that value to the provider's actual region before approving the Blueprint.

The worker uses the same production database and object-storage bucket as the website. Keep all credentials server-side; never put them in the Android app or browser bundle. The worker claims tasks transactionally, retries transient failures up to three times, and recovers stale running tasks. Generated PDFs are saved to object storage and registered in the ClassDesk document library.

## Verification

The worker heartbeat is stored in `AiWorkerState` and exposed to the authenticated Ava task screen. Ava background tasks should be considered ready only when the worker reports online and a real task completes successfully.

For local development, install dependencies, apply migrations to a development database, configure the variables above, and run:

```sh
npm run worker:ava
```

Do not point a local worker at production data while testing.
