# Cloud Build permission fix

The error indicates that the active Google account, `tasneemmulani@gmail.com`, does not currently have sufficient permission to submit Cloud Build jobs.

Run the following commands once from Cloud Shell or a local terminal with the correct project selected:

```bash
gcloud config set project <YOUR_PROJECT_ID>
gcloud projects add-iam-policy-binding <YOUR_PROJECT_ID> \
  --member="user:tasneemmulani@gmail.com" \
  --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding <YOUR_PROJECT_ID> \
  --member="user:tasneemmulani@gmail.com" \
  --role="roles/artifactregistry.writer"
```

If the project is in a restricted organization, you may also need the project owner or a Cloud Build Admin to grant these roles.
