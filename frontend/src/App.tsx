import { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase.config';
import { 
  LayoutDashboard, 
  Cpu, 
  Terminal, 
  ShieldAlert, 
  MessageSquare, 
  Activity, 
  RefreshCw, 
  Play, 
  CheckCircle, 
  AlertTriangle, 
  ChevronRight, 
  Sparkles,
  Layers,
  ArrowUpRight,
  Code
} from 'lucide-react';

interface DeploymentInfo {
  name: string;
  namespace: string;
  status: "Healthy" | "Degraded" | "Failed" | "Updating" | "Healing";
  replicas: number;
  availableReplicas: number;
  cpuUsage: number;
  memoryUsage: number;
  errorLogs?: string;
  yamlConfig: string;
  version: string;
}

interface TrivyReport {
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

interface SonarQubeReport {
  project: string;
  scanner: "SonarQube";
  scanDate: string;
  qualityGate: "PASSED" | "FAILED";
  metrics: {
    bugs: number;
    vulnerabilities: number;
    securityHotspots: number;
    codeSmells: number;
    coverage: number;
    duplicatedLinesDensity: number;
  };
}

interface AIDiagnosis {
  errorType: string;
  explanation: string;
  remediation: string;
  suggestedFix?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'services' | 'security' | 'ai' | 'chatbot'>('dashboard');
  const [deployments, setDeployments] = useState<DeploymentInfo[]>([]);
  const [selectedService, setSelectedService] = useState<string>('payment-service');
  
  // Security reports
  const [trivyReports, setTrivyReports] = useState<TrivyReport[]>([]);
  const [sonarReports, setSonarReports] = useState<SonarQubeReport[]>([]);

  // AI states
  const [diagnosis, setDiagnosis] = useState<AIDiagnosis | null>(null);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [scalingPrediction, setScalingPrediction] = useState<{
    predictedCpu: number;
    predictedMemory: number;
    recommendedReplicas: number;
    reasoning: string;
  } | null>(null);

  // Chatbot states
  const [chatMessages, setChatMessages] = useState<{ sender: 'user' | 'bot'; text: string; commands?: string[] }[]>([
    { sender: 'bot', text: 'Welcome to the WSO2-powered DevSecOps Platform Assistant. I can help diagnose deployment issues, inspect WSO2 gateways, analyze logs, or recommend kubectl scripts. How can I help you?' }
  ]);
  const [chatInput, setChatInput] = useState<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // WebSocket connection status
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');

  // Load backend configs dynamically
  const BACKEND_URL = 'http://localhost:5000';
  const WS_URL = 'ws://localhost:5000';

  // Fetch initial REST data & establish WS / Firestore
  useEffect(() => {
    let unsubscribeDeployments: (() => void) | null = null;
    let unsubscribeTrivy: (() => void) | null = null;
    let unsubscribeSonar: (() => void) | null = null;

    let useFirebase = false;

    try {
      if (db && !import.meta.env.VITE_FIREBASE_API_KEY?.includes("mock")) {
        unsubscribeDeployments = onSnapshot(collection(db, "deployments"), (snapshot) => {
          const list: DeploymentInfo[] = [];
          snapshot.forEach((doc) => {
            list.push(doc.data() as DeploymentInfo);
          });
          if (list.length > 0) {
            setDeployments(list);
            setWsStatus('connected');
            useFirebase = true;
          }
        }, (err) => {
          console.warn("Firestore deployments connection failed, using local WebSockets:", err);
          setupWebSockets();
        });

        unsubscribeTrivy = onSnapshot(collection(db, "trivy_reports"), (snapshot) => {
          const list: TrivyReport[] = [];
          snapshot.forEach((doc) => {
            list.push(doc.data() as TrivyReport);
          });
          setTrivyReports(list);
        });

        unsubscribeSonar = onSnapshot(collection(db, "sonar_reports"), (snapshot) => {
          const list: SonarQubeReport[] = [];
          snapshot.forEach((doc) => {
            list.push(doc.data() as SonarQubeReport);
          });
          setSonarReports(list);
        });
      } else {
        console.log("[Firebase] Operating in Local WebSockets fallback mode.");
        setupWebSockets();
      }
    } catch (err) {
      console.warn("Firebase initialization failed, falling back to WebSockets:", err);
      setupWebSockets();
    }

    let socket: WebSocket;
    function setupWebSockets() {
      if (useFirebase) return;
      fetchDeployments();
      fetchSecurityReports();

      setWsStatus('connecting');
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        setWsStatus('connected');
        console.log('Telemetry WebSocket connected.');
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'init' || msg.type === 'telemetry') {
          setDeployments((prev) => {
            const map = new Map(prev.map(d => [d.name, d]));
            msg.deployments.forEach((update: any) => {
              const current = map.get(update.name);
              if (current) {
                map.set(update.name, { ...current, ...update });
              } else {
                map.set(update.name, update);
              }
            });
            return Array.from(map.values());
          });
        }
      };

      socket.onclose = () => {
        setWsStatus('disconnected');
        console.log('Telemetry WebSocket disconnected. Reconnecting in 5s...');
        setTimeout(setupWebSockets, 5000);
      };

      socket.onerror = (err) => {
        console.error('WebSocket Error:', err);
        socket.close();
      };
    }

    return () => {
      if (unsubscribeDeployments) unsubscribeDeployments();
      if (unsubscribeTrivy) unsubscribeTrivy();
      if (unsubscribeSonar) unsubscribeSonar();
      if (socket) socket.close();
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const fetchDeployments = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/deployments`);
      const data = await res.json();
      setDeployments(data);
    } catch (err) {
      console.error("Failed to fetch deployments:", err);
    }
  };

  const fetchSecurityReports = async () => {
    try {
      const trivyRes = await fetch(`${BACKEND_URL}/api/security/trivy`);
      const trivyData = await trivyRes.json();
      setTrivyReports(trivyData);

      const sonarRes = await fetch(`${BACKEND_URL}/api/security/sonar`);
      const sonarData = await sonarRes.json();
      setSonarReports(sonarData);
    } catch (err) {
      console.error("Failed to fetch security reports:", err);
    }
  };

  // Actions
  const handleAutoHeal = async (name: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/deployments/heal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      // Set local state to healing immediately for UX response
      setDeployments(prev => prev.map(d => d.name === name ? { ...d, status: 'Healing' } : d));
      // Trigger a rescan of security report
      setTimeout(fetchSecurityReports, 6000);
    } catch (err) {
      console.error("Auto-heal failed:", err);
    }
  };

  const handleRollback = async (name: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/deployments/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      setDeployments(prev => prev.map(d => d.name === name ? { ...d, status: 'Updating' } : d));
      setTimeout(fetchSecurityReports, 5000);
    } catch (err) {
      console.error("Rollback failed:", err);
    }
  };

  const handleScale = async (name: string, replicas: number) => {
    try {
      await fetch(`${BACKEND_URL}/api/deployments/scale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, replicas })
      });
    } catch (err) {
      console.error("Scaling failed:", err);
    }
  };

  const handleInjectLoad = async (name: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/deployments/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
    } catch (err) {
      console.error("Load injection failed:", err);
    }
  };

  const handleAIDiagnoseLogs = async (logs: string, yaml: string) => {
    setAnalyzing(true);
    setDiagnosis(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs, yaml })
      });
      const data = await res.json();
      setDiagnosis(data);
      setActiveTab('ai');
    } catch (err) {
      console.error("AI diagnostics failed:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAIPredictScaling = async (name: string) => {
    const activeDep = deployments.find(d => d.name === name);
    if (!activeDep) return;
    
    // Create dummy metrics history representing load levels
    const history = [
      { timestamp: '1', cpu: activeDep.cpuUsage * 0.8, memory: activeDep.memoryUsage },
      { timestamp: '2', cpu: activeDep.cpuUsage * 0.9, memory: activeDep.memoryUsage },
      { timestamp: '3', cpu: activeDep.cpuUsage, memory: activeDep.memoryUsage },
    ];

    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history })
      });
      const data = await res.json();
      setScalingPrediction(data);
    } catch (err) {
      console.error("AI scale prediction failed:", err);
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    const userText = chatInput;
    setChatMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setChatInput('');

    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText })
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { sender: 'bot', text: data.answer, commands: data.suggestedCommands }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { sender: 'bot', text: 'Error interacting with AI chatbot engine. Please verify the backend service is running.' }]);
    }
  };

  const activeServiceObj = deployments.find(d => d.name === selectedService);
  const activeTrivyReport = trivyReports.find(r => r.target.includes(selectedService));
  const activeSonarReport = sonarReports.find(r => r.project.includes(selectedService));

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-slate-950">
      
      {/* Futuristic Background Blur Blobs */}
      <div className="bg-blob w-[400px] h-[400px] bg-cyan-600 top-[-100px] left-[-100px]"></div>
      <div className="bg-blob w-[500px] h-[500px] bg-indigo-800 bottom-[-200px] right-[-100px]"></div>

      {/* 1. Sidebar Panel */}
      <aside className="w-80 glass-panel border-r border-slate-800 flex flex-col z-10">
        
        {/* Platform Brand */}
        <div className="p-6 border-b border-slate-800 flex items-center space-x-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-white font-bold animate-pulse-slow">
              <Cpu className="w-6 h-6" />
            </div>
            <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-slate-950"></div>
          </div>
          <div>
            <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-indigo-300">Choreo IDP</h1>
            <p className="text-xs text-slate-500 font-mono">v3.4.0 • WSO2 Edition</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex-1 px-4 py-6 space-y-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-cyan-500/10 text-cyan-400 border-l-2 border-cyan-500' : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'}`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span>Telemetry Dashboard</span>
          </button>

          <button 
            onClick={() => setActiveTab('services')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'services' ? 'bg-cyan-500/10 text-cyan-400 border-l-2 border-cyan-500' : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'}`}
          >
            <Layers className="w-5 h-5" />
            <span>Service Provisioner</span>
          </button>

          <button 
            onClick={() => setActiveTab('security')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'security' ? 'bg-cyan-500/10 text-cyan-400 border-l-2 border-cyan-500' : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'}`}
          >
            <ShieldAlert className="w-5 h-5" />
            <span>SecOps & Compliance</span>
          </button>

          <button 
            onClick={() => setActiveTab('ai')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'ai' ? 'bg-cyan-500/10 text-cyan-400 border-l-2 border-cyan-500' : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'}`}
          >
            <Sparkles className="w-5 h-5" />
            <span>AI Diagnostics</span>
            {activeServiceObj?.status === 'Failed' && (
              <span className="ml-auto w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
            )}
          </button>

          <button 
            onClick={() => setActiveTab('chatbot')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'chatbot' ? 'bg-cyan-500/10 text-cyan-400 border-l-2 border-cyan-500' : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'}`}
          >
            <MessageSquare className="w-5 h-5" />
            <span>DevOps Troubleshooter</span>
          </button>
        </nav>

        {/* WSO2 System Components Status Monitor */}
        <div className="p-4 m-4 rounded-xl bg-slate-900/50 border border-slate-800/80 font-mono text-xs">
          <h3 className="text-slate-400 text-xs font-semibold uppercase mb-3 flex items-center">
            <Activity className="w-4 h-4 mr-2 text-cyan-400" /> Platform Infrastructure
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">WSO2 APIM Gateway</span>
              <span className="text-emerald-400 flex items-center"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>Active</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">WSO2 Identity Server</span>
              <span className="text-emerald-400 flex items-center"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>Active</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">ArgoCD Reconciler</span>
              <span className="text-emerald-400 flex items-center"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>Synced</span>
            </div>
            <div className="flex justify-between items-center border-t border-slate-800 pt-2">
              <span className="text-slate-500">Telemetry Stream</span>
              <span className={`font-semibold ${wsStatus === 'connected' ? 'text-cyan-400' : wsStatus === 'connecting' ? 'text-amber-500' : 'text-rose-500'}`}>
                {wsStatus.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

      </aside>

      {/* 2. Main Work Area */}
      <main className="flex-1 flex flex-col overflow-y-auto z-10">

        {/* Global Nav-Header */}
        <header className="h-20 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-950/70 backdrop-blur-md">
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-500 font-mono">Workspace:</span>
            <span className="text-xs px-2.5 py-1 rounded bg-slate-900 border border-slate-800 font-mono text-cyan-400">Perera1325/tourism-platform</span>
          </div>
          <div className="flex items-center space-x-4">
            <span className="flex items-center space-x-1.5 text-xs text-slate-400 bg-slate-900 px-3 py-1.5 rounded-full border border-slate-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>K8s Cluster Node: Production-EKS-01</span>
            </span>
          </div>
        </header>

        {/* Container for active view */}
        <div className="p-8 flex-1">
          
          {/* TAB 1: TELEMETRY DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-fadeIn">
              
              {/* Telemetry Gauge Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                
                <div className="glass-panel p-6 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-slate-400 text-sm font-semibold">Total Deployments</span>
                    <Layers className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div className="text-3xl font-bold">{deployments.length}</div>
                  <div className="text-xs text-slate-500 mt-2 font-mono">5 microservices, 2 core systems</div>
                </div>

                <div className="glass-panel p-6 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-slate-400 text-sm font-semibold">Operational Status</span>
                    <Activity className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="text-3xl font-bold text-emerald-400">99.8%</div>
                  <div className="text-xs text-slate-500 mt-2 font-mono">0.2% downtime this billing cycle</div>
                </div>

                <div className="glass-panel p-6 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-slate-400 text-sm font-semibold">Security Compliance</span>
                    <ShieldAlert className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div className="text-3xl font-bold">
                    {trivyReports.some(r => r.status === 'Failed') ? 'DEGRADED' : 'SECURE'}
                  </div>
                  <div className="text-xs text-slate-500 mt-2 font-mono">
                    {trivyReports.reduce((acc, curr) => acc + curr.vulnerabilities.length, 0)} Active Vulnerabilities
                  </div>
                </div>

                <div className="glass-panel p-6 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-slate-400 text-sm font-semibold">GitOps Synced State</span>
                    <RefreshCw className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div className="text-3xl font-bold text-indigo-400">100%</div>
                  <div className="text-xs text-slate-500 mt-2 font-mono">Last updated: Just now</div>
                </div>

              </div>

              {/* Service Status List */}
              <div className="glass-panel rounded-2xl overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-200">Active Cluster Deployments</h2>
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping"></span>
                    <span className="text-xs text-slate-400 font-mono">Live WebSocket metrics update active</span>
                  </div>
                </div>
                <div className="divide-y divide-slate-800/60">
                  {deployments.map((dep) => (
                    <div 
                      key={dep.name} 
                      onClick={() => setSelectedService(dep.name)}
                      className={`p-6 flex flex-col md:flex-row md:items-center justify-between hover:bg-slate-900/40 transition-all cursor-pointer ${selectedService === dep.name ? 'bg-cyan-500/5 border-l-4 border-cyan-500' : ''}`}
                    >
                      <div className="flex items-center space-x-4 mb-4 md:mb-0">
                        <div className={`p-2.5 rounded-xl ${
                          dep.status === 'Healthy' ? 'bg-emerald-500/10 text-emerald-400' :
                          dep.status === 'Failed' ? 'bg-rose-500/10 text-rose-400' :
                          'bg-amber-500/10 text-amber-400'
                        }`}>
                          <Layers className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="font-semibold text-slate-200">{dep.name}</h3>
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">{dep.version}</span>
                          </div>
                          <p className="text-xs text-slate-500 font-mono">Namespace: {dep.namespace}</p>
                        </div>
                      </div>

                      {/* Gauges */}
                      <div className="flex items-center space-x-8">
                        
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Replicas</span>
                          <span className="font-mono text-sm font-semibold">{dep.availableReplicas} / {dep.replicas}</span>
                        </div>

                        <div className="w-24">
                          <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                            <span>CPU</span>
                            <span>{dep.cpuUsage.toFixed(0)}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-500 ${dep.cpuUsage > 80 ? 'bg-rose-500' : dep.cpuUsage > 50 ? 'bg-amber-500' : 'bg-cyan-500'}`} style={{ width: `${dep.cpuUsage}%` }}></div>
                          </div>
                        </div>

                        <div className="w-24">
                          <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                            <span>Memory</span>
                            <span>{dep.memoryUsage.toFixed(0)} Mi</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (dep.memoryUsage / 2048) * 100)}%` }}></div>
                          </div>
                        </div>

                        <div>
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                            dep.status === 'Healthy' ? 'bg-emerald-500/10 text-emerald-400' :
                            dep.status === 'Failed' ? 'bg-rose-500/10 text-rose-400' :
                            dep.status === 'Healing' ? 'bg-cyan-500/10 text-cyan-400 animate-pulse' :
                            'bg-amber-500/10 text-amber-400 animate-pulse'
                          }`}>
                            {dep.status}
                          </span>
                        </div>

                        <ChevronRight className="w-5 h-5 text-slate-600" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Selected Service Diagnostic Terminal */}
              {activeServiceObj && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  
                  {/* Left: Interactive Logs & Auto-Healer */}
                  <div className="glass-panel rounded-2xl p-6 flex flex-col">
                    <h3 className="text-base font-semibold text-slate-200 mb-4 flex items-center">
                      <Terminal className="w-5 h-5 mr-2 text-cyan-400" /> Live Container Logs: {activeServiceObj.name}
                    </h3>
                    
                    <div className="flex-1 bg-slate-950 border border-slate-900 rounded-xl p-4 font-mono text-xs text-slate-300 h-64 overflow-y-auto mb-4 scrollbar">
                      {activeServiceObj.errorLogs ? (
                        <div className="text-rose-400 whitespace-pre-wrap">{activeServiceObj.errorLogs}</div>
                      ) : (
                        <div className="text-emerald-400">
                          [2026-05-26 07:20:10.002] INFO Application initialized successfully.<br />
                          [2026-05-26 07:20:12.155] INFO WSO2 Gateway validation channel: Authenticated OK.<br />
                          [2026-05-26 07:20:15.541] INFO Listening for HTTP traffic on port 8080.<br />
                          [2026-05-26 07:20:16.890] INFO Prometheus metrics server exposed on port 9090/metrics.<br />
                          [2026-05-26 07:20:20.120] INFO Telemetry CPU={activeServiceObj.cpuUsage.toFixed(1)}% Memory={activeServiceObj.memoryUsage.toFixed(0)}Mi replicas={activeServiceObj.availableReplicas}
                        </div>
                      )}
                    </div>

                    {/* Operational Buttons */}
                    <div className="flex flex-wrap gap-4">
                      {activeServiceObj.status === 'Failed' && (
                        <button 
                          onClick={() => handleAIDiagnoseLogs(activeServiceObj.errorLogs || '', activeServiceObj.yamlConfig)}
                          disabled={analyzing}
                          className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-800 text-white font-medium text-sm px-5 py-2.5 rounded-lg flex items-center shadow-lg transition-all"
                        >
                          <Sparkles className="w-4 h-4 mr-2" /> 
                          {analyzing ? 'Analyzing with AI...' : 'Explain with AI Diagnostics'}
                        </button>
                      )}

                      {activeServiceObj.status === 'Failed' && (
                        <button 
                          onClick={() => handleAutoHeal(activeServiceObj.name)}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm px-5 py-2.5 rounded-lg flex items-center shadow-lg transition-all"
                        >
                          <Play className="w-4 h-4 mr-2" /> Auto-Heal (Apply AI Fix)
                        </button>
                      )}

                      {activeServiceObj.status === 'Healthy' && activeServiceObj.name === 'payment-service' && (
                        <button 
                          onClick={() => handleRollback(activeServiceObj.name)}
                          className="bg-rose-600 hover:bg-rose-500 text-white font-medium text-sm px-5 py-2.5 rounded-lg flex items-center shadow-lg transition-all"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" /> Rollback to Previous Release
                        </button>
                      )}

                      <button
                        onClick={() => handleInjectLoad(activeServiceObj.name)}
                        className="bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-medium text-sm px-5 py-2.5 rounded-lg flex items-center transition-all"
                      >
                        Simulate Traffic Load Spike
                      </button>
                    </div>
                  </div>

                  {/* Right: Kubernetes Config Editor */}
                  <div className="glass-panel rounded-2xl p-6 flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-base font-semibold text-slate-200 flex items-center">
                        <Code className="w-5 h-5 mr-2 text-indigo-400" /> GitOps YAML Config: {activeServiceObj.name}
                      </h3>
                      <span className="text-[10px] font-mono bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded">READ ONLY</span>
                    </div>
                    <pre className="flex-1 bg-slate-950 border border-slate-900 rounded-xl p-4 font-mono text-[10px] text-cyan-400 overflow-x-auto h-64 overflow-y-auto scrollbar">
                      <code>{activeServiceObj.yamlConfig}</code>
                    </pre>
                    <div className="mt-4 flex justify-between items-center">
                      <div className="text-xs text-slate-500 font-mono">Reconciled by ArgoCD: 100% Match</div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-slate-400">Scale Replicas:</span>
                        <input 
                          type="number" 
                          min="1" 
                          max="10" 
                          value={activeServiceObj.replicas} 
                          onChange={(e) => handleScale(activeServiceObj.name, parseInt(e.target.value))}
                          className="w-16 bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-sm font-mono text-center text-cyan-400 focus:outline-none focus:border-cyan-500" 
                        />
                      </div>
                    </div>
                  </div>

                </div>
              )}

            </div>
          )}

          {/* TAB 2: SERVICE PROVISIONER */}
          {activeTab === 'services' && (
            <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
              <div className="glass-panel p-8 rounded-2xl space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-slate-200">Self-Service Microservice Builder</h2>
                  <p className="text-sm text-slate-500 mt-1">Deploy secure, pre-configured containers with WSO2 APIs registered instantly.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Service Name</label>
                    <input type="text" placeholder="e.g. catalog-service" className="w-full glass-input px-4 py-3 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Docker Image Repository</label>
                    <input type="text" placeholder="e.g. Perera1325/catalog-service" className="w-full glass-input px-4 py-3 rounded-lg text-sm" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Container Port</label>
                    <input type="number" placeholder="8080" className="w-full glass-input px-4 py-3 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Replica Count</label>
                    <input type="number" placeholder="2" className="w-full glass-input px-4 py-3 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">WSO2 Route Access Policy</label>
                    <select className="w-full glass-input px-4 py-3 rounded-lg text-sm">
                      <option>OAuth2 (JWT Mandatory)</option>
                      <option>OAuth2 (Scope RESTRICTED)</option>
                      <option>API Key Public Routing</option>
                    </select>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-800/30 flex items-start space-x-3">
                  <Sparkles className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <strong className="text-cyan-400">AI Platform Guard:</strong> This configuration will be automatically audited by Trivy and SonarQube in the CI pipe, and GitOps YAML manifests will be updated via GitHub Actions into the ArgoCD repository root.
                  </div>
                </div>

                <button 
                  onClick={() => alert("Simulated deploy: Helm chart created, WSO2 API published, and GitHub PR submitted successfully!")}
                  className="w-full bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-medium py-3 rounded-lg shadow-lg shadow-cyan-500/20 flex items-center justify-center space-x-2 transition-all"
                >
                  <ArrowUpRight className="w-5 h-5" />
                  <span>Provision Microservice via GitOps</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: SECOPS & COMPLIANCE */}
          {activeTab === 'security' && (
            <div className="space-y-8 animate-fadeIn">
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                
                {/* Trivy Scanner Card */}
                <div className="glass-panel p-6 rounded-2xl flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-base font-semibold text-slate-200 flex items-center">
                      <ShieldAlert className="w-5 h-5 mr-2 text-rose-500" /> Trivy Container Image Vulnerabilities
                    </h3>
                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                      activeTrivyReport?.status === 'Failed' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}>
                      {activeTrivyReport?.status || 'UNKNOWN'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-500 font-mono mb-4">
                    Target: {activeTrivyReport?.target || 'Select a service on Telemetry tab'}
                  </div>

                  <div className="flex-1 overflow-y-auto max-h-80 divide-y divide-slate-800/80 scrollbar">
                    {activeTrivyReport && activeTrivyReport.vulnerabilities.length > 0 ? (
                      activeTrivyReport.vulnerabilities.map(v => (
                        <div key={v.id} className="py-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300 font-semibold font-mono text-xs">{v.id}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              v.severity === 'CRITICAL' ? 'bg-rose-500/20 text-rose-400' :
                              v.severity === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
                              'bg-amber-500/20 text-amber-400'
                            }`}>{v.severity}</span>
                          </div>
                          <div className="text-xs text-slate-400">Package: <span className="font-mono text-slate-200">{v.package} ({v.installedVersion})</span></div>
                          <div className="text-xs text-slate-500 leading-relaxed">{v.description}</div>
                          <div className="text-xs text-emerald-400">Fix available in: {v.fixedVersion}</div>
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-500 font-mono">
                        <CheckCircle className="w-12 h-12 text-emerald-500 mb-3" />
                        <span>No image vulnerabilities detected.</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* SonarQube Scanner Card */}
                <div className="glass-panel p-6 rounded-2xl flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-base font-semibold text-slate-200 flex items-center">
                      <Code className="w-5 h-5 mr-2 text-indigo-400" /> SonarQube Static Code Analysis
                    </h3>
                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                      activeSonarReport?.qualityGate === 'FAILED' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}>
                      QUALITY GATE: {activeSonarReport?.qualityGate || 'UNKNOWN'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-500 font-mono mb-6">
                    Project: {activeSonarReport?.project || 'Select a service'}
                  </div>

                  {activeSonarReport ? (
                    <div className="grid grid-cols-2 gap-6 flex-1">
                      
                      <div className="p-4 bg-slate-900/50 border border-slate-800/80 rounded-xl flex flex-col justify-between">
                        <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Bugs & Vulnerabilities</span>
                        <div className="flex items-baseline space-x-2 mt-2">
                          <span className="text-2xl font-bold text-slate-200">{activeSonarReport.metrics.bugs}</span>
                          <span className="text-xs text-slate-500">Bugs</span>
                          <span className="text-2xl font-bold text-rose-400 ml-4">{activeSonarReport.metrics.vulnerabilities}</span>
                          <span className="text-xs text-slate-500">Vulnerabilities</span>
                        </div>
                      </div>

                      <div className="p-4 bg-slate-900/50 border border-slate-800/80 rounded-xl flex flex-col justify-between">
                        <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Code Smells</span>
                        <div className="text-2xl font-bold text-amber-400 mt-2">{activeSonarReport.metrics.codeSmells}</div>
                        <span className="text-[10px] text-slate-500 font-mono">Debt time: ~2h</span>
                      </div>

                      <div className="p-4 bg-slate-900/50 border border-slate-800/80 rounded-xl flex flex-col justify-between">
                        <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Test Coverage</span>
                        <div className="text-2xl font-bold text-cyan-400 mt-2">{activeSonarReport.metrics.coverage.toFixed(1)}%</div>
                        <div className="h-1.5 w-full bg-slate-800 rounded-full mt-2 overflow-hidden">
                          <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${activeSonarReport.metrics.coverage}%` }}></div>
                        </div>
                      </div>

                      <div className="p-4 bg-slate-900/50 border border-slate-800/80 rounded-xl flex flex-col justify-between">
                        <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Duplication Ratio</span>
                        <div className="text-2xl font-bold text-indigo-400 mt-2">{activeSonarReport.metrics.duplicatedLinesDensity.toFixed(1)}%</div>
                        <span className="text-[10px] text-slate-500 font-mono">Max target limit: 3.0%</span>
                      </div>

                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-500 font-mono flex-1">
                      <AlertTriangle className="w-12 h-12 text-amber-500 mb-3" />
                      <span>Select active microservice to inspect code quality.</span>
                    </div>
                  )}

                </div>

              </div>

            </div>
          )}

          {/* TAB 4: AI DIAGNOSTICS */}
          {activeTab === 'ai' && (
            <div className="space-y-8 animate-fadeIn max-w-5xl mx-auto">
              
              <div className="glass-panel p-6 rounded-2xl border-l-4 border-cyan-500">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-200">AI-Powered Log Analysis & Repair Suggestion</h2>
                    <p className="text-xs text-slate-500">Intelligent diagnostic report analyzing the container failure log snippet.</p>
                  </div>
                </div>

                {diagnosis ? (
                  <div className="space-y-6">
                    
                    {/* Error Tag */}
                    <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                      <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Identified Signature</div>
                      <div className="text-base font-bold text-rose-400 flex items-center">
                        <AlertTriangle className="w-5 h-5 mr-2 text-rose-400" /> {diagnosis.errorType}
                      </div>
                    </div>

                    {/* Explanations */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Root Cause Explanation</h4>
                        <p className="text-sm text-slate-300 leading-relaxed">{diagnosis.explanation}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Actionable Remediation steps</h4>
                        <div className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-900/50 p-4 border border-slate-800 rounded-xl font-mono">{diagnosis.remediation}</div>
                      </div>
                    </div>

                    {/* Suggested YAML Diff */}
                    {diagnosis.suggestedFix && (
                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Suggested YAML Patch (GitOps Pull Request)</h4>
                        <div className="border border-emerald-500/30 rounded-xl overflow-hidden">
                          <div className="bg-emerald-950/20 border-b border-emerald-950 px-4 py-2 font-mono text-[10px] text-emerald-400">
                            patch: deployment-remediation.yaml
                          </div>
                          <pre className="bg-slate-950 p-4 font-mono text-xs text-slate-300 overflow-x-auto scrollbar">
                            <code>{diagnosis.suggestedFix}</code>
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* Execute repair */}
                    <div className="flex space-x-4 pt-2">
                      <button 
                        onClick={() => {
                          handleAutoHeal(selectedService);
                          alert("GitOps pipeline triggered! ArgoCD is reconciling the new YAML fix in the devsecops-cluster.");
                        }}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm px-6 py-3 rounded-lg flex items-center shadow-lg transition-all"
                      >
                        <CheckCircle className="w-5 h-5 mr-2" /> Apply Remediated YAML via GitOps
                      </button>
                    </div>

                  </div>
                ) : (
                  <div className="py-20 flex flex-col items-center justify-center text-slate-500 font-mono">
                    <Sparkles className="w-12 h-12 text-slate-600 mb-3 animate-pulse" />
                    <span>No active AI diagnostics generated. Select a failed service (like `payment-service`) and click "Explain with AI" on the Telemetry tab.</span>
                  </div>
                )}
              </div>

              {/* Predictive Autoscaling widget */}
              <div className="glass-panel p-6 rounded-2xl">
                <h3 className="text-base font-semibold text-slate-200 mb-2 flex items-center">
                  <Activity className="w-5 h-5 mr-2 text-cyan-400" /> Predictive Infrastructure Autoscaling
                </h3>
                <p className="text-xs text-slate-500 mb-6">Uses telemetry history to project CPU/Memory curves and forecast cluster capacity issues.</p>
                
                <div className="flex flex-col md:flex-row gap-6 items-center justify-between">
                  <div className="space-y-4">
                    <button 
                      onClick={() => handleAIPredictScaling(selectedService)}
                      className="bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800 font-medium text-sm px-5 py-2.5 rounded-lg flex items-center transition-all"
                    >
                      Analyze Telemetry & Predict Scaling for {selectedService}
                    </button>
                    
                    {scalingPrediction && (
                      <div className="space-y-2 max-w-xl">
                        <div className="text-xs text-slate-400 font-mono leading-relaxed bg-slate-900 p-3 rounded border border-slate-800">
                          {scalingPrediction.reasoning}
                        </div>
                      </div>
                    )}
                  </div>

                  {scalingPrediction && (
                    <div className="p-6 bg-slate-900/50 border border-slate-800 rounded-2xl text-center w-64">
                      <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Recommended Scaling</div>
                      <div className="text-4xl font-bold text-cyan-400">{scalingPrediction.recommendedReplicas}</div>
                      <div className="text-xs text-slate-400 mt-1">Replicas (Current: {activeServiceObj?.replicas})</div>
                      <button 
                        onClick={() => handleScale(selectedService, scalingPrediction.recommendedReplicas)}
                        className="mt-4 w-full bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs py-2 rounded-lg transition-all"
                      >
                        Apply Scale Recommendation
                      </button>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 5: DEVOPS TROUBLESHOOTER CHATBOT */}
          {activeTab === 'chatbot' && (
            <div className="max-w-4xl mx-auto h-[600px] glass-panel rounded-2xl flex flex-col overflow-hidden animate-fadeIn">
              
              {/* Chat Header */}
              <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-200">DevOps Support Chatbot</h3>
                    <p className="text-[10px] text-emerald-400 font-mono">AI Diagnostics Engine Online</p>
                  </div>
                </div>
              </div>

              {/* Message List */}
              <div className="flex-1 p-6 overflow-y-auto space-y-6 scrollbar">
                {chatMessages.map((msg, index) => (
                  <div key={index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-lg p-4 rounded-2xl leading-relaxed text-sm ${
                      msg.sender === 'user' ? 'bg-cyan-600 text-white rounded-br-none' : 'bg-slate-900 text-slate-300 rounded-bl-none border border-slate-800'
                    }`}>
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                      
                      {msg.commands && (
                        <div className="mt-3 pt-3 border-t border-slate-800/80">
                          <div className="text-[10px] text-slate-500 font-semibold mb-1 uppercase tracking-wider">Suggested commands:</div>
                          {msg.commands.map((cmd, cIdx) => (
                            <code key={cIdx} className="block bg-slate-950 p-2 rounded text-[10px] font-mono text-cyan-400 border border-slate-800 mt-1 select-all cursor-pointer">
                              {cmd}
                            </code>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <div className="p-4 border-t border-slate-800 bg-slate-900/30 flex items-center space-x-3">
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                  placeholder="Ask a question (e.g. 'How to fix OOMKilled errors' or 'List WSO2 pods')..." 
                  className="flex-1 glass-input px-4 py-3 rounded-xl text-sm"
                />
                <button 
                  onClick={handleSendChat}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm px-6 py-3 rounded-xl shadow-lg transition-all"
                >
                  Send
                </button>
              </div>

            </div>
          )}

        </div>

      </main>

    </div>
  );
}
