# Mercado Livre Projection Worker Runtime

The Mercado Livre listing Projection worker runs as a process separate from
Next.js. It consumes only manually enqueued BullMQ jobs and does not contain a
scheduler, cron, repeatable job, delayed producer, or startup enqueue.

## Production policy

- Keep `MERCADO_LIVRE_PROJECTION_WORKER_ENABLED` absent or false in the web app.
- Start the dedicated Compose service only through the explicit
  `ml-projection-worker` profile.
- Run one worker replica initially. PostgreSQL advisory locks and generation
  lifecycle checks remain the final concurrency authority.
- The service has no public port and uses the same versioned image as the app.
- Stop it with Compose so Docker sends `SIGTERM` and allows the two-minute
  cooperative shutdown window.

Starting the worker never creates a job. A producer must explicitly enqueue a
sanitized job with `attempts=1`. Scheduling at a candidate cadence of 15
minutes remains a future decision and is not active.

## Controlled commands

Start exactly one dedicated worker:

```bash
docker compose --env-file .env.production -f docker-compose.yml \
  --profile ml-projection-worker up -d --no-deps ml-projection-worker
```

Stop the worker without touching the app, PostgreSQL, or Redis:

```bash
docker compose --env-file .env.production -f docker-compose.yml \
  --profile ml-projection-worker stop ml-projection-worker
```

Remove only the stopped worker container after evidence is collected:

```bash
docker compose --env-file .env.production -f docker-compose.yml \
  --profile ml-projection-worker rm -f ml-projection-worker
```
