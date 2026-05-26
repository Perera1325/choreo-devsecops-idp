import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

let db: admin.firestore.Firestore | null = null;

try {
  const saPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (fs.existsSync(saPath)) {
    const serviceAccount = require(saPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('Firebase Admin SDK initialized successfully.');
  } else {
    console.warn('serviceAccountKey.json not found. Run with local credentials to seed Firestore.');
  }
} catch (err) {
  console.error('Failed to initialize Firebase Admin SDK:', err);
}

const seedData = async () => {
  if (!db) {
    console.log('Cannot seed database: Firebase connection is missing.');
    return;
  }

  console.log('Starting Firestore Seeding...');

  // 1. Seed Deployments
  const deployments = [
    {
      name: "gateway-service",
      namespace: "devsecops",
      status: "Healthy",
      replicas: 2,
      availableReplicas: 2,
      cpuUsage: 12,
      memoryUsage: 110,
      yamlConfig: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway-service
  namespace: devsecops
spec:
  replicas: 2
  selector:
    matchLabels:
      app: gateway-service
  template:
    metadata:
      labels:
        app: gateway-service
    spec:
      containers:
      - name: gateway
        image: Perera1325/devsecops-gateway:v1.2.0
        ports:
        - containerPort: 5000
        env:
        - name: WSO2_IS_JWKS_URL
          value: "https://is.wso2.local/oauth2/jwks"`,
      version: "v1.2.0"
    },
    {
      name: "ai-analysis-engine",
      namespace: "devsecops",
      status: "Healthy",
      replicas: 2,
      availableReplicas: 2,
      cpuUsage: 25,
      memoryUsage: 350,
      yamlConfig: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-analysis-engine
  namespace: devsecops
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ai-analysis-engine
  template:
    metadata:
      labels:
        app: ai-analysis-engine
    spec:
      containers:
      - name: ai-engine
        image: Perera1325/ai-analysis-engine:v1.0.1
        ports:
        - containerPort: 5001`,
      version: "v1.0.1"
    },
    {
      name: "payment-service",
      namespace: "devsecops",
      status: "Failed",
      replicas: 1,
      availableReplicas: 0,
      cpuUsage: 0,
      memoryUsage: 512,
      errorLogs: `[2026-05-26 07:15:32.410] INFO Starting PaymentService v1.4.0 on Port 8080...
[2026-05-26 07:15:35.890] INFO Connecting to Database: postgresql://db-user:****@db-service:5432/payment_db
[2026-05-26 07:15:37.110] INFO Loading cache modules and catalog database schemas...
[2026-05-26 07:15:40.320] ERROR Fatal Exception: Java heap space - Out Of Memory.
[2026-05-26 07:15:40.321] FATAL Container exited with status 137 (OOMKilled)
Kubelet: Container "payment-container" in Pod "payment-service-f8d9b6c-2k9ls" exceeded memory limits. Terminating pod.`,
      yamlConfig: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
  namespace: devsecops
spec:
  replicas: 1
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
    spec:
      containers:
      - name: payment-container
        image: Perera1325/payment-service:v1.4.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "128Mi"
            cpu: "50m"
          limits:
            memory: "256Mi"
            cpu: "200m"`,
      version: "v1.4.0"
    },
    {
      name: "wso2-apim-gateway",
      namespace: "wso2",
      status: "Healthy",
      replicas: 2,
      availableReplicas: 2,
      cpuUsage: 45,
      memoryUsage: 2048,
      yamlConfig: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: wso2-apim-gateway
  namespace: wso2
spec:
  replicas: 2
  serviceName: wso2-apim-svc
  template:
    spec:
      containers:
      - name: apim-gateway
        image: wso2/wso2am:4.2.0`,
      version: "4.2.0"
    },
    {
      name: "wso2-identity-server",
      namespace: "wso2",
      status: "Healthy",
      replicas: 2,
      availableReplicas: 2,
      cpuUsage: 35,
      memoryUsage: 2048,
      yamlConfig: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: wso2-identity-server
  namespace: wso2
spec:
  replicas: 2
  serviceName: wso2-is-svc
  template:
    spec:
      containers:
      - name: identity-server
        image: wso2/wso2is:6.1.0`,
      version: "6.1.0"
    }
  ];

  for (const dep of deployments) {
    await db.collection('deployments').doc(dep.name).set(dep);
    console.log(`Seeded deployment: ${dep.name}`);
  }

  // 2. Seed Trivy Vulnerability Reports
  const trivyReports = [
    {
      target: "Perera1325/devsecops-gateway:v1.2.0",
      scanner: "Trivy",
      scanDate: "2026-05-26T06:45:00Z",
      status: "Passed",
      vulnerabilities: [
        {
          id: "CVE-2023-45133",
          package: "express-body-parser",
          severity: "MEDIUM",
          installedVersion: "1.19.0",
          fixedVersion: "1.20.1",
          description: "Denial of service via resource exhaustion in JSON parsing payload."
        }
      ]
    },
    {
      target: "Perera1325/payment-service:v1.4.0",
      scanner: "Trivy",
      scanDate: "2026-05-26T07:10:00Z",
      status: "Failed",
      vulnerabilities: [
        {
          id: "CVE-2024-22243",
          package: "spring-core",
          severity: "CRITICAL",
          installedVersion: "5.3.20",
          fixedVersion: "5.3.27",
          description: "Spring Framework URL Parsing SSRF vulnerability."
        },
        {
          id: "CVE-2023-34053",
          package: "spring-security",
          severity: "HIGH",
          installedVersion: "5.7.1",
          fixedVersion: "5.7.8",
          description: "Bypass authorization check vulnerability under specific request formats."
        }
      ]
    },
    {
      target: "Perera1325/ai-analysis-engine:v1.0.1",
      scanner: "Trivy",
      scanDate: "2026-05-26T06:50:00Z",
      status: "Passed",
      vulnerabilities: []
    }
  ];

  for (const report of trivyReports) {
    const id = report.target.split('/').pop()?.split(':')[0] || 'default';
    await db.collection('trivy_reports').doc(id).set(report);
    console.log(`Seeded Trivy report for: ${id}`);
  }

  // 3. Seed SonarQube Reports
  const sonarReports = [
    {
      project: "devsecops-gateway",
      scanner: "SonarQube",
      scanDate: "2026-05-26T06:42:00Z",
      qualityGate: "PASSED",
      metrics: {
        bugs: 2,
        vulnerabilities: 0,
        securityHotspots: 1,
        codeSmells: 12,
        coverage: 88.5,
        duplicatedLinesDensity: 1.2
      }
    },
    {
      project: "payment-service",
      scanner: "SonarQube",
      scanDate: "2026-05-26T07:05:00Z",
      qualityGate: "FAILED",
      metrics: {
        bugs: 14,
        vulnerabilities: 5,
        securityHotspots: 8,
        codeSmells: 47,
        coverage: 42.1,
        duplicatedLinesDensity: 8.7
      }
    },
    {
      project: "ai-analysis-engine",
      scanner: "SonarQube",
      scanDate: "2026-05-26T06:48:00Z",
      qualityGate: "PASSED",
      metrics: {
        bugs: 0,
        vulnerabilities: 0,
        securityHotspots: 0,
        codeSmells: 3,
        coverage: 95.0,
        duplicatedLinesDensity: 0.0
      }
    }
  ];

  for (const report of sonarReports) {
    await db.collection('sonar_reports').doc(report.project).set(report);
    console.log(`Seeded SonarQube report for: ${report.project}`);
  }

  console.log('Seeding completed successfully!');
};

seedData().catch(err => {
  console.error('Error seeding data:', err);
});
