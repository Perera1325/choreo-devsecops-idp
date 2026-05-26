export interface TrivyReport {
  target: string;
  scanner: "Trivy";
  scanDate: string;
  status: "Passed" | "Failed";
  vulnerabilities: {
    id: string;
    package: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    installedVersion: string;
    fixedVersion: string;
    description: string;
  }[];
}

export interface SonarQubeReport {
  project: string;
  scanner: "SonarQube";
  scanDate: string;
  qualityGate: "PASSED" | "FAILED";
  metrics: {
    bugs: number;
    vulnerabilities: number;
    securityHotspots: number;
    codeSmells: number;
    coverage: number; // percentage
    duplicatedLinesDensity: number; // percentage
  };
}

export class SecurityService {
  private static trivyReports: Map<string, TrivyReport> = new Map([
    [
      "gateway-service",
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
      }
    ],
    [
      "payment-service",
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
      }
    ],
    [
      "ai-analysis-engine",
      {
        target: "Perera1325/ai-analysis-engine:v1.0.1",
        scanner: "Trivy",
        scanDate: "2026-05-26T06:50:00Z",
        status: "Passed",
        vulnerabilities: []
      }
    ]
  ]);

  private static sonarReports: Map<string, SonarQubeReport> = new Map([
    [
      "gateway-service",
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
      }
    ],
    [
      "payment-service",
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
      }
    ],
    [
      "ai-analysis-engine",
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
    ]
  ]);

  public static getTrivyReport(serviceName: string): TrivyReport | undefined {
    return this.trivyReports.get(serviceName);
  }

  public static getSonarReport(serviceName: string): SonarQubeReport | undefined {
    return this.sonarReports.get(serviceName);
  }

  public static getAllTrivyReports(): TrivyReport[] {
    return Array.from(this.trivyReports.values());
  }

  public static getAllSonarReports(): SonarQubeReport[] {
    return Array.from(this.sonarReports.values());
  }

  /**
   * Simulate a scan execution triggered by pipeline webhook
   */
  public static triggerScan(serviceName: string): boolean {
    const trivy = this.trivyReports.get(serviceName);
    const sonar = this.sonarReports.get(serviceName);

    if (!trivy || !sonar) return false;

    // Simulate fixes after scan (triggered after rollback or auto-healing)
    setTimeout(() => {
      trivy.status = "Passed";
      trivy.vulnerabilities = [];
      trivy.scanDate = new Date().toISOString();
      
      sonar.qualityGate = "PASSED";
      sonar.metrics.bugs = 0;
      sonar.metrics.vulnerabilities = 0;
      sonar.metrics.securityHotspots = 0;
      sonar.metrics.coverage = 92.4;
      sonar.metrics.duplicatedLinesDensity = 0.5;
      sonar.scanDate = new Date().toISOString();

      console.log(`[SecurityScanner] Pipeline run complete: trivy & sonarqube scans passed for ${serviceName}`);
    }, 5000);

    return true;
  }
}
