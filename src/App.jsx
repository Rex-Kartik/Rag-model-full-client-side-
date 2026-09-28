import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import { generateEmbedding, chunkText, cosineSimilarity } from './vectorStore';
import { GoogleGenerativeAI } from '@google/generative-ai';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

// We keep the axios api for Ollama fallback if needed, but RAG is 100% client-side now.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000' });

function App() {
  const [chatHistory, setChatHistory] = useState([]);
  const [query, setQuery] = useState('');
  const [rawText, setRawText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  
  // OCR & Ingestion State
  const [isIngesting, setIsIngesting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState({ status: '', progress: 0 });
  const [showCitations, setShowCitations] = useState(true);

  // New Client-Side Vector DB State
  const [clientVectorDb, setClientVectorDb] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rag_clientVectorDb')) || []; } catch { return []; }
  });

  // New Feature States
  const [toast, setToast] = useState(null); // { message, type: 'success' | 'error' }
  const [uploadedDocs, setUploadedDocs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rag_uploadedDocs')) || []; } catch { return []; }
  });
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem('rag_clientVectorDb', JSON.stringify(clientVectorDb));
    } catch (e) {
      console.warn("Storage quota exceeded", e);
    }
  }, [clientVectorDb]);

  useEffect(() => {
    try {
      localStorage.setItem('rag_uploadedDocs', JSON.stringify(uploadedDocs));
    } catch (e) {}
  }, [uploadedDocs]);
  
  // LLM Engine Settings
  const [llmModel, setLlmModel] = useState(() => localStorage.getItem('rag_llmModel') || 'gemini-1.5-flash');
  const [llmApiKey, setLlmApiKey] = useState(() => localStorage.getItem('rag_llmApiKey') || '');
  const [isSettingsValid, setIsSettingsValid] = useState(() => localStorage.getItem('rag_settingsValid') === 'true');
  const [showSettings, setShowSettings] = useState(() => !(localStorage.getItem('rag_settingsValid') === 'true'));
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState('');
  
  useEffect(() => {
    localStorage.setItem('rag_llmModel', llmModel);
    localStorage.setItem('rag_llmApiKey', llmApiKey);
    localStorage.setItem('rag_settingsValid', isSettingsValid);
  }, [llmModel, llmApiKey, isSettingsValid]);

  const chatFeedRef = useRef(null);
  const wipeCounterRef = useRef(0);

  // Initialize and load status
  useEffect(() => {
    fetchStatus();
    // Auto-scroll chat to bottom when updated
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // Sync Dark Mode with <html> tag
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSaveSettings = async () => {
    setIsValidating(true);
    setValidationError('');
    try {
      if (!llmApiKey.trim()) throw new Error('API Key cannot be empty.');
      if (!llmModel.trim()) throw new Error('Model Name cannot be empty.');
      
      const genAI = new GoogleGenerativeAI(llmApiKey.trim());
      const model = genAI.getGenerativeModel({ model: llmModel.trim() });
      await model.generateContent("Test");
      
      setIsSettingsValid(true);
      setShowSettings(false);
      showToast("Settings validated and saved!", "success");
    } catch (error) {
      console.error(error);
      const msg = error.message.toLowerCase();
      if (msg.includes('api key not valid') || msg.includes('400') || msg.includes('key')) {
        setValidationError("Invalid API Key. Please check your key and try again.");
      } else if (msg.includes('not found') || msg.includes('404') || msg.includes('model')) {
        setValidationError(`Model '${llmModel}' not found. Please check the model name.`);
      } else {
        setValidationError(`Validation failed: ${error.message}`);
      }
      setIsSettingsValid(false);
    } finally {
      setIsValidating(false);
    }
  };

  const fetchStatus = async () => {
    // No-op. Status is tracked automatically in client-side state now.
  };

  const handleClearDB = async () => {
    if (!window.confirm("Are you sure you want to wipe the local Vector Database?")) return;
    wipeCounterRef.current += 1;
    setClientVectorDb([]);
    setUploadedDocs([]);
    showToast("Knowledge base cleared.", "success");
    setChatHistory([]); 
  };

  const ingestToClientVectorDb = async (text, sourceName) => {
    const chunks = chunkText(text, 512, 64);
    const newDbEntries = [];
    
    for (let i = 0; i < chunks.length; i++) {
      setOcrProgress({ status: `Generating Local Embeddings ${i+1}/${chunks.length}...`, progress: Math.round((i/chunks.length)*100) });
      const embedding = await generateEmbedding(chunks[i]);
      newDbEntries.push({
        id: `${sourceName}_${i}_${Date.now()}`,
        text: chunks[i],
        source: sourceName,
        embedding: embedding
      });
    }
    
    setClientVectorDb(prev => [...prev, ...newDbEntries]);
    setUploadedDocs(prev => {
      if (prev.find(d => d.source === sourceName)) return prev;
      return [...prev, { source: sourceName, chunk_count: chunks.length }];
    });
  };

  const handleIngestText = async () => {
    if (!rawText.trim()) return;
    setIsIngesting(true);
    setOcrProgress({ status: 'Processing text...', progress: 0 });
    try {
      await ingestToClientVectorDb(rawText, 'Pasted_Raw_Text');
      showToast("Text successfully embedded in browser!");
      setRawText('');
    } catch (error) {
      showToast("Error generating embeddings.", "error");
    } finally {
      setIsIngesting(false);
      setOcrProgress({ status: '', progress: 0 });
    }
  };

  const performOcrOnImage = async (imageSource) => {
    const worker = await Tesseract.createWorker("eng", 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          setOcrProgress({ status: 'Running Client OCR...', progress: Math.round(m.progress * 100) });
        }
      }
    });
    try {
      const { data: { text } } = await worker.recognize(imageSource);
      return text;
    } finally {
      await worker.terminate();
    }
  };

  const processPdfWithOcr = async (file) => {
    setOcrProgress({ status: 'Loading PDF for Client OCR...', progress: 0 });
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullExtractedText = "";
    
    for (let i = 1; i <= pdf.numPages; i++) {
      setOcrProgress({ status: `Rendering page ${i}/${pdf.numPages}...`, progress: 0 });
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      
      setOcrProgress({ status: `Running OCR on page ${i}/${pdf.numPages}...`, progress: 0 });
      const pageText = await performOcrOnImage(canvas);
      fullExtractedText += `\n--- Page ${i} ---\n` + pageText;
    }
    return fullExtractedText;
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsIngesting(true);
    setOcrProgress({ status: 'Initializing...', progress: 0 });

    try {
      if (file.type.startsWith('image/')) {
        const text = await performOcrOnImage(file);
        setOcrProgress({ status: 'Embedding text locally...', progress: 100 });
        await ingestToClientVectorDb(text, file.name);
        showToast(`Image OCR & Embedding successful!`);
      } 
      else if (file.type === 'application/pdf') {
        const text = await processPdfWithOcr(file);
        setOcrProgress({ status: 'Embedding PDF text locally...', progress: 100 });
        await ingestToClientVectorDb(text, file.name);
        showToast(`PDF OCR & Embedding successful!`);
      } 
      else {
        // Assume text file
        const text = await file.text();
        setOcrProgress({ status: 'Embedding text file locally...', progress: 100 });
        await ingestToClientVectorDb(text, file.name);
        showToast(`Text file embedded successfully!`);
      }
    } catch (error) {
      console.error(error);
      showToast("Error during processing: " + error.message, "error");
    } finally {
      setIsIngesting(false);
      setOcrProgress({ status: '', progress: 0 });
      e.target.value = null;
    }
  };

  const handleSendChat = async (e) => {
    if (e && e.key && e.key !== 'Enter') return;
    if (!query.trim() || isThinking) return;

    const userMessage = { sender: 'user', text: query };
    setChatHistory(prev => [...prev, userMessage]);
    setQuery('');
    setIsThinking(true);

    const currentWipeCount = wipeCounterRef.current;

    try {
      // 1. Client-Side Retrieval
      let topChunks = [];
      if (clientVectorDb.length > 0) {
        const queryEmbedding = await generateEmbedding(userMessage.text);
        const scored = clientVectorDb.map(entry => ({
          ...entry,
          score: cosineSimilarity(queryEmbedding, entry.embedding)
        }));
        scored.sort((a, b) => b.score - a.score);
        topChunks = scored.slice(0, 3);
      }

      const contextText = topChunks.map(c => c.text).join('\n\n');
      const prompt = `You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question. If you don't know the answer, say that you don't know. Answer directly and conversationally.\n\nContext: ${contextText}\n\nHuman: ${userMessage.text}`;

      // 2. Direct LLM Call
      let rawAnswer = "";
      const genAI = new GoogleGenerativeAI(llmApiKey || 'dummy');
      const model = genAI.getGenerativeModel({ model: llmModel || "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      rawAnswer = result.response.text();

      rawAnswer = rawAnswer.replace(/^(According to the retrieved context,|According to the context,|Based on the provided context,|Based on the context,)\s*/i, '');
      
      const aiMessage = { 
        sender: 'ai', 
        text: rawAnswer, 
        sources: topChunks.map((c, i) => ({ id: i+1, text: c.text, source: c.source })) 
      };
      if (wipeCounterRef.current === currentWipeCount) {
        setChatHistory(prev => [...prev, aiMessage]);
      }
    } catch (error) {
      console.error(error);
      if (wipeCounterRef.current === currentWipeCount) {
        setChatHistory(prev => [...prev, { sender: 'ai', text: "Error generating response. Check your API key or model settings." }]);
      }
      showToast("Failed to generate response.", "error");
    } finally {
      if (wipeCounterRef.current === currentWipeCount) {
        setIsThinking(false);
      }
    }
  };

  return (
    <div className="bg-background min-h-screen text-on-surface font-body-md flex flex-col transition-colors duration-300">
      
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-20 right-8 z-50 px-6 py-3 rounded-lg shadow-xl font-label-md text-label-md transition-all duration-300 flex items-center gap-2 ${toast.type === 'error' ? 'bg-error text-on-error-container' : 'bg-secondary-container text-on-secondary-container'}`}>
          <span className="material-symbols-outlined text-[18px]">
            {toast.type === 'error' ? 'error' : 'check_circle'}
          </span>
          {toast.message}
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container-low rounded-xl shadow-2xl p-space-lg w-full max-w-md flex flex-col gap-space-md animate-slide-up border border-outline-variant/30">
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-3">
              <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">settings</span> LLM Configuration
              </h2>
              {isSettingsValid && (
                <button onClick={() => setShowSettings(false)} className="text-outline hover:text-on-surface">
                  <span className="material-symbols-outlined">close</span>
                </button>
              )}
            </div>
            
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 text-sm text-on-surface-variant bg-surface-container-high p-3 rounded-lg mb-2">
                <p>This workspace connects directly to Google Gemini from your browser.</p>
                <p className="mt-1">Provide your model and API key below to continue.</p>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-label-md text-label-md text-on-surface">Model Name</label>
                <input 
                  type="text" 
                  value={llmModel} 
                  onChange={(e) => setLlmModel(e.target.value)}
                  placeholder="e.g., gemini-1.5-flash"
                  className="bg-surface-container text-on-surface p-2 rounded outline-none border border-outline-variant focus:border-primary"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-label-md text-label-md text-on-surface">API Key</label>
                <input 
                  type="password" 
                  value={llmApiKey} 
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  placeholder="Enter Gemini API Key here..."
                  className="bg-surface-container text-on-surface p-2 rounded outline-none border border-outline-variant focus:border-primary"
                />
              </div>
            </div>

            {validationError && (
              <div className="text-error font-body-sm text-body-sm p-2 bg-error/10 rounded border border-error/30 flex items-center gap-2 mt-1">
                <span className="material-symbols-outlined text-[16px]">error</span>
                {validationError}
              </div>
            )}

            <button 
              onClick={handleSaveSettings}
              disabled={isValidating}
              className="mt-2 w-full py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md rounded-lg transition-colors flex justify-center items-center gap-2 disabled:opacity-70"
            >
              {isValidating && <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>}
              {isValidating ? "Validating Connection..." : "Save & Close"}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-surface-container-low/95 backdrop-blur-md shadow-[0_1px_8px_rgba(0,0,0,0.25)] h-14 px-margin flex items-center justify-between transition-colors duration-300">
        <div className="flex items-center gap-space-lg">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-primary text-[28px]">rocket_launch</span>
            <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight">RAG Workbench</span>
          </div>
        </div>
        <div className="flex items-center gap-space-sm">
          <div className="flex items-center gap-space-xs bg-surface-container-high px-space-sm py-1 rounded hidden sm:flex">
            <span className="material-symbols-outlined text-[14px] text-tertiary">database</span>
            <span className="font-code-sm text-code-sm text-on-surface-variant">collection:</span>
            <span className="font-code-sm text-code-sm text-tertiary font-semibold">chroma-v1</span>
          </div>
          
          {/* Dark Mode Toggle */}
          <button 
            onClick={() => setIsDark(!isDark)}
            className="w-9 h-9 rounded-full hover:bg-surface-container-high flex items-center justify-center text-outline hover:text-on-surface transition-colors"
            title="Toggle Dark/Light Mode"
          >
            <span className="material-symbols-outlined text-[20px]">{isDark ? 'light_mode' : 'dark_mode'}</span>
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="pt-20 px-margin grid grid-cols-1 xl:grid-cols-12 gap-space-lg max-w-[1600px] mx-auto w-full pb-10 flex-1">
        
        {/* LEFT COLUMN: KNOWLEDGE INGESTION */}
        <div className="xl:col-span-4 flex flex-col gap-space-md">
          
          <div className="bg-surface-container-low border border-surface-container-highest p-space-md rounded-xl shadow-sm flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-primary text-[20px]">layers</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">Knowledge Ingestion</span>
              </div>
              <span className={`w-2 h-2 rounded-full ${clientVectorDb.length > 0 ? 'bg-secondary' : 'bg-outline'} animate-pulse`}></span>
            </div>
            <div className="mt-space-xs p-space-sm bg-surface-container rounded-lg flex items-center justify-between">
              <span className="font-label-code text-label-code text-outline mt-0.5">Vector DB Status</span>
              <div className="flex items-center gap-space-xs bg-surface-container-highest px-space-sm py-1 rounded">
                <span className="font-code-sm text-code-sm text-secondary font-semibold">{clientVectorDb.length} chunks loaded</span>
              </div>
            </div>
          </div>

          <div className="bg-surface-container-low border border-surface-container-highest p-space-md rounded-xl shadow-sm flex flex-col gap-space-sm">
            <label className={`focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-surface-container-low p-space-lg rounded-lg border-2 border-dashed border-outline-variant/50 transition-colors flex flex-col items-center justify-center text-center ${isIngesting ? 'opacity-50 cursor-not-allowed bg-surface-container-lowest/60' : 'hover:bg-surface-container/40 hover:border-primary/50 cursor-pointer bg-surface-container-lowest/60'} group`}>
              <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-primary group-hover:bg-primary-container group-hover:text-on-primary-container transition-colors mb-space-xs">
                <span className="material-symbols-outlined text-[22px]">cloud_upload</span>
              </div>
              <span className="font-label-md text-label-md text-on-surface">Click to upload File</span>
              <span className="font-body-sm text-body-sm text-outline mt-0.5">PDF, TXT, PNG, JPG</span>
              <input type="file" className="sr-only" accept=".pdf,.txt,.md,.png,.jpg,.jpeg" onChange={handleFileUpload} disabled={isIngesting} />
            </label>

            {isIngesting && ocrProgress.status && (
              <div className="flex flex-col gap-1 mt-2 p-3 bg-surface-container rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="font-code-sm text-code-sm text-primary">{ocrProgress.status}</span>
                  <span className="font-code-sm text-code-sm text-outline">{ocrProgress.progress}%</span>
                </div>
                <div className="w-full bg-surface-container-highest h-1.5 rounded overflow-hidden mt-1">
                  <div className="bg-primary h-full transition-all duration-300" style={{ width: `${ocrProgress.progress}%` }}></div>
                </div>
              </div>
            )}

            <details className="group bg-surface-container rounded-lg overflow-hidden mt-space-sm">
              <summary className="flex items-center justify-between p-space-sm cursor-pointer hover:bg-surface-container-high transition-colors">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-outline text-[16px]">text_snippet</span>
                  <span className="font-label-md text-label-md text-on-surface">Unstructured Raw Payload</span>
                </div>
              </summary>
              <div className="p-space-sm bg-surface-container-lowest/80 flex flex-col gap-space-xs">
                <textarea 
                  className="w-full h-32 bg-surface-container-lowest text-on-surface border border-outline-variant rounded p-2 text-sm outline-none focus:border-primary transition-colors"
                  placeholder="Paste text here..."
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                />
                <button 
                  onClick={handleIngestText} 
                  disabled={isIngesting || !rawText.trim()}
                  className="w-full py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md rounded-lg flex items-center justify-center gap-space-xs shadow-md transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[18px]">account_tree</span>
                  <span>Index Text Data</span>
                </button>
              </div>
            </details>
          </div>

          {/* Uploaded Documents List */}
          {uploadedDocs.length > 0 && (
            <div className="bg-surface-container-low border border-surface-container-highest p-space-md rounded-xl shadow-sm flex flex-col gap-space-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="font-label-code text-label-code uppercase tracking-wider text-outline">Uploaded Knowledge Base</span>
                <span className="px-2 py-0.5 rounded bg-surface-container-high text-tertiary font-code-sm text-code-sm">{uploadedDocs.length} Docs</span>
              </div>
              <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                {uploadedDocs.map((doc, idx) => (
                  <div key={idx} className="flex items-center gap-space-sm p-space-sm bg-surface-container rounded-lg hover:bg-surface-container-high transition-colors">
                    <span className="material-symbols-outlined text-outline text-[18px] shrink-0">draft</span>
                    <span className="font-body-sm text-body-sm text-on-surface truncate flex-1" title={doc.source}>{doc.source}</span>
                  </div>
                ))}
              </div>
              <button onClick={handleClearDB} className="mt-2 w-full py-1.5 border border-error/50 hover:bg-error/10 text-error font-label-md text-label-md rounded-lg flex items-center justify-center gap-2 transition-colors">
                <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
                Wipe Knowledge Base
              </button>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: CHAT INTERFACE */}
        <div className="xl:col-span-8 flex flex-col gap-space-md h-[calc(100vh-120px)]">
          
          <div className="bg-surface-container-low border border-surface-container-highest p-space-md rounded-xl shadow-sm flex flex-col gap-space-sm shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <span className="font-label-md text-label-md text-outline">Workspace</span>
                <span className="text-outline">/</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">Grounded Reasoning Studio</span>
                <span className="px-space-xs py-0.5 rounded bg-surface-container-highest text-secondary font-label-code text-label-code ml-space-xs">Live Trace</span>
              </div>
              <button 
                onClick={() => setChatHistory([])}
                className="flex items-center gap-1 text-outline hover:text-on-surface transition-colors font-label-code text-label-code"
                title="Clear Chat History"
              >
                <span className="material-symbols-outlined text-[16px]">mop</span>
                Clear Chat
              </button>
            </div>
            
            <div className="flex flex-wrap items-center gap-space-xs pt-space-xs border-t border-outline-variant/30 mt-2">
              <span className="font-label-code text-label-code text-outline uppercase tracking-wider mr-space-xs">LLM Engine:</span>
              <button 
                onClick={() => setShowSettings(true)}
                className="px-space-sm py-0.5 rounded bg-surface-container-high hover:bg-surface-container-highest transition-colors text-primary font-code-sm text-code-sm flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">smart_toy</span> {llmModel} (Google Gemini)
              </button>
              <div className="ml-auto flex items-center gap-1 cursor-pointer hover:bg-surface-container-highest px-2 py-1 rounded transition-colors text-outline font-label-code text-label-code" onClick={() => setShowCitations(!showCitations)}>
                <span className={`material-symbols-outlined text-[14px] ${showCitations ? 'text-secondary' : 'text-outline'}`}>
                  {showCitations ? 'visibility' : 'visibility_off'}
                </span>
                <span>Raw Chunks: {showCitations ? 'ON' : 'OFF'}</span>
              </div>
            </div>
          </div>

          <div ref={chatFeedRef} className="flex-1 overflow-y-auto flex flex-col gap-space-md pr-2 pb-4 scroll-smooth">
            {chatHistory.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-outline animate-fade-in">
                <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-[32px] text-primary">forum</span>
                </div>
                <h3 className="text-on-surface font-headline-sm text-headline-sm mb-1">Welcome to your RAG Studio</h3>
                <p className="max-w-sm text-center font-body-sm text-body-sm">Upload a document on the left, and ask a question below to magically extract insights using Llama 3.</p>
              </div>
            ) : (
              chatHistory.map((msg, idx) => (
                <div key={idx} className={`flex flex-col gap-space-xs ${msg.sender === 'user' ? 'self-end max-w-2xl' : 'w-full'} animate-slide-up`}>
                  {msg.sender === 'user' ? (
                    <div className="bg-surface-container-high p-space-md rounded-xl rounded-tr-none shadow-sm flex flex-col gap-space-xs">
                      <span className="font-label-code text-label-code text-primary font-semibold">User Query</span>
                      <p className="font-body-md text-body-md text-on-surface">{msg.text}</p>
                    </div>
                  ) : (
                    <div className="bg-surface-container-low p-space-md rounded-xl shadow-sm flex flex-col gap-space-md border border-surface-container-highest">
                      <div className="flex items-center gap-space-xs">
                        <span className="material-symbols-outlined text-primary text-[20px]">auto_awesome</span>
                        <span className="font-headline-sm text-headline-sm text-on-surface">Grounded Synthesis</span>
                        {msg.sources && msg.sources.length > 0 && (
                          <span className="ml-2 px-space-xs py-0.5 rounded-full bg-secondary/10 text-secondary font-label-code text-label-code font-semibold">✓ Grounded</span>
                        )}
                      </div>
                      <div className="font-body-lg text-body-lg text-on-surface leading-relaxed whitespace-pre-wrap">
                        {msg.text}
                      </div>
                      
                      {msg.sources && msg.sources.length > 0 && showCitations && (
                        <details className="flex flex-col gap-space-xs pt-space-xs mt-4 border-t border-outline-variant/30 group">
                          <summary className="font-label-code text-label-code uppercase tracking-wider text-outline mb-2 cursor-pointer hover:text-on-surface flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] group-open:-rotate-180 transition-transform">expand_more</span>
                            Cited Vector Context Chunks
                          </summary>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm mt-2">
                            {msg.sources.map((src, sIdx) => (
                              <div key={sIdx} className="bg-surface-container p-space-sm rounded-lg flex flex-col justify-between gap-space-xs hover:bg-surface-container-high transition-colors">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-space-xs min-w-0">
                                    <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary font-label-code text-label-code font-bold">[{src.id}]</span>
                                    <span className="font-label-md text-label-md text-on-surface truncate max-w-[200px]" title={src.source}>{src.source}</span>
                                  </div>
                                </div>
                                <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-3 italic">"{src.text}"</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            {isThinking && (
              <div className="flex items-center gap-2 text-primary font-label-md p-4 animate-pulse">
                <span className="material-symbols-outlined animate-spin text-[20px]">sync</span>
                Retrieving context & generating answer...
              </div>
            )}
          </div>

          <div className="shrink-0 bg-surface-container-low p-space-sm rounded-xl shadow-xl border border-surface-container-highest flex flex-col gap-space-xs mt-auto">
            <div className="flex items-center gap-space-xs bg-surface-container border border-outline-variant/30 rounded-lg px-space-sm py-1 focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all">
              <input 
                className="flex-1 bg-transparent border-0 outline-none text-on-surface placeholder:text-outline font-body-md text-body-md py-3" 
                placeholder={clientVectorDb.length > 0 ? "Ask a question based on indexed knowledge..." : "Upload a document to start asking questions..."}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSendChat}
                disabled={isThinking}
              />
              <button 
                onClick={handleSendChat}
                disabled={isThinking || !query.trim()}
                className="w-10 h-10 rounded-full bg-primary hover:bg-primary-container text-on-primary flex items-center justify-center flex-shrink-0 transition-transform active:scale-95 shadow-md disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[20px]">arrow_upward</span>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
