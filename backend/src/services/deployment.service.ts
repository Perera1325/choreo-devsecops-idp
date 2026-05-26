export interface DeploymentInfo {
  name: string;
  namespace: string;
  status: "Healthy" | "Degraded" | "Failed" | "Updating" | "Healing";
  replicas: number;
  availableReplicas: number;
  cpuUsage: number; // in percentage
  memoryUsage: number; // in Mi
  errorLogs?: string;
  yamlConfig: string;
  version: string;
}

export class DeploymentService {
  private static deployments: Map<string, DeploymentInfo> = new Map([
    [
      "gateway-service",
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
      }
    ],
    [
      "ai-analysis-engine",
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
      }
    ],
    [
      "payment-service",
      {
        name: "payment-service",
        namespace: "devsecops",
        status: "Failed",
        replicas: 1,
        availableReplicas: 0,
        cpuUsage: 0,
        memoryUsage: 512, // Exceeded limits
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
      }
    ],
    [
      "wso2-apim-gateway",
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
      }
    ],
    [
      "wso2-identity-server",
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
    ]
  ]);

  public static getAllDeployments(): DeploymentInfo[] {
    return Array.from(this.deployments.values());
  }

  public static getDeployment(name: string): DeploymentInfo | undefined {
    return this.deployments.get(name);
  }

  /**
   * Simulate a Self-Healing / Automated Remediation patch
   */
  public static triggerAutoHeal(name: string): boolean {
    const dep = this.deployments.get(name);
    if (!dep) return false;

    dep.status = "Healing";
    
    // Simulate updating limits and redeploying
    setTimeout(() => {
      dep.status = "Updating";
      dep.replicas = 2;
      dep.availableReplicas = 0;
      
      setTimeout(() => {
        dep.status = "Healthy";
        dep.availableReplicas = 2;
        dep.cpuUsage = 18;
        dep.memoryUsage = 380; // Stable memory now that limit is raised
        dep.errorLogs = undefined;
        // Update the YAML limits dynamically
        dep.yamlConfig = dep.yamlConfig.replace('256Mi', '1Gi').replace('128Mi', '512Mi');
        console.log(`[Auto-Healer] Successfully healed deployment: ${name}`);
      }, 3000);
    }, 2000);

    return true;
  }

  /**
   * Simulate a deployment rollback
   */
  public static triggerRollback(name: string): boolean {
    const dep = this.deployments.get(name);
    if (!dep) return false;

    dep.status = "Updating";
    dep.version = "v1.3.9"; // Rollback to older version
    
    setTimeout(() => {
      dep.status = "Healthy";
      dep.replicas = 1;
      dep.availableReplicas = 1;
      dep.cpuUsage = 8;
      dep.memoryUsage = 210;
      dep.errorLogs = undefined;
      dep.yamlConfig = dep.yamlConfig
        .replace("v1.4.0", "v1.3.9")
        .replace('256Mi', '512Mi'); // Adjust to previous stable setting
      console.log(`[Rollback-Engine] Rollback complete for ${name} to v1.3.9`);
    }, 4000);

    return true;
  }

  /**
   * Simulate scaling operations
   */
  public static scaleDeployment(name: string, replicas: number): boolean {
    const dep = this.deployments.get(name);
    if (!dep) return false;

    dep.status = "Updating";
    dep.replicas = replicas;
    
    setTimeout(() => {
      dep.status = "Healthy";
      dep.availableReplicas = replicas;
      console.log(`[Autoscaler] Scaled deployment ${name} to ${replicas} replicas`);
    }, 2000);

    return true;
  }

  /**
   * Trigger high load simulation on a service to show proactive scaling recommendations
   */
  public static triggerHighLoad(name: string): boolean {
    const dep = this.deployments.get(name);
    if (!dep) return false;

    dep.cpuUsage = 88;
    dep.memoryUsage = dep.memoryUsage * 1.4;
    return true;
  }
}
