# Cloud deployment steps

1. Clone the repository
   ```bash
   git clone <repo-url>
   cd db-regulatory
   ```

2. Install required local tools
   - Google Cloud CLI (`gcloud`)
   - Docker
   - Python 3.11+

3. Authenticate to Google Cloud
   ```bash
   gcloud auth login
   gcloud config set project <YOUR_PROJECT_ID>
   ```

4. Enable the required Google Cloud APIs
   ```bash
   gcloud services enable run.googleapis.com pubsub.googleapis.com aiplatform.googleapis.com iam.googleapis.com
   ```

5. Set the deployment region and project variables
   ```bash
   export PROJECT_ID=<YOUR_PROJECT_ID>
   export REGION=europe-west3
   ```

6. Make the deployment script executable
   ```bash
   chmod +x deploy.sh
   ```

7. Run the deployment script
   ```bash
   ./deploy.sh
   ```

8. Verify the deployed services
   - Open the Google Cloud Console
   - Check the Cloud Run services
   - Test the health endpoints

9. Trigger the ingest workflow
   ```bash
   curl https://<ingest-service-url>/ingest
   ```

10. Review the processing results
   - The processor service will receive events from Pub/Sub and produce compliance assessments for the mock European clients.
