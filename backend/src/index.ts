import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { AIService } from './services/ai.service';
import { DeploymentService } from './services/deployment.service';
import { SecurityService } from './services/security.service';

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

let isFirebaseConnected = false;
let db: admin.firestore.Firestore | null = null;

try {
  const saPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(saPath)) {
    const serviceAccount = require(saPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    isFirebaseConnected = true;
    console.log('[Firebase] Connected to Firestore Cloud database successfully.');
  } else {
    console.log('[Firebase] No serviceAccountKey.json found. Operating in local memory fallback.');
  }
} catch (err) {
  console.error('[Firebase] Failed to initialize Firebase Admin SDK. Operating in local memory fallback:', err);
}

// Express REST Endpoints

// 1. Deployment Management REST APIs
app.get('/api/deployments', (req, res) => {
  res.json(DeploymentService.getAllDeployments());
});

app.get('/api/deployments/:name', (req, res) => {
  const deployment = DeploymentService.getDeployment(req.params.name);
  if (deployment) {
    res.json(deployment);
  } else {
    res.status(404).json({ error: "Deployment not found" });
  }
});

app.post('/api/deployments/heal', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  
  const success = DeploymentService.triggerAutoHeal(name);
  if (success) {
    SecurityService.triggerScan(name); // Scan also gets fixed in background

    // Async sync to Firestore
    if (isFirebaseConnected && db) {
      const depRef = db.collection('deployments').doc(name);
      depRef.update({ status: 'Healing' }).catch(() => {});
      setTimeout(async () => {
        const updated = DeploymentService.getDeployment(name);
        if (updated && db) {
          await db.collection('deployments').doc(name).set(updated);
          // Also set the updated security reports in Firestore
          const trivyRep = SecurityService.getTrivyReport(name);
          const sonarRep = SecurityService.getSonarReport(name);
          if (trivyRep) await db.collection('trivy_reports').doc(name).set(trivyRep);
          if (sonarRep) await db.collection('sonar_reports').doc(name).set(sonarRep);
        }
      }, 5000);
    }

    res.json({ message: `Auto-healing pipeline initiated for ${name}` });
  } else {
    res.status(404).json({ error: "Deployment not found" });
  }
});

app.post('/api/deployments/rollback', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  const success = DeploymentService.triggerRollback(name);
  if (success) {
    SecurityService.triggerScan(name);

    if (isFirebaseConnected && db) {
      const depRef = db.collection('deployments').doc(name);
      depRef.update({ status: 'Updating' }).catch(() => {});
      setTimeout(async () => {
        const updated = DeploymentService.getDeployment(name);
        if (updated && db) {
          await db.collection('deployments').doc(name).set(updated);
          const trivyRep = SecurityService.getTrivyReport(name);
          const sonarRep = SecurityService.getSonarReport(name);
          if (trivyRep) await db.collection('trivy_reports').doc(name).set(trivyRep);
          if (sonarRep) await db.collection('sonar_reports').doc(name).set(sonarRep);
        }
      }, 4000);
    }

    res.json({ message: `Rollback triggered for ${name}` });
  } else {
    res.status(404).json({ error: "Deployment not found" });
  }
});

app.post('/api/deployments/scale', (req, res) => {
  const { name, replicas } = req.body;
  if (!name || replicas === undefined) {
    return res.status(400).json({ error: "Name and replicas are required" });
  }

  const success = DeploymentService.scaleDeployment(name, replicas);
  if (success) {
    if (isFirebaseConnected && db) {
      const depRef = db.collection('deployments').doc(name);
      depRef.update({ status: 'Updating', replicas }).catch(() => {});
      setTimeout(async () => {
        const updated = DeploymentService.getDeployment(name);
        if (updated && db) {
          await db.collection('deployments').doc(name).set(updated);
        }
      }, 2000);
    }

    res.json({ message: `Scaling deployment ${name} to ${replicas} replicas` });
  } else {
    res.status(404).json({ error: "Deployment not found" });
  }
});

app.post('/api/deployments/load', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  const success = DeploymentService.triggerHighLoad(name);
  if (success) {
    if (isFirebaseConnected && db) {
      const dep = DeploymentService.getDeployment(name);
      if (dep) {
        db.collection('deployments').doc(name).update({
          cpuUsage: dep.cpuUsage,
          memoryUsage: dep.memoryUsage
        }).catch(() => {});
      }
    }

    res.json({ message: `High CPU load injected into service: ${name}` });
  } else {
    res.status(404).json({ error: "Deployment not found" });
  }
});

// 2. AI Service REST APIs
app.post('/api/ai/explain', async (req, res) => {
  const { logs, yaml } = req.body;
  if (!logs) return res.status(400).json({ error: "Log snippet is required" });

  try {
    const analysis = await AIService.explainFailure(logs, yaml);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: "AI Engine analysis failed" });
  }
});

app.post('/api/ai/suggest', async (req, res) => {
  const { yaml, logs } = req.body;
  if (!yaml || !logs) return res.status(400).json({ error: "YAML and logs are required" });

  try {
    const suggestedFix = await AIService.suggestYamlFix(yaml, logs);
    res.json({ suggestedFix });
  } catch (err) {
    res.status(500).json({ error: "YAML fix generation failed" });
  }
});

app.post('/api/ai/predict', (req, res) => {
  const { history } = req.body;
  if (!history || !Array.isArray(history)) {
    return res.status(400).json({ error: "Metrics history is required" });
  }

  try {
    const prediction = AIService.predictScaling(history);
    res.json(prediction);
  } catch (err) {
    res.status(500).json({ error: "Scaling prediction failed" });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Message is required" });

  try {
    const response = await AIService.handleChatQuery(message);
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: "Chatbot engine failed" });
  }
});

// 3. Security Service REST APIs
app.get('/api/security/trivy', (req, res) => {
  res.json(SecurityService.getAllTrivyReports());
});

app.get('/api/security/trivy/:service', (req, res) => {
  const report = SecurityService.getTrivyReport(req.params.service);
  if (report) {
    res.json(report);
  } else {
    res.status(404).json({ error: "Security report not found" });
  }
});

app.get('/api/security/sonar', (req, res) => {
  res.json(SecurityService.getAllSonarReports());
});

app.get('/api/security/sonar/:service', (req, res) => {
  const report = SecurityService.getSonarReport(req.params.service);
  if (report) {
    res.json(report);
  } else {
    res.status(404).json({ error: "Code quality report not found" });
  }
});

app.post('/api/security/scan', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  const success = SecurityService.triggerScan(name);
  if (success) {
    res.json({ message: `Security vulnerability scans re-triggered for ${name}` });
  } else {
    res.status(404).json({ error: "Service not found" });
  }
});

// Initialize HTTP & WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Telemetry websocket emitter
wss.on('connection', (ws: WebSocket) => {
  console.log('[WebSocket] Client connected for live telemetry');

  // Send initial data
  ws.send(JSON.stringify({ type: 'init', deployments: DeploymentService.getAllDeployments() }));

  const telemetryInterval = setInterval(() => {
    // Generate slight noise in metrics to simulate real running environment
    const updates = DeploymentService.getAllDeployments().map(dep => {
      let noiseCpu = (Math.random() - 0.5) * 4;
      let noiseMem = (Math.random() - 0.5) * 10;
      
      // Keep within logical boundaries
      if (dep.status === "Healthy") {
        dep.cpuUsage = Math.max(2, Math.min(95, dep.cpuUsage + noiseCpu));
        dep.memoryUsage = Math.max(50, dep.memoryUsage + noiseMem);
      }

      // Sync metrics to Firestore in background
      if (isFirebaseConnected && db && dep.status === "Healthy") {
        db.collection('deployments').doc(dep.name).update({
          cpuUsage: parseFloat(dep.cpuUsage.toFixed(1)),
          memoryUsage: parseFloat(dep.memoryUsage.toFixed(1))
        }).catch(() => {});
      }
      
      return {
        name: dep.name,
        status: dep.status,
        replicas: dep.replicas,
        availableReplicas: dep.availableReplicas,
        cpuUsage: parseFloat(dep.cpuUsage.toFixed(1)),
        memoryUsage: parseFloat(dep.memoryUsage.toFixed(1)),
        version: dep.version,
        errorLogs: dep.errorLogs
      };
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'telemetry', deployments: updates }));
    }
  }, 2000);

  ws.on('close', () => {
    clearInterval(telemetryInterval);
    console.log('[WebSocket] Client disconnected');
  });
});

if (!process.env.FIREBASE_CONFIG && !process.env.FUNCTIONS_EMULATOR) {
  server.listen(port, () => {
    console.log(`================================================================`);
    console.log(`🚀 DevSecOps IDP Backend running on http://localhost:${port}`);
    console.log(`🔌 WebSocket service listening for metrics streams`);
    console.log(`================================================================`);
  });
}

// Export the Cloud Function API trigger
export const api = onRequest({ cors: true, timeoutSeconds: 60, memory: '256MiB' }, app);
