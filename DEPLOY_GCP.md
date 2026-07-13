# GCP Deployment Guide — Regulatory KYC App

This file contains a single, copy-pasteable step-by-step guide to deploy the services in this repository to Google Cloud (Cloud Run), push container images via Cloud Build / Artifact Registry, configure Pub/Sub, and start the frontend portal with authentication and an encrypted mock store.

--

## Assumptions
- You have the `gcloud` CLI installed and authenticated.
- Billing is enabled on the GCP project.
- You have permissions to create service accounts, Artifact Registry, Cloud Run services, Pub/Sub topics, and Secret Manager secrets.
- Default region used in examples: `europe-west3`. Replace `REGION` as needed.

Set variables used in examples (adjust for your environment). These mirror the names used in `deploy.sh` in this repo:

```bash
export PROJECT_ID=your-gcp-project-id
export REGION=europe-west3

# Resource names (same as deploy.sh)
export SERVICE_ACCOUNT=regulatory-agent@${PROJECT_ID}.iam.gserviceaccount.com
export TOPIC=regulatory-events
export DEAD_LETTER_TOPIC=${TOPIC}-dead-letter
export INGEST_SERVICE=regulatory-ingest
export PROCESSOR_SERVICE=regulatory-processor
export SUBSCRIPTION=regulatory-processor-sub
export IMAGE_REPOSITORY=regulatory-images
export IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${IMAGE_REPOSITORY}/regulatory-runtime:latest"

gcloud config set project $PROJECT_ID
gcloud config set run/region $REGION
```

## 1) Enable required APIs

```bash
gcloud services enable run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  pubsub.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  cloudscheduler.googleapis.com \
  iam.googleapis.com \
  logging.googleapis.com
```

## 2) Create a service account and grant minimal roles

```bash
gcloud iam service-accounts create regulatory-agent --display-name="Regulatory agent" || true

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/pubsub.publisher"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/run.invoker"
```

Note: prefer Workload Identity and least-privilege roles for production.

## 3) Create Artifact Registry (Docker repository)

```bash
gcloud artifacts repositories create ${IMAGE_REPOSITORY} \
  --repository-format=docker --location=$REGION
```

Verify repository:

```bash
gcloud artifacts repositories list --location=$REGION
```

## 4) Build & push container images

You can build images individually or use the provided `cloudbuild.yaml` to build all three images (ingest, processor, frontend-node).

Option A — build & push individually (simple):

```bash
# Ingest image (using the unified runtime image name if desired)
gcloud builds submit --tag ${IMAGE_NAME} -f Dockerfile.ingest .

# Processor image (same runtime image can be used with different CMDs/modules)
gcloud builds submit --tag ${IMAGE_NAME} -f Dockerfile.processor .

# Frontend Node server image (separate build into the artifact repo)
gcloud builds submit --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/${IMAGE_REPOSITORY}/frontend-node:latest -f frontend-node/Dockerfile.frontend frontend-node
```

Option B — build all images using `cloudbuild.yaml` (recommended for CI):

```bash
gcloud builds submit --config=cloudbuild.yaml --substitutions=_REGION=$REGION,_REPO=$REPO
```

Check pushed images:

```bash
gcloud artifacts docker images list ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}
```

## 5) Create Secret Manager secrets (session secret, encryption key, demo password)

```bash
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
DEMO_PASSWORD=changeMeNow

echo -n $SESSION_SECRET | gcloud secrets create SESSION_SECRET --data-file=-
echo -n $ENCRYPTION_KEY | gcloud secrets create ENCRYPTION_KEY --data-file=-
echo -n $DEMO_PASSWORD | gcloud secrets create DEMO_PASSWORD --data-file=-
```

Alternatively, create secrets via the GCP Console and add versions.

## 6) Deploy Cloud Run services

First, get the URL for your processor after deployment (used by the frontend). We'll deploy services in order: processor (private), ingest, frontend.

### 6.1 Deploy `regulatory-processor`

This service may need Vertex AI access and should not necessarily be public.

```bash
gcloud run deploy ${PROCESSOR_SERVICE} \
  --image=${IMAGE_NAME} \
  --platform=managed \
  --service-account=${SERVICE_ACCOUNT} \
  --region=${REGION} \
  --set-env-vars=GOOGLE_CLOUD_LOCATION=${REGION},GOOGLE_GENAI_USE_ENTERPRISE=True \
  --no-allow-unauthenticated
```

### 6.2 Deploy `regulatory-ingest`

```bash
gcloud run deploy ${INGEST_SERVICE} \
  --image=${IMAGE_NAME} \
  --platform=managed \
  --service-account=${SERVICE_ACCOUNT} \
  --region=${REGION} \
  --set-env-vars=PUBSUB_TOPIC=regulatory-events,GOOGLE_CLOUD_LOCATION=${REGION} \
  --allow-unauthenticated
```

### 6.3 Deploy `db-kyc-portal` (frontend Node server)

Get the processor URL so frontend can reach it (used to set `PROCESSOR_BASE`):

```bash
PROCESSOR_URL=$(gcloud run services describe regulatory-processor --platform=managed --region=$REGION --format='value(status.url)')
```

Deploy frontend and attach secrets as environment variables (Secret Manager integration):

```bash
gcloud run deploy db-kyc-portal \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/${IMAGE_REPOSITORY}/frontend-node:latest \
  --platform=managed \
  --allow-unauthenticated \
  --region=${REGION} \
  --set-env-vars=PROCESSOR_BASE=${PROCESSOR_URL} \
  --set-secrets=SESSION_SECRET=SESSION_SECRET:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest,DEMO_PASSWORD=DEMO_PASSWORD:latest
```

Notes:
- `--set-secrets` makes secrets available as environment variables inside the container. See Cloud Run docs for alternative mounting options.
- If you prefer the frontend to be private, drop `--allow-unauthenticated` and manage access via IAM.

## 7) Configure Pub/Sub topic and push subscription

Create the Pub/Sub topic used by the ingest service:

```bash
gcloud pubsub topics create ${TOPIC}
```

Create a push subscription that forwards messages to the processor's `/events` endpoint. Use the service account `regulatory-svc` for authenticated push.

```bash
PROCESSOR_URL=$(gcloud run services describe regulatory-processor --platform=managed --region=$REGION --format='value(status.url)')

gcloud pubsub subscriptions create ${SUBSCRIPTION} \
  --topic=${TOPIC} \
  --push-endpoint="${PROCESSOR_URL}/events" \
  --push-auth-service-account=${SERVICE_ACCOUNT}
```

You may need to allow the Pub/Sub service identity to invoke the processor Cloud Run service. Find your project number and grant `roles/run.invoker` to the Pub/Sub push identity.

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
PUBSUB_SA=service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com

gcloud run services add-iam-policy-binding ${PROCESSOR_SERVICE} \
  --member="serviceAccount:${PUBSUB_SA}" --role="roles/run.invoker" --region=$REGION --platform=managed
```

## 8) Optional: Cloud Scheduler to trigger ingest periodically

```bash
INGEST_URL=$(gcloud run services describe regulatory-ingest --platform=managed --region=$REGION --format='value(status.url)')

gcloud scheduler jobs create http regulatory-ingest-cron \
  --schedule="*/15 * * * *" \
  --uri="${INGEST_URL}/ingest" \
  --http-method=POST \
  --oidc-service-account-email=${SA_EMAIL} \
  --time-zone="UTC"
```

## 9) Test and verify

Get list of Cloud Run services and URLs:

```bash
gcloud run services list --platform=managed --region=$REGION
```

Health checks and example requests:

```bash
# Processor health
curl -s $(gcloud run services describe regulatory-processor --platform=managed --region=$REGION --format='value(status.url)')/health

# Trigger ingest
curl -X POST $(gcloud run services describe regulatory-ingest --platform=managed --region=$REGION --format='value(status.url)')/ingest

# Open frontend in browser: use db-kyc-portal URL printed by deploy
```

Log troubleshooting:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=regulatory-processor" --limit=50 --project=$PROJECT_ID
gcloud builds list --project=$PROJECT_ID --limit=10
gcloud builds log BUILD_ID
```

## 10) Cleanup (if needed)

```bash
gcloud run services delete regulatory-ingest regulatory-processor db-kyc-portal --region=$REGION --platform=managed
gcloud pubsub subscriptions delete regulatory-events-sub
gcloud pubsub topics delete regulatory-events
gcloud artifacts repositories delete $REPO --location=$REGION --quiet
gcloud secrets delete SESSION_SECRET ENCRYPTION_KEY DEMO_PASSWORD
```

## 11) Production hardening checklist (recommended)
- Replace `passport-local` with enterprise OIDC/SAML IdP (Okta/Keycloak) for authentication.
- Use Workload Identity to map serverless identities to IAM instead of service account keys.
- Store encryption keys in KMS and grant access via IAM; do not bake keys in environment variables.
- Use VPC egress, private Cloud Run (serverless VPC), or serverless connector for secure network connectivity to internal resources.
- Configure monitoring/alerts for Cloud Run, Pub/Sub errors, and Vertex AI quotas.

---

If you want, I can next:
- generate a `cloudbuild` trigger that builds and deploys on commits, or
- produce Terraform manifests to provision Artifact Registry, Cloud Run, Pub/Sub, Scheduler, and Secret Manager automatically.

Pick one and I will add it to the repo.
