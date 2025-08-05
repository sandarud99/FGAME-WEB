# Lugx Gaming - Backend Services

This repository contains the backend microservices for the Lugx Gaming platform. It includes services for managing game details and processing user orders. The project is structured as a monorepo, with each service having its own independent CI/CD pipeline.

## Technologies Used

- **Runtime:** Node.js
- **Database:** PostgreSQL
- **Containerization:** Docker
- **Orchestration:** Kubernetes (Amazon EKS)
- **CI/CD:** GitHub Actions
- **Registry:** Amazon ECR (Elastic Container Registry)
- **Testing:** Postman / Newman

## Repository Structure

- **/game-service**: The microservice responsible for handling all game-related data and logic.
- **/order-service**: The microservice for managing user orders, payments, and history.
- **/.github/workflows**: Contains the two separate CI/CD pipeline definitions for each service.
- **/*.yaml**: Kubernetes manifest files for deployments, services, and other cluster resources.

## CI/CD Pipeline

This repository uses two independent GitHub Actions workflows that automatically build, test, and deploy the microservices to Amazon EKS.

- **Trigger**: A push to the `main` branch with changes inside a service's specific folder (e.g., `game-service/`) will automatically trigger only the pipeline for that service.

- **Pipeline Stages**:
  1.  **Build & Push**: The workflow builds a new Docker image for the service and pushes it to a dedicated Amazon ECR repository.
  2.  **Deploy to EKS**: It securely connects to the EKS cluster and updates the corresponding Deployment with the new image tag, triggering a zero-downtime rolling update. This deploys to the `microservices` namespace.
  3.  **Run Integration Tests**: After a successful deployment, Newman runs a collection of Postman tests against the live service to verify its functionality.

### Required GitHub Secrets

To run the pipelines, the following secrets must be configured in the repository settings:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `EKS_CLUSTER_NAME`
- `ECR_REPOSITORY_GAME`
- `SERVICE_URL_GAME`
- `ECR_REPOSITORY_ORDER`
- `SERVICE_URL_ORDER`
