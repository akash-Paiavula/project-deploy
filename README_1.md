# Todo App — React + FastAPI on EKS with GitHub Actions CI/CD

```
app/
├── backend/                 FastAPI app + production Dockerfile
│   ├── app/main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                 React (Vite) app + production Dockerfile (nginx)
│   ├── src/
│   ├── package.json
│   ├── nginx.conf
│   └── Dockerfile
├── k8s/                       Kubernetes manifests (kustomize)
│   ├── namespace.yaml
│   ├── backend-deployment.yaml / backend-service.yaml
│   ├── frontend-deployment.yaml / frontend-service.yaml
│   ├── ingress.yaml
│   └── kustomization.yaml
└── .github/workflows/deploy.yml   CI/CD pipeline
```

How it fits together: the browser only ever talks to the **frontend** pod.
Its nginx config serves the built React app and reverse-proxies any request
under `/api/*` to the **backend** Service over the cluster's internal DNS —
so there's no CORS to configure and only one thing needs to be exposed to
the internet (the frontend, via an ALB Ingress).

---

## 1. Try it locally first

```bash
cd backend && docker build -t todo-backend . && cd ..
cd frontend && docker build -t todo-frontend . && cd ..

docker network create todo-net
docker run -d --network todo-net --name backend-service todo-backend
docker run -d --network todo-net -p 8080:80 todo-frontend
```

Open http://localhost:8080 — the frontend's nginx will proxy `/api` calls
to the `backend-service` container by name, same as it will in Kubernetes.

---

## 2. One-time AWS setup

You need: an EKS cluster, two ECR repos, and a way for GitHub Actions to
authenticate to AWS **without long-lived access keys** (OIDC federation).

### 2.1 Create the EKS cluster

The quickest path is `eksctl` (installs VPC, node group, everything):

```bash
eksctl create cluster \
  --name todo-cluster \
  --region ap-south-1 \
  --nodegroup-name standard-workers \
  --node-type t3.medium \
  --nodes 2 --nodes-min 1 --nodes-max 3 \
  --managed
```

This takes ~15 minutes. Once done:

```bash
aws eks update-kubeconfig --name todo-cluster --region ap-south-1
kubectl get nodes     # sanity check
```

### 2.2 Create the ECR repositories

```bash
aws ecr create-repository --repository-name todo-backend  --region ap-south-1
aws ecr create-repository --repository-name todo-frontend --region ap-south-1
```

### 2.3 Install the AWS Load Balancer Controller

The `Ingress` in `k8s/ingress.yaml` provisions an ALB through this
controller, so it must be running in the cluster first:

```bash
eksctl utils associate-iam-oidc-provider --cluster todo-cluster --approve

# IAM policy + service account (see AWS docs for exact policy JSON):
# https://docs.aws.amazon.com/eks/latest/userguide/lbc-helm.html
helm repo add eks https://aws.github.io/eks-charts
helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=todo-cluster \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller
```

### 2.4 Let GitHub Actions assume an AWS role (OIDC — no static keys)

```bash
# 1. Register GitHub's OIDC provider with your AWS account (one-time per account)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# 2. Create a role trusting only YOUR repo, and attach ECR + EKS permissions
#    (trust policy example — replace ACCOUNT_ID, ORG/REPO)
```

Trust policy (`trust-policy.json`):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<ORG>/<REPO>:ref:refs/heads/main" }
    }
  }]
}
```

```bash
aws iam create-role --role-name github-actions-deploy-role \
  --assume-role-policy-document file://trust-policy.json

aws iam attach-role-policy --role-name github-actions-deploy-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser

# EKS access: map this IAM role to a Kubernetes RBAC identity
eksctl create iamidentitymapping \
  --cluster todo-cluster \
  --arn arn:aws:iam::<ACCOUNT_ID>:role/github-actions-deploy-role \
  --group system:masters \
  --username github-actions
```
(`system:masters` is simplest to get started; for a real setup scope this
down to a role limited to the `todo-app` namespace.)

### 2.5 Configure the GitHub repo

In **Settings → Secrets and variables → Actions**:

| Type | Name | Value |
|---|---|---|
| Secret | `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/github-actions-deploy-role` |
| Variable | `AWS_REGION` | `ap-south-1` |
| Variable | `EKS_CLUSTER_NAME` | `todo-cluster` |

---

## 3. Push and watch it deploy

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/<ORG>/<REPO>.git
git push -u origin main
```

Every push to `main` triggers `.github/workflows/deploy.yml`, which:
1. Assumes the AWS role via OIDC (no stored keys).
2. Builds the backend and frontend Docker images.
3. Pushes both to ECR, tagged with the short git SHA **and** `latest`.
4. Points `k8s/kustomization.yaml` at the new tag and runs `kubectl apply -k .`.
5. Waits for the rollout to finish before ending the run.

Get the public URL once it's live:

```bash
kubectl get ingress todo-ingress -n todo-app
# ADDRESS column = the ALB's DNS name, e.g. k8s-todoapp-...elb.amazonaws.com
```

---

## 4. Notes / next steps

- **HTTPS**: request an ACM certificate for your domain, then uncomment the
  `certificate-arn` and `listen-ports` annotations in `k8s/ingress.yaml`.
- **Database**: the backend currently keeps todos in memory (resets on pod
  restart) — swap in RDS/Postgres or DynamoDB for anything real.
- **Secrets**: use Kubernetes `Secret`s or AWS Secrets Manager (via the
  Secrets Store CSI driver) for anything sensitive — never bake secrets
  into the image or plain ConfigMaps.
- **Autoscaling**: add a `HorizontalPodAutoscaler` per Deployment once you
  have real traffic patterns to tune against.
- **Cleanup**: `eksctl delete cluster --name todo-cluster --region ap-south-1`
  removes everything eksctl created (and stops the billing).
