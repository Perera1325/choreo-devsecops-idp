import axios from 'axios';

export interface ExplanationResponse {
  errorType: string;
  explanation: string;
  remediation: string;
  suggestedFix?: string; // YAML diff
}

export interface ChatResponse {
  answer: string;
  suggestedCommands?: string[];
}

export class AIService {
  private static geminiApiKey = process.env.GEMINI_API_KEY || '';
  private static openAiApiKey = process.env.OPENAI_API_KEY || '';

  /**
   * Explain deployment failures and provide recommendations
   */
  public static async explainFailure(logSnippet: string, deploymentYaml?: string): Promise<ExplanationResponse> {
    if (this.geminiApiKey) {
      try {
        return await this.callGeminiAPI(logSnippet, deploymentYaml);
      } catch (err) {
        console.error("Gemini API call failed, falling back to heuristic engine:", err);
      }
    }

    // Heuristic Fallback - provides high-quality, professional, context-specific responses
    return this.analyzeLogHeuristically(logSnippet, deploymentYaml);
  }

  /**
   * Suggest YAML fixes based on failure log and current YAML config
   */
  public static async suggestYamlFix(currentYaml: string, failureLog: string): Promise<string> {
    const analysis = await this.explainFailure(failureLog, currentYaml);
    return analysis.suggestedFix || "# No automated fix could be determined. Please verify resources and environment variables.";
  }

  /**
   * Predict infrastructure scaling based on CPU/Memory history
   */
  public static predictScaling(metricsHistory: { timestamp: string; cpu: number; memory: number }[]): {
    predictedCpu: number;
    predictedMemory: number;
    recommendedReplicas: number;
    reasoning: string;
  } {
    const avgCpu = metricsHistory.reduce((sum, item) => sum + item.cpu, 0) / metricsHistory.length;
    const avgMemory = metricsHistory.reduce((sum, item) => sum + item.memory, 0) / metricsHistory.length;
    
    let recommendedReplicas = 2;
    let reasoning = "Traffic is stable. Standard baseline scaling (2 replicas) is sufficient.";

    if (avgCpu > 75) {
      recommendedReplicas = 5;
      reasoning = `High CPU utilization (${avgCpu.toFixed(1)}%) detected. Proactive upscale to 5 replicas recommended to prevent latency degradation.`;
    } else if (avgCpu > 50) {
      recommendedReplicas = 3;
      reasoning = `Moderate CPU utilization (${avgCpu.toFixed(1)}%) detected. Proactive upscale to 3 replicas recommended.`;
    } else if (avgMemory > 80) {
      recommendedReplicas = 4;
      reasoning = `Memory usage is critical (${avgMemory.toFixed(1)}%). Replicas scaled to 4 to spread memory load and prevent OOMKilled events.`;
    }

    return {
      predictedCpu: avgCpu * 1.15, // Simulate a 15% increase in next window
      predictedMemory: avgMemory * 1.05,
      recommendedReplicas,
      reasoning
    };
  }

  /**
   * Chatbot handler for DevOps troubleshooting
   */
  public static async handleChatQuery(message: string): Promise<ChatResponse> {
    const normalized = message.toLowerCase();

    // Check for common DevOps queries and return professional developer platform answers
    if (normalized.includes("api manager") || normalized.includes("apim") || normalized.includes("wso2")) {
      return {
        answer: "WSO2 API Manager handles secure API publishing, traffic routing, rate limiting, and monetization. If you are experiencing connectivity issues, verify that the Gateway Pods are healthy, the control plane is reachable on port `9443`, and database connections to RDS PostgreSQL are not blocked by security groups.",
        suggestedCommands: ["kubectl get pods -n wso2", "kubectl logs -l app=wso2-apim -n wso2"]
      };
    }

    if (normalized.includes("crashloopbackoff") || normalized.includes("crashloop")) {
      return {
        answer: "A `CrashLoopBackOff` indicates that the container starts, but repeatedly exits. This is usually caused by:\n1. Application runtime errors (uncaught exceptions, missing config files).\n2. Failed liveness/readiness probes.\n3. Incorrect environment variables or DB connection strings.\n\nCheck the container exit code and logs to pinpoint the error.",
        suggestedCommands: ["kubectl describe pod <pod-name>", "kubectl logs <pod-name> --previous"]
      };
    }

    if (normalized.includes("oomkilled") || normalized.includes("out of memory")) {
      return {
        answer: "An `OOMKilled` (Exit Code 137) event means the pod was terminated by the Linux Out-Of-Memory killer because it exceeded its allocated memory limit. You should:\n1. Profile application memory usage.\n2. Increase the memory limit in the Helm values or deployment manifest.",
        suggestedCommands: ["kubectl describe nodes", "kubectl top pods"]
      };
    }

    if (normalized.includes("imagepullbackoff") || normalized.includes("errimagepull")) {
      return {
        answer: "An `ImagePullBackOff` indicates that Kubernetes could not fetch the specified Docker image. Verify:\n1. The image name and tag are correct.\n2. The image registry credentials (imagePullSecrets) are configured correctly.\n3. The image repository is public, or access has been granted.",
        suggestedCommands: ["kubectl get secret regcred", "kubectl describe pod <pod-name>"]
      };
    }

    if (normalized.includes("argocd") || normalized.includes("gitops")) {
      return {
        answer: "ArgoCD manages GitOps-driven deployment. It continuously monitors your Git repository (`kubernetes/` manifests) and reconciles the live cluster state. If applications are OutOfSync, you can manually sync them or check diffs via the ArgoCD console.",
        suggestedCommands: ["argocd app list", "argocd app sync devsecops-platform"]
      };
    }

    if (normalized.includes("trivy") || normalized.includes("sonar") || normalized.includes("security")) {
      return {
        answer: "Security scans are executed in our CI pipeline. SonarQube inspects static code for vulnerabilities, bugs, and coverage, while Trivy scans built container images for OS package vulnerabilities. Results are published to the Security panel on this dashboard.",
        suggestedCommands: ["trivy image devsecops/frontend:latest"]
      };
    }

    // Default DevOps response
    return {
      answer: "I am your DevSecOps Platform Assistant. I can help diagnose Kubernetes logs, explain deployment issues (like CrashLoopBackOff, OOMKilled, ImagePullBackOff), troubleshoot WSO2 API Manager setups, and suggest kubectl commands. What issue are you experiencing today?",
      suggestedCommands: ["kubectl get pods -A", "kubectl top nodes", "kubectl get events --sort-by='.metadata.creationTimestamp'"]
    };
  }

  private static async callGeminiAPI(logSnippet: string, deploymentYaml?: string): Promise<ExplanationResponse> {
    const prompt = `You are a world-class DevSecOps Platform Engineer. Analyze the following Kubernetes log snippet and deployment YAML (if provided), and return a JSON object with:
    {
      "errorType": "A concise label of the error (e.g. OOMKilled, ConnectionRefused)",
      "explanation": "Detailed explanation of why it failed",
      "remediation": "Step-by-step instructions to fix it",
      "suggestedFix": "The corrected YAML configuration or properties if applicable"
    }

    Log Snippet:
    ${logSnippet}

    Deployment YAML:
    ${deploymentYaml || "None"}
    
    Return ONLY the valid JSON block.`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }]
      }
    );

    const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanJsonText = rawText.substring(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
    return JSON.parse(cleanJsonText);
  }

  private static analyzeLogHeuristically(logSnippet: string, deploymentYaml?: string): ExplanationResponse {
    const log = logSnippet.toLowerCase();

    if (log.includes("oomkilled") || log.includes("exit code 137") || log.includes("out of memory")) {
      return {
        errorType: "OOMKilled (Out Of Memory)",
        explanation: "The container was terminated by the Kubernetes host because it exceeded the memory limit defined in the resource limits configuration. This commonly occurs in Java/Node microservices under high load or due to memory leaks.",
        remediation: "1. Increase the container memory limits in the Helm values files.\n2. Review application heap/memory configurations (e.g., node --max-old-space-size or JVM -Xmx).\n3. Profile the application for memory leaks.",
        suggestedFix: deploymentYaml ? this.patchYamlResources(deploymentYaml, "memory", "512Mi", "1Gi") : undefined
      };
    }

    if (log.includes("connrefused") || log.includes("connection refused") || log.includes("dial tcp")) {
      return {
        errorType: "Connection Refused",
        explanation: "The application failed to connect to a backend service, database, or API gateway. This points to either a misconfigured environment variable, network policy blocking traffic, or the target service not running.",
        remediation: "1. Check if the target service is running (`kubectl get svc -n devsecops`).\n2. Verify environment variable endpoints in the deployment manifest.\n3. Ensure WSO2 API Gateway is accessible and security groups permit communication.",
        suggestedFix: deploymentYaml ? this.patchYamlEnv(deploymentYaml, "DB_HOST", "database-service.devsecops.svc.cluster.local") : undefined
      };
    }

    if (log.includes("back-off pulling") || log.includes("imagepullbackoff") || log.includes("failed to pull image") || log.includes("not found")) {
      return {
        errorType: "ImagePullBackOff",
        explanation: "The kubelet tried to pull the container image from the registry, but failed. This could be due to a misspelled image name/tag, or missing image credentials (imagePullSecrets) for private registries like Docker Hub or GitHub Packages.",
        remediation: "1. Verify the exact image name and tag in the deployment manifest.\n2. Ensure the registry credential secret exists and is correctly referenced.\n3. Run a manual docker pull to verify accessibility.",
        suggestedFix: deploymentYaml ? this.patchYamlImage(deploymentYaml, "devsecops-service:latest") : undefined
      };
    }

    if (log.includes("auth") || log.includes("unauthorized") || log.includes("jwt") || log.includes("401") || log.includes("403")) {
      return {
        errorType: "Authentication/Authorization Failure",
        explanation: "The microservice rejected the request because the OAuth2/JWT token was missing, expired, or signed by an untrusted issuer. This points to a sync issue with the WSO2 Identity Server or API Manager gateway security keys.",
        remediation: "1. Verify the JWT validation certificate matches the WSO2 Identity Server public key.\n2. Check the authorization header formatting (must be Bearer <token>).\n3. Ensure token expiry limits are adjusted.",
        suggestedFix: deploymentYaml ? this.patchYamlEnv(deploymentYaml, "WSO2_IS_JWKS_URL", "https://is.wso2.local/oauth2/jwks") : undefined
      };
    }

    // Default Fallback diagnostics
    return {
      errorType: "Application Runtime Exception",
      explanation: "The application crashed during initialization or while executing runtime tasks. This is typically caused by unhandled exceptions or missing configuration parameters.",
      remediation: "1. Check application environment variables and volume mounts.\n2. Run the application locally with matching configuration to debug.\n3. Implement robust exception handling at the entry points.",
      suggestedFix: deploymentYaml
    };
  }

  private static patchYamlResources(yaml: string, resourceType: string, newRequest: string, newLimit: string): string {
    // Regex tool helper to replace limits in-memory for visual demo
    if (yaml.includes("resources:")) {
      return yaml.replace(
        /resources:[\s\S]*?limits:[\s\S]*?memory:.*?\n/,
        `resources:\n          requests:\n            memory: "${newRequest}"\n            cpu: "100m"\n          limits:\n            memory: "${newLimit}"\n            cpu: "500m"\n`
      );
    }
    return yaml + `\n# Suggested: Add resource limits\n# resources:\n#   limits:\n#     memory: ${newLimit}\n#   requests:\n#     memory: ${newRequest}`;
  }

  private static patchYamlEnv(yaml: string, envName: string, correctValue: string): string {
    if (yaml.includes("env:")) {
      return yaml.replace(
        new RegExp(`name: ${envName}\\s+value:.*`),
        `name: ${envName}\n            value: "${correctValue}"`
      );
    }
    return yaml + `\n# Suggested env fix:\n# - name: ${envName}\n#   value: "${correctValue}"`;
  }

  private static patchYamlImage(yaml: string, correctImage: string): string {
    if (yaml.includes("image:")) {
      return yaml.replace(/image:.*?\n/, `image: ${correctImage}\n`);
    }
    return yaml;
  }
}
