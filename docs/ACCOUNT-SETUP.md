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

## Existing data

This change does not require a database migration. Both accounts work with the same existing ClassDesk database and shared class records. Account credentials are configured by the deployment environment; they are not stored in the public repository.
