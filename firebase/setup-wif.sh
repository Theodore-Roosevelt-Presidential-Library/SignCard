#!/usr/bin/env bash
# One-time setup so the GitHub Action can read Firestore without a key file.
# Run in Google Cloud Shell (console.cloud.google.com, the >_ icon) as an owner of trpl-signcard.
# Safe to run twice: steps that already exist just report it.
set -u
PROJECT=trpl-signcard
REPO=Theodore-Roosevelt-Presidential-Library/SignCard
SA=signcard-actions@$PROJECT.iam.gserviceaccount.com
gcloud config set project $PROJECT
PN=$(gcloud projects describe $PROJECT --format='value(projectNumber)')

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com
gcloud iam service-accounts create signcard-actions --display-name="SignCard GitHub Action"
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="roles/datastore.user" --condition=None
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc signcard --location=global --workload-identity-pool=github \
  --display-name="SignCard repo" --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$REPO'"
gcloud iam service-accounts add-iam-policy-binding $SA --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
echo "Done. Project number: $PN (the workflow expects 762009281473)."
