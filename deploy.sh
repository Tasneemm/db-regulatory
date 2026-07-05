#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo your-project-id)}"
REGION="${REGION:-europe-west3}"
SERVICE_ACCOUNT="regulatory-agent@${PROJECT_ID}.iam.gserviceaccount.com"
TOPIC="regulatory-events"
DEAD_LETTER_TOPIC="${TOPIC}-dead-letter"
INGEST_SERVICE="regulatory-ingest"
PROCESSOR_SERVICE="regulatory-processor"
SUBSCRIPTION="regulatory-processor-sub"

export PROJECT_ID REGION

echo "Configuring Google Cloud resources in ${REGION} for ${PROJECT_ID}"
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com pubsub.googleapis.com aiplatform.googleapis.com iam.googleapis.com

gcloud iam service-accounts create regulatory-agent --project "$PROJECT_ID" 2>/dev/null || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SERVICE_ACCOUNT}" --role="roles/aiplatform.user" --condition=None
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SERVICE_ACCOUNT}" --role="roles/pubsub.publisher" --condition=None
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SERVICE_ACCOUNT}" --role="roles/pubsub.subscriber" --condition=None

gcloud pubsub topics create "$TOPIC" --project "$PROJECT_ID" 2>/dev/null || true
gcloud pubsub topics create "$DEAD_LETTER_TOPIC" --project "$PROJECT_ID" 2>/dev/null || true

gcloud run deploy "$INGEST_SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --allow-unauthenticated \
  --service-account "$SERVICE_ACCOUNT" \
  --source . \
  --dockerfile Dockerfile \
  --entry-point ingest:app \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=$REGION,GOOGLE_GENAI_USE_ENTERPRISE=True,PUBSUB_TOPIC=$TOPIC,APP_MODULE=ingest:app"

gcloud run deploy "$PROCESSOR_SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --no-allow-unauthenticated \
  --service-account "$SERVICE_ACCOUNT" \
  --source . \
  --dockerfile Dockerfile \
  --entry-point processor:app \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=$REGION,GOOGLE_GENAI_USE_ENTERPRISE=True,PUBSUB_TOPIC=$TOPIC,APP_MODULE=processor:app"

PROCESSOR_URL="$(gcloud run services describe "$PROCESSOR_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"

gcloud pubsub subscriptions create "$SUBSCRIPTION" \
  --project "$PROJECT_ID" \
  --topic "$TOPIC" \
  --push-endpoint "${PROCESSOR_URL%/}/events" \
  --push-auth-service-account "$SERVICE_ACCOUNT" \
  --ack-deadline=60 \
  --dead-letter-topic "$DEAD_LETTER_TOPIC" \
  2>/dev/null || true

echo "Deployment complete. Trigger the ingest service at: ${PROCESSOR_URL%/}/events"
