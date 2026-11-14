# ClassDesk two-account setup

ClassDesk is configured for exactly two private accounts. There is no public registration endpoint.

## Configure the credentials

Generate a separate bcrypt hash for each account on a trusted local machine:

```bash
node scripts/hash-password.mjs 'your-long-unique-password'
```

Run the command twice with two different passwords. Copy each printed hash directly into the matching server-side environment variable. Do not commit passwords or hashes to the repository, and do not use `NEXT_PUBLIC_` variables.

Set these variables in the Render service environment:

| Variable | Purpose | Default username |
|---|---|---|
| `CLASS_REP_USERNAME` | Primary administrator username | `classrep` |
| `CLASS_REP_PASSWORD_HASH` | Primary administrator bcrypt hash | Required |
| `ASSISTANT_REP_USERNAME` | Assistant account username | `assistantrep` |
| `ASSISTANT_REP_PASSWORD_HASH` | Assistant bcrypt hash | Required |
| `SESSION_SECRET` | Random secret of at least 32 characters for signing sessions | Required |

Usernames are case-insensitive. Choose distinct usernames of at least three characters. Use a unique password for each account.

After the two new account hashes are configured, remove the legacy `ADMIN_PASSWORD_HASH` variable. It is accepted only as a temporary fallback for the primary account while migrating older deployments; it does not create a third account.

## Permission model

- **Class Representative:** full administration, including deletion, announcement approval/publication/archive, backup restore/export and system settings.
- **Assistant Class Representative:** can access shared class information and create or edit ordinary class materials and announcement drafts. The assistant cannot delete shared records or documents, approve/publish/archive announcements, restore or export full backups, or access system settings.

These restrictions are enforced by server-side API checks, not only by hiding interface controls.

## PostgreSQL (Neon)

Configure both connection strings in the deployment environment:

- `DATABASE_URL`: Neon direct connection. Prisma CLI schema migrations use this URL.
- `DATABASE_URL_POOLED`: Neon pooled connection. The running Next.js application prefers this URL to reduce connection pressure and falls back to `DATABASE_URL` if it is absent.

Keep the complete connection strings private. Do not commit them to Git or expose them through `NEXT_PUBLIC_` variables. Apply schema changes with `npm run db:migrate` after setting the direct `DATABASE_URL`.

## Shared file storage (Neon Object Storage)

ClassDesk uses the AWS S3 SDK and accepts Neon Object Storage's environment names directly:

| Variable | Purpose |
|---|---|
| `AWS_ENDPOINT_URL_S3` | S3-compatible Neon Object Storage endpoint |
| `AWS_ACCESS_KEY_ID` | Storage access key |
| `AWS_SECRET_ACCESS_KEY` | Storage secret |
| `AWS_REGION` | Storage region |
| `S3_BUCKET` | Existing bucket name |

The existing `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_REGION` names remain supported for compatibility. If both forms are set, the `AWS_*` values take precedence. Configure the bucket and all three AWS endpoint/credential values in production. The storage adapter requires a bucket, endpoint, access key and secret in production and fails closed if any are missing.

PostgreSQL stores structured class information, document metadata, and searchable extracted text. Object storage keeps original uploaded files. Production uploads and backup restores that contain original files fail explicitly when shared storage is unavailable; they will not silently report success while losing original file bytes.

## Existing data

Both accounts use the same configured PostgreSQL database and shared class records. Account credentials are configured by the deployment environment; they are not stored in the repository.
