/**
 * Voice Agent — AI voice assistant
 * Uses OpenAI Realtime API via WebRTC
 */

// ============================================
// Constants
// ============================================

const STORAGE_KEY = 'podcast_agent_settings';
const DIALOGUE_TIMEOUT_MS = 30000; // 30 sec silence → exit dialogue
const TRANSCRIPT_DEBOUNCE_MS = 500; // Pause before analyzing transcript

const DEFAULT_STOP_WORDS = 'thanks, stop, enough, bye';

const DEFAULT_SYSTEM_PROMPT = `You are a podcast participant named {agentName}. 
Respond briefly and to the point, like in a live conversation.
Speak naturally, you can use colloquial expressions.
Don't start your response with a greeting if it's a continuation of the dialogue.`;

const AgentMode = {
  IDLE: 'idle',
  DIALOGUE: 'dialogue'
};

// ============================================
// Tool Definitions
// ============================================

const TOOL_DEFINITIONS = {
  web_search: {
    type: 'function',
    name: 'web_search',
    description: 'Search for information on the internet. Use when you need to find current information, news, facts.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        }
      },
      required: ['query']
    }
  },
  get_current_datetime: {
    type: 'function',
    name: 'get_current_datetime',
    description: 'Get current date and time. Use when asked what time it is, what day it is, the date.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  calculator: {
    type: 'function',
    name: 'calculator',
    description: 'Perform mathematical calculations. Use for complex calculations.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression to calculate (e.g.: "2 + 2 * 3", "sqrt(16)", "sin(45)")'
        }
      },
      required: ['expression']
    }
  }
};

// ============================================
// Application State
// ============================================

let state = {
  mode: AgentMode.IDLE,
  isConnected: false,
  isSpeaking: false,
  apiKey: '',
  agentName: 'Alex',
  model: 'gpt-4o-mini-realtime-preview-2024-12-17',
  voice: 'alloy',
  nameVariants: [],
  stopWords: [],
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  tavilyKey: '',
  tools: {
    webSearch: true,
    dateTime: true,
    calculator: true
  },
  tavilyKey: ''
};

let peerConnection = null;
let dataChannel = null;
let mediaStream = null;
let audioElement = null;

let dialogueTimeout = null;
let transcriptBuffer = '';
let transcriptTimer = null;
let userIsSpeaking = false;

// ============================================
// DOM Elements
// ============================================

const elements = {
  apiKey: document.getElementById('apiKey'),
  agentName: document.getElementById('agentName'),
  systemPrompt: document.getElementById('systemPrompt'),
  promptContainer: document.getElementById('promptContainer'),
  togglePrompt: document.getElementById('togglePrompt'),
  resetPrompt: document.getElementById('resetPrompt'),
  toolsContainer: document.getElementById('toolsContainer'),
  toggleTools: document.getElementById('toggleTools'),
  toolWebSearch: document.getElementById('toolWebSearch'),
  toolDateTime: document.getElementById('toolDateTime'),
  toolCalculator: document.getElementById('toolCalculator'),
  tavilyKey: document.getElementById('tavilyKey'),
  webSearchConfig: document.getElementById('webSearchConfig'),
  stopWords: document.getElementById('stopWords'),
  voiceSelect: document.getElementById('voiceSelect'),
  modelSelect: document.getElementById('modelSelect'),
  rememberSettings: document.getElementById('rememberSettings'),
  connectBtn: document.getElementById('connectBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  clearSettings: document.getElementById('clearSettings'),
  saveSettings: document.getElementById('saveSettings'),
  toggleApiKey: document.getElementById('toggleApiKey'),
  statusIndicator: document.getElementById('statusIndicator'),
  modeIndicator: document.getElementById('modeIndicator'),
  transcriptLog: document.getElementById('transcriptLog'),
  clearTranscript: document.getElementById('clearTranscript'),
  instructions: document.getElementById('instructions'),
  // Audio indicator elements
  userRing: document.getElementById('userRing'),
  botRing: document.getElementById('botRing'),
  botStatus: document.getElementById('botStatus')
};

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
  updateUI();
});

function setupEventListeners() {
  elements.connectBtn.addEventListener('click', toggleConnection);
  
  if (elements.saveSettings) {
    elements.saveSettings.addEventListener('click', () => {
      saveSettings();
      alert('Настройки сохранены!');
    });
  }
  if (elements.clearSettings) {
    elements.clearSettings.addEventListener('click', clearSettings);
  }
  if (elements.resetPrompt) {
    elements.resetPrompt.addEventListener('click', resetSystemPrompt);
  }
  
  elements.agentName.addEventListener('input', () => {
    state.agentName = elements.agentName.value.trim() || 'Ави';
    updateNameVariants();
  });
  
  elements.systemPrompt.addEventListener('input', () => {
    state.systemPrompt = elements.systemPrompt.value || DEFAULT_SYSTEM_PROMPT;
  });
  
  if (elements.voiceSelect) {
    elements.voiceSelect.addEventListener('change', () => {
      state.voice = elements.voiceSelect.value;
    });
  }
  
  if (elements.modelSelect) {
    elements.modelSelect.addEventListener('change', () => {
      state.model = elements.modelSelect.value;
    });
  }
  
  // Tools
  if (elements.toolWebSearch) {
    elements.toolWebSearch.addEventListener('change', updateToolsState);
  }
  if (elements.toolDateTime) {
    elements.toolDateTime.addEventListener('change', updateToolsState);
  }
  if (elements.toolCalculator) {
    elements.toolCalculator.addEventListener('change', updateToolsState);
  }
  if (elements.tavilyKey) {
    elements.tavilyKey.addEventListener('input', () => {
      state.tavilyKey = elements.tavilyKey.value;
    });
  }
  
  if (elements.stopWords) {
    elements.stopWords.addEventListener('input', updateStopWords);
  }
}

// ============================================
// Settings (localStorage)
// ============================================

function loadSettings() {
  // Set defaults
  elements.systemPrompt.value = DEFAULT_SYSTEM_PROMPT;
  state.systemPrompt = DEFAULT_SYSTEM_PROMPT;
  if (elements.stopWords) {
    elements.stopWords.value = DEFAULT_STOP_WORDS;
  }
  updateStopWords();
  
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      const settings = JSON.parse(data);
      const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
      
      if (Date.now() - settings.savedAt < MAX_AGE) {
        elements.apiKey.value = settings.apiKey || '';
        elements.agentName.value = settings.agentName || 'Alex';
        // Settings loaded
        
        // Load system prompt if saved
        if (settings.systemPrompt) {
          elements.systemPrompt.value = settings.systemPrompt;
          state.systemPrompt = settings.systemPrompt;
        }
        
        // Load tool settings
        if (settings.tools) {
          state.tools = settings.tools;
          elements.toolWebSearch.checked = settings.tools.webSearch;
          elements.toolDateTime.checked = settings.tools.dateTime;
          elements.toolCalculator.checked = settings.tools.calculator;
        }
        
        if (settings.tavilyKey) {
          elements.tavilyKey.value = settings.tavilyKey;
          state.tavilyKey = settings.tavilyKey;
        }
        
        if (settings.stopWords && elements.stopWords) {
          elements.stopWords.value = settings.stopWords;
          updateStopWords();
        }
        
        if (settings.voice && elements.voiceSelect) {
          elements.voiceSelect.value = settings.voice;
          state.voice = settings.voice;
        }
        
        if (settings.model && elements.modelSelect) {
          elements.modelSelect.value = settings.model;
          state.model = settings.model;
        }
        
        state.agentName = settings.agentName || 'Alex';
        updateNameVariants();
        updateToolsState();
        return;
      }
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
  
  state.agentName = elements.agentName.value || 'Alex';
  updateNameVariants();
  updateToolsState();
}

function saveSettings() {
  const settings = {
    apiKey: elements.apiKey.value,
    agentName: elements.agentName.value,
    voice: elements.voiceSelect?.value || 'alloy',
    model: elements.modelSelect?.value || 'gpt-4o-mini-realtime-preview-2024-12-17',
    systemPrompt: elements.systemPrompt.value,
    stopWords: elements.stopWords?.value || DEFAULT_STOP_WORDS,
    tools: state.tools,
    tavilyKey: elements.tavilyKey.value,
    savedAt: Date.now()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  console.log('💾 Settings saved');
}

function clearSettings() {
  localStorage.removeItem(STORAGE_KEY);
  elements.apiKey.value = '';
  alert('Saved data cleared');
}

function resetSystemPrompt() {
  elements.systemPrompt.value = DEFAULT_SYSTEM_PROMPT;
  state.systemPrompt = DEFAULT_SYSTEM_PROMPT;
}

function updateToolsState() {
  state.tools.webSearch = elements.toolWebSearch.checked;
  state.tools.dateTime = elements.toolDateTime.checked;
  state.tools.calculator = elements.toolCalculator.checked;
  
  // Show/hide web search config
  if (elements.webSearchConfig) {
    elements.webSearchConfig.style.display = state.tools.webSearch ? 'block' : 'none';
  }
}

function updateStopWords() {
  const input = (elements.stopWords?.value) || DEFAULT_STOP_WORDS;
  state.stopWords = input
    .split(',')
    .map(word => word.trim().toLowerCase())
    .filter(word => word.length > 0);
  console.log('Stop words:', state.stopWords);
}

// ============================================
// Agent name and variants
// ============================================

function updateNameVariants() {
  const name = state.agentName.toLowerCase();
  state.nameVariants = [
    name,
    // Add variants with typical greetings
    `hey ${name}`,
    `hi ${name}`,
    `hello ${name}`,
    `listen ${name}`,
    `tell me ${name}`,
    `${name} tell me`,
    `${name} answer`,
    `${name} what`
  ];
}

function checkForName(text) {
  const lowerText = text.toLowerCase();
  return state.nameVariants.some(variant => lowerText.includes(variant));
}

function checkForStopPhrase(text) {
  const lowerText = text.toLowerCase();
  return state.stopWords.some(phrase => lowerText.includes(phrase));
}

// ============================================
// WebRTC Connection
// ============================================

async function connect() {
  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    alert('Please enter OpenAI API key');
    return;
  }
  
  if (!apiKey.startsWith('sk-')) {
    alert('API key must start with "sk-"');
    return;
  }
  
  state.agentName = elements.agentName.value.trim() || 'Alex';
  updateNameVariants();
  saveSettings();
  
  setStatus('connecting', 'Connecting...');
  updateBotStatus('connecting');
  elements.connectBtn.disabled = true;
  
  try {
    // 1. Get microphone access
    mediaStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });
    
    // 2. Create RTCPeerConnection
    peerConnection = new RTCPeerConnection();
    
    // 3. Add audio track
    mediaStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, mediaStream);
    });
    
    // 4. Create audio element for playback
    audioElement = document.createElement('audio');
    audioElement.autoplay = true;
    audioElement.playsInline = true;
    document.body.appendChild(audioElement);
    
    peerConnection.ontrack = (event) => {
      audioElement.srcObject = event.streams[0];
      audioElement.play().catch(() => {});
    };
    
    // 5. Create Data Channel
    dataChannel = peerConnection.createDataChannel('oai-events');
    setupDataChannel();
    
    // 6. Create offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // 7. Send offer to OpenAI and get answer
    const model = state.model || 'gpt-4o-mini-realtime-preview-2024-12-17';
    const response = await fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/sdp'
      },
      body: offer.sdp
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    
    const answerSdp = await response.text();
    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp
    });
    
    state.isConnected = true;
    showConnectedUI();
    
    logMessage(`Agent "${state.agentName}" ready`, 'system');
    
  } catch (error) {
    console.error('Connection error:', error);
    setStatus('error', `Error: ${error.message}`);
    disconnect();
  }
}

function setupDataChannel() {
  dataChannel.onopen = () => {
    
    // Configure session with user prompt
    const instructions = state.systemPrompt.replace(/{agentName}/g, state.agentName);
    
    // Collect active tools
    const tools = getActiveTools();
    
    sendEvent({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: instructions,
        voice: state.voice || 'alloy',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.6,
          prefix_padding_ms: 300,
          silence_duration_ms: 1200,
          create_response: false
        },
        tools: tools
      }
    });
    
    if (tools.length > 0) {
      logMessage(`Active tools: ${tools.map(t => t.name).join(', ')}`, 'system');
    }
    
    setStatus('idle', 'Listening (passive)');
    enterIdleMode();
  };
  
  dataChannel.onclose = () => {
    if (state.isConnected) disconnect();
  };
  
  dataChannel.onerror = () => {
    setStatus('error', 'Connection error');
  };
  
  dataChannel.onmessage = handleServerEvent;
}

function sendEvent(event) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(event));
  }
}

// ============================================
// Server Event Handling
// ============================================

function handleServerEvent(event) {
  const data = JSON.parse(event.data);
  
  const ts = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  
  switch (data.type) {
    case 'session.created':
      console.log(`[${ts()}] ✅ Session created`);
      break;
    case 'session.updated':
      console.log(`[${ts()}] ✅ Session updated`);
      break;
      
    case 'input_audio_buffer.speech_started':
      userIsSpeaking = true;
      setUserSpeaking(true);
      console.log(`[${ts()}] �️ [SPEECH START] User started speaking`);
      break;
      
    case 'input_audio_buffer.speech_stopped':
      userIsSpeaking = false;
      setUserSpeaking(false);
      console.log(`[${ts()}] �️ [SPEECH STOP] User stopped speaking`);
      finalizeTranscript();
      break;
      
    case 'conversation.item.input_audio_transcription.completed':
      console.log(`[${ts()}] 📝 [TRANSCRIPT]`, data.transcript);
      handleTranscription(data.transcript);
      break;
      
    case 'response.audio_transcript.delta':
      // Partial agent response transcript (many events, don't log)
      break;
      
    case 'response.audio_transcript.done':
      // Full agent response transcript
      if (data.transcript) {
        console.log(`[${ts()}] 🤖 [AGENT]`, data.transcript);
        logMessage(data.transcript, 'agent');
      }
      break;
      
    case 'response.done':
      handleResponseDone(data);
      break;
      
    case 'response.function_call_arguments.done':
      // Function call completed, handle it
      handleFunctionCall(data);
      break;
      
    case 'error':
      console.error('API Error:', data.error?.message);
      break;
      
    default:
      break;
  }
}

// ============================================
// Transcription and Response Logic
// ============================================

function handleTranscription(transcript) {
  if (!transcript || transcript.trim() === '') return;
  
  const ts = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  
  // Add to buffer
  transcriptBuffer += ' ' + transcript;
  console.log(`[${ts()}] 📝 [BUFFER]`, transcriptBuffer.trim());
  
  // If user already stopped speaking - process
  if (!userIsSpeaking) {
    finalizeTranscript();
  }
}

function finalizeTranscript() {
  // Process accumulated text
  clearTimeout(transcriptTimer);
  transcriptTimer = setTimeout(() => {
    if (transcriptBuffer.trim()) {
      processTranscript(transcriptBuffer.trim());
      transcriptBuffer = '';
    }
  }, TRANSCRIPT_DEBOUNCE_MS);
}

function processTranscript(text) {
  if (!text) return;
  
  const ts = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  
  console.log(`[${ts()}] 🔍 [PROCESS]`, text);
  console.log(`[${ts()}] 🔍 [MODE]`, state.mode, '| [NAME CHECK]', checkForName(text));
  
// In dialogue mode check stop phrases
  if (state.mode === AgentMode.DIALOGUE) {
    if (checkForStopPhrase(text)) {
      logMessage(`${state.agentName} ending dialogue`, 'system');
      exitDialogueMode();
      return;
    }
    
    // In dialogue mode respond to everything
    respond();
    resetDialogueTimeout();
    return;
  }
  
  // In IDLE mode respond only if name found
  if (state.mode === AgentMode.IDLE) {
    if (checkForName(text)) {
      enterDialogueMode();
      respond();
    }
  }
}

function respond() {
  state.isSpeaking = true;
  setBotSpeaking(true);
  setStatus('speaking', 'Speaking...');
  
  sendEvent({
    type: 'response.create',
    response: {
      modalities: ['text', 'audio']
    }
  });
}

function handleResponseDone(data) {
  state.isSpeaking = false;
  setBotSpeaking(false);
  
  if (state.mode === AgentMode.DIALOGUE) {
    setStatus('dialogue', 'Dialogue active');
    resetDialogueTimeout();
  } else {
    setStatus('idle', 'Listening (passive)');
  }
}

// ============================================
// Tools
// ============================================

function getActiveTools() {
  const tools = [];
  
  if (state.tools.webSearch && state.tavilyKey) {
    tools.push(TOOL_DEFINITIONS.web_search);
  }
  if (state.tools.dateTime) {
    tools.push(TOOL_DEFINITIONS.get_current_datetime);
  }
  if (state.tools.calculator) {
    tools.push(TOOL_DEFINITIONS.calculator);
  }
  
  return tools;
}

async function handleFunctionCall(data) {
  const { name, arguments: argsString, call_id } = data;
  
  let result;
  try {
    const args = JSON.parse(argsString || '{}');
    
    switch (name) {
      case 'web_search':
        result = await executeWebSearch(args.query);
        break;
      case 'get_current_datetime':
        result = executeGetDateTime();
        break;
      case 'calculator':
        result = executeCalculator(args.expression);
        break;
      default:
        result = { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    result = { error: e.message };
  }
  
  // Send result back
  sendEvent({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: call_id,
      output: JSON.stringify(result)
    }
  });
  
  // Set flag that agent will speak
  state.isSpeaking = true;
  setStatus('speaking', 'Speaking...');
  
  // Request response continuation
  sendEvent({
    type: 'response.create',
    response: {
      modalities: ['text', 'audio']
    }
  });
}

async function executeWebSearch(query) {
  if (!state.tavilyKey) {
    return { error: 'Tavily API key not configured' };
  }
  
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: state.tavilyKey,
        query: query,
        search_depth: 'basic',
        max_results: 5
      })
    });
    
    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Format results
    const results = data.results?.map(r => ({
      title: r.title,
      content: r.content?.substring(0, 300),
      url: r.url
    })) || [];
    
    return {
      query: query,
      results: results,
      answer: data.answer || null
    };
  } catch (e) {
    return { error: e.message };
  }
}

function executeGetDateTime() {
  const now = new Date();
  const options = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  };
  
  return {
    datetime: now.toISOString(),
    formatted: now.toLocaleDateString('en-US', options),
    timestamp: now.getTime()
  };
}

function executeCalculator(expression) {
  try {
    // Safe calculation: only basic operations
    // First check for allowed characters (before any replacements)
    const allowedPattern = /^[\d\s+\-*/().,%^]+$/;
    const cleanExpr = expression.replace(/sqrt|sin|cos|tan|log|exp|abs|pow|pi|PI|e|E/gi, '');
    
    if (!allowedPattern.test(cleanExpr)) {
      throw new Error('Invalid characters in expression');
    }
    
    // Replace math functions
    let safeExpr = expression
      .replace(/\bsqrt\b/gi, 'Math.sqrt')
      .replace(/\bsin\b/gi, 'Math.sin')
      .replace(/\bcos\b/gi, 'Math.cos')
      .replace(/\btan\b/gi, 'Math.tan')
      .replace(/\blog\b/gi, 'Math.log')
      .replace(/\bexp\b/gi, 'Math.exp')
      .replace(/\babs\b/gi, 'Math.abs')
      .replace(/\bpow\b/gi, 'Math.pow')
      .replace(/\bPI\b/g, 'Math.PI')
      .replace(/\bpi\b/g, 'Math.PI')
      .replace(/\be\b/g, 'Math.E')
      .replace(/\^/g, '**')
      .replace(/%/g, '/100*');
    
    // Final check: only Math.*, numbers and operators
    const finalPattern = /^[\d\s+\-*/().Math,]+$/;
    if (!finalPattern.test(safeExpr)) {
      throw new Error('Invalid expression');
    }
    
    // Additional protection: check for dangerous constructs
    if (/\b(eval|function|return|var|let|const|window|document|this)\b/i.test(safeExpr)) {
      throw new Error('Forbidden keywords');
    }
    
    const result = Function('"use strict"; return (' + safeExpr + ')')();
    
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Result is not a number');
    }
    
    return {
      expression: expression,
      result: result
    };
  } catch (e) {
    return {
      expression: expression,
      error: e.message
    };
  }
}

// ============================================
// Operating Modes
// ============================================

function enterDialogueMode() {
  state.mode = AgentMode.DIALOGUE;
  setStatus('dialogue', 'Dialogue active');
  updateModeIndicator();
  resetDialogueTimeout();
}

function exitDialogueMode() {
  state.mode = AgentMode.IDLE;
  clearTimeout(dialogueTimeout);
  setStatus('idle', 'Listening (passive)');
  updateModeIndicator();
}

function enterIdleMode() {
  state.mode = AgentMode.IDLE;
  clearTimeout(dialogueTimeout);
  updateModeIndicator();
}

function resetDialogueTimeout() {
  clearTimeout(dialogueTimeout);
  dialogueTimeout = setTimeout(() => {
    exitDialogueMode();
  }, DIALOGUE_TIMEOUT_MS);
}

// ============================================
// Disconnection
// ============================================

function disconnect() {
  clearTimeout(dialogueTimeout);
  clearTimeout(transcriptTimer);
  transcriptBuffer = '';
  
  // Reset indicators
  setUserSpeaking(false);
  setBotSpeaking(false);
  
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  
  if (audioElement) {
    audioElement.srcObject = null;
    audioElement.remove();
    audioElement = null;
  }
  
  state.isConnected = false;
  state.isSpeaking = false;
  state.mode = AgentMode.IDLE;
  
  showDisconnectedUI();
  setStatus('disconnected', 'Disconnected');
  updateModeIndicator();
  updateBotStatus('disconnected');
}

// ============================================
// UI Updates
// ============================================

function setStatus(status, text) {
  elements.statusIndicator.dataset.status = status;
  elements.statusIndicator.querySelector('.status-text').textContent = text;
}

function updateModeIndicator() {
  // Update old indicator (for compatibility)
  const badge = elements.modeIndicator?.querySelector('.mode-badge');
  if (badge) {
    badge.textContent = state.mode === AgentMode.IDLE ? 'Mode: IDLE' : 'Mode: DIALOGUE';
  }
  
  // Update new bot status indicator
  updateBotStatus();
}

function updateBotStatus(status) {
  if (!elements.botStatus) return;
  
  const statusLabel = elements.botStatus.querySelector('.status-label');
  
  // Remove all state classes
  elements.botStatus.classList.remove('active', 'connecting', 'disconnected', 'idle');
  
  if (status === 'connecting') {
    elements.botStatus.classList.add('connecting');
    if (statusLabel) statusLabel.textContent = 'Connecting...';
  } else if (status === 'disconnected' || !state.isConnected) {
    elements.botStatus.classList.add('disconnected');
    if (statusLabel) statusLabel.textContent = 'Disconnected';
  } else if (state.mode === AgentMode.DIALOGUE) {
    elements.botStatus.classList.add('active');
    if (statusLabel) statusLabel.textContent = 'Dialogue active';
  } else {
    elements.botStatus.classList.add('idle');
    if (statusLabel) statusLabel.textContent = 'Waiting';
  }
}

function updateUI() {
  // Initial state
  setStatus('disconnected', 'Disconnected');
  updateBotStatus('disconnected');
}

function toggleConnection() {
  if (state.isConnected) {
    disconnect();
  } else {
    connect();
  }
}

function showConnectedUI() {
  elements.connectBtn.classList.add('connected');
  elements.connectBtn.querySelector('.btn-text').textContent = 'Disconnect';
  elements.connectBtn.disabled = false;
}

function showDisconnectedUI() {
  elements.connectBtn.classList.remove('connected');
  elements.connectBtn.querySelector('.btn-text').textContent = 'Connect';
  elements.connectBtn.disabled = false;
}

// ============================================
// Event-based Indicators
// ============================================

function setUserSpeaking(speaking) {
  if (elements.userRing) {
    if (speaking) {
      elements.userRing.style.setProperty('--level', 100);
      elements.userRing.classList.add('active');
    } else {
      elements.userRing.style.setProperty('--level', 0);
      elements.userRing.classList.remove('active');
    }
  }
}

function setBotSpeaking(speaking) {
  if (elements.botRing) {
    if (speaking) {
      elements.botRing.style.setProperty('--level', 100);
      elements.botRing.classList.add('active');
    } else {
      elements.botRing.style.setProperty('--level', 0);
      elements.botRing.classList.remove('active');
    }
  }
}

// ============================================
// Transcript Log
// ============================================

function logMessage(text, type = 'user') {
  // Transcription removed from UI, but function kept for compatibility
  console.log(`[${type}] ${text}`);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

