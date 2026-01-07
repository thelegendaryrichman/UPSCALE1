import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GeminiService } from './services/geminiService';
import { Button } from './components/Button';
import { AppMode, ImageState, HistoryItem, BatchImage, CopyboardItem, CopyboardType, ResultItem } from './types';

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

interface CropState {
  pos: { x: number; y: number };
  size: { w: number; h: number };
  ratio: '1:1' | '16:9' | '9:16' | 'Free';
}

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.IDLE);
  const [prompt, setPrompt] = useState('');
  const [currentImage, setCurrentImage] = useState<ImageState>({
    url: null,
    base64: null,
    beforeUrl: null,
    resolution: '1K',
    isUpscaled: false
  });
  const [batchQueue, setBatchQueue] = useState<BatchImage[]>([]);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copyboard, setCopyboard] = useState<CopyboardItem[]>([]);
  const [showCopyboard, setShowCopyboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isComparing, setIsComparing] = useState(false);
  const [comparePosition, setComparePosition] = useState(50);
  
  // Magic Hand States
  const [brushSize, setBrushSize] = useState(40);
  const [isDrawing, setIsDrawing] = useState(false);
  const magicCanvasRef = useRef<HTMLCanvasElement>(null);

  // Crop States
  const [cropData, setCropData] = useState<{ id: string; base64: string } | null>(null);
  const [cropRatio, setCropRatio] = useState<'1:1' | '16:9' | '9:16' | 'Free'>('1:1');
  const [cropPos, setCropPos] = useState({ x: 50, y: 50 }); // percentage
  const [cropSize, setCropSize] = useState({ w: 40, h: 40 }); // percentage
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  
  // Zoom States
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomTranslate, setZoomTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const zoomImageRef = useRef<HTMLImageElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Crop Undo/Redo History
  const [cropHistory, setCropHistory] = useState<CropState[]>([]);
  const [cropHistoryIndex, setCropHistoryIndex] = useState(-1);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);

  const generatingMessages = ["Thinking...", "Mixing colors...", "Almost there...", "Final touches..."];
  const upscalingMessages = ["Enhancing textures...", "Sharpening details...", "Optimizing pixels..."];
  const batchMessages = ["Batch magic in progress...", "Upgrading your queue...", "Processing all images..."];
  const removingWatermarkMessages = ["Surgical detection...", "Erasing watermarks...", "100% accuracy healing...", "Polishing pixels..."];
  const magicHandMessages = ["Analyzing mask precision...", "Invoking magic hand...", "Deep pixel reconstruction...", "Finalizing seamless finish..."];

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (e) => addItemToCopyboard('image', e.target?.result as string, 'Pasted Image');
            reader.readAsDataURL(blob);
          }
        } else if (items[i].type === 'text/plain') {
          items[i].getAsString((text) => {
            const isVideo = /youtube\.com|vimeo\.com|mp4|webm|ogg/.test(text);
            addItemToCopyboard(isVideo ? 'video' : 'text', text, isVideo ? 'Pasted Video' : 'Pasted Text');
          });
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  useEffect(() => {
    let interval: number;
    const messages = mode === AppMode.BATCH_PROCESSING ? batchMessages : 
                     mode === AppMode.UPSCALING ? upscalingMessages : 
                     mode === AppMode.REMOVING_WATERMARK ? removingWatermarkMessages : 
                     mode === AppMode.MAGIC_HAND ? magicHandMessages : generatingMessages;
    
    if (mode !== AppMode.IDLE && mode !== AppMode.ERROR && mode !== AppMode.CROPPING && mode !== AppMode.ZOOMING && mode !== AppMode.MAGIC_HAND) {
      setLoadingMessage(messages[0]);
      interval = window.setInterval(() => {
        setLoadingMessage(prev => {
          const idx = messages.indexOf(prev);
          return messages[(idx + 1) % messages.length];
        });
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [mode]);

  const addItemToCopyboard = (type: CopyboardType, content: string, title?: string) => {
    const newItem: CopyboardItem = { id: Math.random().toString(36).substr(2, 9), type, content, title, timestamp: Date.now() };
    setCopyboard(prev => [newItem, ...prev]);
    setShowCopyboard(true);
  };

  const addResult = (url: string, base64: string, resolution: string, upscaleType: string) => {
    const newResult: ResultItem = {
      id: Math.random().toString(36).substr(2, 9),
      url,
      base64,
      resolution,
      upscaleType,
      timestamp: Date.now()
    };
    setResults(prev => [newResult, ...prev]);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setMode(AppMode.GENERATING);
    setError(null);
    setIsComparing(false);
    try {
      const imageUrl = await GeminiService.generateImage(prompt);
      setCurrentImage({ url: imageUrl, base64: imageUrl, beforeUrl: null, resolution: '1K', isUpscaled: false });
      addToHistory(imageUrl, prompt);
    } catch (err: any) {
      setError(err.message || "Failed to generate image");
      setMode(AppMode.ERROR);
    } finally {
      setMode(AppMode.IDLE);
    }
  };

  const handleEdit = async () => {
    if (!prompt.trim() || !currentImage.base64) return;
    const previousUrl = currentImage.url;
    setMode(AppMode.EDITING);
    try {
      const imageUrl = await GeminiService.editImage(currentImage.base64, prompt);
      setCurrentImage({ ...currentImage, url: imageUrl, base64: imageUrl, beforeUrl: previousUrl, isUpscaled: false, resolution: '1K' });
      addToHistory(imageUrl, `Edit: ${prompt}`);
      setIsComparing(true);
    } catch (err: any) {
      setError(err.message || "Failed to edit");
    } finally {
      setMode(AppMode.IDLE);
    }
  };

  const handleRemoveWatermark = async () => {
    if (!currentImage.base64) return;
    const previousUrl = currentImage.url;
    setMode(AppMode.REMOVING_WATERMARK);
    setError(null);
    try {
      const watermarkPrompt = "SURGICAL WATERMARK REMOVAL: Detect and surgically erase all watermarks, digital signatures, and logos. 100% accurate reconstruction of the underlying texture and detail. The finish must be pixel-perfect and mathematically seamless with no blurring or distortion.";
      const result = await GeminiService.editImage(currentImage.base64, watermarkPrompt);
      setCurrentImage({ ...currentImage, url: result, base64: result, beforeUrl: previousUrl, resolution: currentImage.resolution });
      addToHistory(result, "Auto Watermark Removal");
      setIsComparing(true);
    } catch (err: any) {
      setError(err.message || "Failed to remove watermark");
      setMode(AppMode.ERROR);
    } finally {
      setMode(AppMode.IDLE);
    }
  };

  // Magic Hand logic
  const startMagicHand = () => {
    if (!currentImage.url) return;
    setMode(AppMode.MAGIC_HAND);
    setTimeout(() => {
        const canvas = magicCanvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = "black";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
        }
    }, 50);
  };

  const handleMagicHandDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !magicCanvasRef.current) return;
    const canvas = magicCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = (('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left) * (canvas.width / rect.width);
    const y = (('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top) * (canvas.height / rect.height);

    ctx.lineWidth = brushSize * (canvas.width / rect.width);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'white'; // White is the mask for removal
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const stopMagicHandDraw = () => {
    setIsDrawing(false);
    if (magicCanvasRef.current) {
        magicCanvasRef.current.getContext('2d')?.beginPath();
    }
  };

  const clearMagicHand = () => {
    const canvas = magicCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
          ctx.fillStyle = "black";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const castMagicHand = async () => {
    if (!currentImage.base64 || !magicCanvasRef.current) return;
    const previousUrl = currentImage.url;
    
    const maskData = magicCanvasRef.current.toDataURL('image/png');
    
    setMode(AppMode.REMOVING_WATERMARK); 
    setLoadingMessage(magicHandMessages[0]);
    
    try {
      // Sending both original and mask for 100% accuracy
      const result = await GeminiService.editWithMask(currentImage.base64, maskData, "PRECISION ERASE: Using the provided white mask as a guide, surgically remove the watermark or object. Perform a 100% accurate reconstruction of the background pixels. Zero traces of the original mark should remain. The result must be seamless, high-definition, and consistent with the surrounding environment.");
      setCurrentImage({ ...currentImage, url: result, base64: result, beforeUrl: previousUrl, resolution: currentImage.resolution });
      addToHistory(result, "Magic Hand Removal");
      setIsComparing(true);
      setMode(AppMode.IDLE);
    } catch (err: any) {
      setError(err.message || "Magic Hand failed");
      setMode(AppMode.ERROR);
    }
  };

  const handleUpscale4K = async () => {
    if (!currentImage.base64) return;
    const previousUrl = currentImage.url;
    if (window.aistudio) {
      try {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) await window.aistudio.openSelectKey();
      } catch (e) { console.warn(e); }
    }
    setMode(AppMode.UPSCALING);
    setError(null);
    try {
      const result = await GeminiService.upscaleTo4K(currentImage.base64);
      setCurrentImage({ url: result, base64: result, beforeUrl: previousUrl, resolution: '4K', isUpscaled: true, upscaleType: 'Pro 4K' });
      addResult(result, result, '4K', 'Pro 4K');
      addToHistory(result, "Pro 4K Enhancement");
      setIsComparing(true);
    } catch (err: any) {
      if (err.message?.includes("Requested entity was not found") && window.aistudio) await window.aistudio.openSelectKey();
      setError(err.message || "Failed to upscale to 4K");
      setMode(AppMode.ERROR);
    } finally { setMode(AppMode.IDLE); }
  };

  const handleBatchUpscale = async () => {
    if (batchQueue.length === 0) return;
    setMode(AppMode.BATCH_PROCESSING);
    const updatedQueue = [...batchQueue];
    for (let i = 0; i < updatedQueue.length; i++) {
      if (updatedQueue[i].status === 'done') continue;
      updatedQueue[i].status = 'processing';
      setBatchQueue([...updatedQueue]);
      try {
        const result = await GeminiService.upscaleFree(updatedQueue[i].base64);
        updatedQueue[i].url = result; 
        updatedQueue[i].base64 = result;
        updatedQueue[i].status = 'done'; 
        updatedQueue[i].resolution = 'Enhanced HD'; 
        updatedQueue[i].upscaleType = 'Free';
        addResult(result, result, 'Enhanced HD', 'Free Batch');
      } catch (err: any) { 
        updatedQueue[i].status = 'error'; 
        updatedQueue[i].error = err.message; 
      }
      setBatchQueue([...updatedQueue]);
    }
    setMode(AppMode.IDLE);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        const newBatchItem: BatchImage = { id: Math.random().toString(36).substr(2, 9), url: base64, base64: base64, status: 'idle', resolution: 'Original' };
        setBatchQueue(prev => [...prev, newBatchItem]);
        if (!currentImage.url) setCurrentImage({ url: base64, base64: base64, beforeUrl: null, resolution: 'Original', isUpscaled: false });
      };
      reader.readAsDataURL(file as Blob);
    });
    if (e.target) e.target.value = '';
  };

  const removeFromBatch = (id: string) => {
    setBatchQueue(prev => prev.filter(item => item.id !== id));
  };

  const addToHistory = (url: string, promptText: string) => {
    setHistory(prev => [{ id: Date.now().toString(), url, prompt: promptText, timestamp: Date.now() }, ...prev].slice(0, 20));
  };

  // Comparison logic
  const handleComparisonMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const position = ((x - rect.left) / rect.width) * 100;
    setComparePosition(Math.max(0, Math.min(100, position)));
  };

  // Zoom Logic
  const startZoom = () => {
    if (!currentImage.url) return;
    setZoomScale(1);
    setZoomTranslate({ x: 0, y: 0 });
    setMode(AppMode.ZOOMING);
  };

  const handleZoomWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoomScale(prev => Math.max(0.5, Math.min(10, prev + delta)));
  };

  const handleZoomMouseDown = (e: React.MouseEvent) => {
    if (zoomScale > 1) {
      setIsPanning(true);
    }
  };

  const handleZoomMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setZoomTranslate(prev => ({
        x: prev.x + e.movementX,
        y: prev.y + e.movementY
      }));
    }
  };

  const handleZoomMouseUp = () => {
    setIsPanning(false);
  };

  // Crop Functionality logic
  const pushCropHistory = (pos: {x:number, y:number}, size: {w:number, h:number}, ratio: typeof cropRatio) => {
    const newState = { pos, size, ratio };
    const newHistory = cropHistory.slice(0, cropHistoryIndex + 1);
    newHistory.push(newState);
    setCropHistory(newHistory);
    setCropHistoryIndex(newHistory.length - 1);
  };

  const undoCrop = () => {
    if (cropHistoryIndex > 0) {
      const prev = cropHistory[cropHistoryIndex - 1];
      setCropPos(prev.pos);
      setCropSize(prev.size);
      setCropRatio(prev.ratio);
      setCropHistoryIndex(cropHistoryIndex - 1);
    }
  };

  const redoCrop = () => {
    if (cropHistoryIndex < cropHistory.length - 1) {
      const next = cropHistory[cropHistoryIndex + 1];
      setCropPos(next.pos);
      setCropSize(next.size);
      setCropRatio(next.ratio);
      setCropHistoryIndex(cropHistoryIndex + 1);
    }
  };

  const startCrop = (item: BatchImage | ImageState | ResultItem) => {
    if (!item.base64) return;
    setCropData({ id: (item as any).id || 'current', base64: item.base64 });
    setMode(AppMode.CROPPING);
    setCropRatio('1:1');
    const initialPos = { x: 50, y: 50 };
    const initialSize = { w: 40, h: 40 };
    setCropPos(initialPos);
    setCropSize(initialSize);
    setCropHistory([{ pos: initialPos, size: initialSize, ratio: '1:1' }]);
    setCropHistoryIndex(0);
  };

  const updateCropBox = (ratio: typeof cropRatio) => {
    let newSize = { ...cropSize };
    if (ratio === '1:1') newSize = { w: 40, h: 40 };
    else if (ratio === '16:9') newSize = { w: 60, h: 33.75 };
    else if (ratio === '9:16') newSize = { w: 25, h: 44.44 };
    else if (ratio === 'Free') newSize = { ...cropSize };

    setCropRatio(ratio);
    setCropSize(newSize);
    setCropPos({ x: 50, y: 50 });
    pushCropHistory({ x: 50, y: 50 }, newSize, ratio);
  };

  const executeCrop = () => {
    if (!canvasRef.current || !cropData) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = cropData.base64;
    img.onload = () => {
      const realW = img.naturalWidth;
      const realH = img.naturalHeight;
      const width = (cropSize.w / 100) * realW;
      const height = (cropSize.h / 100) * realH;
      const x = (cropPos.x / 100) * realW - (width / 2);
      const y = (cropPos.y / 100) * realH - (height / 2);
      canvas.width = width;
      canvas.height = height;
      ctx?.drawImage(img, x, y, width, height, 0, 0, width, height);
      const croppedBase64 = canvas.toDataURL('image/png');
      
      const previousUrl = currentImage.url;
      if (cropData.id === 'current') {
        setCurrentImage(prev => ({ ...prev, url: croppedBase64, base64: croppedBase64, beforeUrl: previousUrl, resolution: 'Cropped' }));
      } else {
        const foundInResults = results.find(r => r.id === cropData.id);
        if (foundInResults) {
          addResult(croppedBase64, croppedBase64, 'Cropped', 'Manual Edit');
        }
        setBatchQueue(prev => prev.map(item => item.id === cropData.id ? { ...item, url: croppedBase64, base64: croppedBase64, resolution: 'Cropped' } : item));
      }
      setMode(AppMode.IDLE);
      setCropData(null);
    };
  };

  const handleCropMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!cropContainerRef.current) return;
    const rect = cropContainerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    let mouseX = ((clientX - rect.left) / rect.width) * 100;
    let mouseY = ((clientY - rect.top) / rect.height) * 100;

    if (activeHandle === 'center') {
      const halfW = cropSize.w / 2;
      const halfH = cropSize.h / 2;
      let x = Math.max(halfW, Math.min(100 - halfW, mouseX));
      let y = Math.max(halfH, Math.min(100 - halfH, mouseY));
      setCropPos({ x, y });
    } else if (activeHandle) {
      let left = cropPos.x - cropSize.w / 2;
      let top = cropPos.y - cropSize.h / 2;
      let right = cropPos.x + cropSize.w / 2;
      let bottom = cropPos.y + cropSize.h / 2;

      if (activeHandle === 'tl') { left = Math.min(right - 5, Math.max(0, mouseX)); top = Math.min(bottom - 5, Math.max(0, mouseY)); }
      if (activeHandle === 'tr') { right = Math.max(left + 5, Math.min(100, mouseX)); top = Math.min(bottom - 5, Math.max(0, mouseY)); }
      if (activeHandle === 'bl') { left = Math.min(right - 5, Math.max(0, mouseX)); bottom = Math.max(top + 5, Math.min(100, mouseY)); }
      if (activeHandle === 'br') { right = Math.max(left + 5, Math.min(100, mouseX)); bottom = Math.max(top + 5, Math.min(100, mouseY)); }

      let newW = right - left;
      let newH = bottom - top;

      if (cropRatio !== 'Free') {
        const targetRatio = cropRatio === '1:1' ? 1 : (cropRatio === '16:9' ? 16 / 9 : 9 / 16);
        if (activeHandle === 'tr' || activeHandle === 'tl') {
           newH = newW / targetRatio;
           if (activeHandle === 'tr') top = bottom - newH;
           if (activeHandle === 'tl') top = bottom - newH;
        } else {
           newH = newW / targetRatio;
           if (activeHandle === 'br') bottom = top + newH;
           if (activeHandle === 'bl') bottom = top + newH;
        }
        if (bottom > 100) { bottom = 100; newH = bottom - top; newW = newH * targetRatio; }
        if (top < 0) { top = 0; newH = bottom - top; newW = newH * targetRatio; }
      }

      setCropSize({ w: newW, h: newH });
      setCropPos({ x: left + newW / 2, y: top + newH / 2 });
    }
  };

  const handleHandleUp = () => {
    if (activeHandle) {
      pushCropHistory(cropPos, cropSize, cropRatio);
      setActiveHandle(null);
    }
  };

  const removeResult = (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
  };

  const downloadAllResults = () => {
    results.forEach((res, idx) => {
      const link = document.createElement('a');
      link.href = res.url;
      link.download = `upscale-result-${idx + 1}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 overflow-x-hidden" onMouseUp={handleZoomMouseUp} onTouchEnd={handleZoomMouseUp}>
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-yellow-500 p-2 rounded-lg">
            <svg className="w-6 h-6 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
          </div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">Banana Vision 4K</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center bg-slate-800/50 rounded-full px-4 py-1.5 border border-slate-700">
             <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest mr-2">Precision:</span>
             <span className="text-[10px] text-slate-300 font-medium uppercase tracking-widest">100% Accuracy Surgical Removal</span>
          </div>
          <Button variant="ghost" onClick={() => setShowCopyboard(!showCopyboard)} className={`text-xs uppercase tracking-wider ${copyboard.length > 0 ? 'text-yellow-400' : ''}`}>Copyboard {copyboard.length > 0 && `(${copyboard.length})`}</Button>
          <Button variant="ghost" onClick={() => setShowHistory(!showHistory)} className="text-xs uppercase tracking-wider">History</Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <section className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-blue-400"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Queue & Generate</h2>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe an image..." className="w-full h-24 bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none mb-4" />
            <div className="flex gap-2 mb-6">
              <Button onClick={handleGenerate} className="flex-1" isLoading={mode === AppMode.GENERATING} disabled={!prompt.trim() || mode !== AppMode.IDLE}>Generate</Button>
              <Button variant="outline" className="px-3" onClick={() => fileInputRef.current?.click()}><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg></Button>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
            </div>
            {batchQueue.length > 0 && (
              <div className="pt-4 border-t border-slate-800 space-y-4">
                <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-slate-400">Queue ({batchQueue.length})</h3><button onClick={() => setBatchQueue([])} className="text-[10px] text-red-400 hover:text-red-300">Clear</button></div>
                <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1 scrollbar-thin">
                  {batchQueue.map((item) => (
                    <div key={item.id} className={`relative group aspect-square rounded-lg overflow-hidden border ${currentImage.url === item.url ? 'border-blue-500' : 'border-slate-700'}`}>
                      <img src={item.url} className={`w-full h-full object-cover cursor-pointer ${item.status === 'processing' ? 'opacity-30' : ''}`} onClick={() => setCurrentImage({ url: item.url, base64: item.base64, beforeUrl: null, resolution: item.resolution, isUpscaled: item.status === 'done' })} alt="" />
                      <button onClick={(e) => { e.stopPropagation(); removeFromBatch(item.id); }} className="absolute top-1 right-1 bg-red-500/80 hover:bg-red-500 text-white rounded-md p-1 opacity-0 group-hover:opacity-100 transition-all z-10"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
                      {item.status === 'processing' && <div className="absolute inset-0 flex items-center justify-center"><div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>}
                    </div>
                  ))}
                </div>
                <Button variant="primary" className="w-full text-sm py-2.5" onClick={handleBatchUpscale} disabled={mode !== AppMode.IDLE || batchQueue.every(i => i.status === 'done')}>Upscale All (Free)</Button>
              </div>
            )}
          </div>
          
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl overflow-hidden group">
            <div className="flex items-center gap-3 mb-4">
               <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
               </div>
               <h2 className="text-lg font-semibold text-white">Surgical Mode</h2>
            </div>
            <p className="text-xs text-slate-500 mb-4">Highest accuracy removal. Precisely paint the target area for pixel-perfect restoration.</p>
            <div className="space-y-3">
                <Button 
                variant="primary" 
                className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 border-none shadow-emerald-900/20 flex items-center justify-center gap-2 transition-all scale-100 active:scale-95"
                onClick={startMagicHand}
                disabled={mode !== AppMode.IDLE || !currentImage.url}
                >
                <svg className="w-6 h-6 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 11-4.243 4.243 3 3 0 014.243-4.243zm0-5.758a3 3 0 11-4.243-4.243 3 3 0 014.243 4.242z" /></svg>
                Magic Hand (Surgical)
                </Button>
                <Button 
                variant="secondary" 
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 border-slate-700 border text-xs"
                onClick={handleRemoveWatermark}
                disabled={mode !== AppMode.IDLE || !currentImage.url}
                isLoading={mode === AppMode.REMOVING_WATERMARK}
                >
                Auto-Accuracy Erase
                </Button>
            </div>
          </div>
        </section>

        <section className="lg:col-span-8 space-y-6">
          {/* Main Workspace */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden min-h-[500px] flex flex-col shadow-2xl relative">
            {mode !== AppMode.IDLE && mode !== AppMode.ERROR && mode !== AppMode.CROPPING && mode !== AppMode.ZOOMING && mode !== AppMode.MAGIC_HAND && (
               <div className="absolute inset-0 z-30 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center"><div className="w-20 h-20 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-6"></div><h3 className="text-2xl font-bold text-white mb-2">{mode.replace('_', ' ')}</h3><p className="text-slate-400 text-lg animate-pulse">{loadingMessage}</p></div>
            )}
            
            {mode === AppMode.MAGIC_HAND && (
                <div className="absolute inset-x-0 top-0 z-40 bg-emerald-600/10 backdrop-blur-md border-b border-emerald-500/20 px-6 py-3 flex items-center justify-between animate-in slide-in-from-top">
                    <div className="flex items-center gap-4">
                        <div className="bg-emerald-500 p-2 rounded-lg"><svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></div>
                        <div>
                            <p className="text-sm font-bold text-white">Surgical Precision Active</p>
                            <p className="text-[10px] text-emerald-300">Paint over unwanted marks for 100% accurate removal</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 bg-slate-900/50 px-3 py-1 rounded-full border border-emerald-500/20">
                            <span className="text-[10px] text-emerald-300">Brush Size</span>
                            <input type="range" min="5" max="150" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-24 accent-emerald-500" />
                        </div>
                        <Button variant="ghost" className="text-xs py-1" onClick={clearMagicHand}>Clear</Button>
                        <Button variant="danger" className="text-xs py-1 px-3" onClick={() => setMode(AppMode.IDLE)}>Cancel</Button>
                        <Button variant="primary" className="text-xs py-1 px-6 bg-emerald-600 hover:bg-emerald-700 border-none shadow-xl" onClick={castMagicHand}>Execute Erase</Button>
                    </div>
                </div>
            )}

            <div className="flex-1 flex flex-col p-6 bg-slate-950">
              {currentImage.url ? (
                <div className="flex flex-col h-full gap-4">
                  <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                      <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-xs border border-slate-700">{currentImage.resolution}</span>
                      {currentImage.beforeUrl && mode === AppMode.IDLE && (
                        <Button 
                          variant={isComparing ? "primary" : "secondary"} 
                          className="px-3 py-1 text-xs" 
                          onClick={() => setIsComparing(!isComparing)}
                        >
                          {isComparing ? "Exit Comparison" : "Compare Quality"}
                        </Button>
                      )}
                    </div>
                    {mode === AppMode.IDLE && (
                        <div className="flex gap-2">
                            <Button variant="secondary" className="px-3 py-1 text-xs" onClick={startZoom}>Zoom Viewer</Button>
                            <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => startCrop(currentImage)}>Advanced Crop</Button>
                            <Button variant="primary" className="px-3 py-1 text-xs bg-gradient-to-r from-purple-600 to-indigo-600 border-none shadow-lg" onClick={handleUpscale4K} disabled={mode !== AppMode.IDLE || currentImage.resolution === '4K'}>Upgrade Pro 4K</Button>
                            <Button variant="secondary" className="px-3 py-1 text-xs" onClick={handleEdit} disabled={!prompt.trim()}>Edit Selection</Button>
                        </div>
                    )}
                  </div>
                  <div className="flex-1 relative group flex items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
                    {isComparing && currentImage.beforeUrl && mode === AppMode.IDLE ? (
                      <div 
                        ref={sliderRef}
                        className="relative w-full h-[55vh] flex items-center justify-center cursor-ew-resize overflow-hidden"
                        onMouseMove={handleComparisonMove}
                        onTouchMove={handleComparisonMove}
                      >
                        {/* Before Layer */}
                        <img 
                          src={currentImage.beforeUrl} 
                          className="absolute max-w-full max-h-full object-contain select-none"
                          alt="Before" 
                        />
                        {/* After Layer (Clipped) */}
                        <div 
                          className="absolute inset-0 flex items-center justify-center pointer-events-none"
                          style={{ clipPath: `inset(0 0 0 ${comparePosition}%)` }}
                        >
                          <img 
                            src={currentImage.url} 
                            className="max-w-full max-h-full object-contain select-none" 
                            alt="After" 
                          />
                        </div>
                        {/* Slider Handle */}
                        <div 
                          className="absolute top-0 bottom-0 w-1 bg-white shadow-xl z-10 flex items-center justify-center"
                          style={{ left: `${comparePosition}%` }}
                        >
                          <div className="bg-white text-slate-950 p-1.5 rounded-full shadow-lg border border-slate-300 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M15 10l-4 4v-8l4 4zM5 10l4-4v8l-4-4z" /></svg>
                          </div>
                        </div>
                        <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-lg text-[10px] font-bold text-white uppercase tracking-wider border border-white/10 select-none">Original</div>
                        <div className="absolute top-4 right-4 bg-emerald-600/80 backdrop-blur-md px-3 py-1 rounded-lg text-[10px] font-bold text-white uppercase tracking-wider border border-white/10 select-none">Clean Output</div>
                      </div>
                    ) : (
                      <div className="relative w-full h-[55vh] flex items-center justify-center">
                        <img 
                            src={currentImage.url} 
                            className={`max-w-full max-h-full object-contain transition-all ${mode === AppMode.MAGIC_HAND ? 'cursor-none' : 'cursor-zoom-in'}`} 
                            alt="" 
                            onClick={mode === AppMode.IDLE ? startZoom : undefined}
                        />
                        {mode === AppMode.MAGIC_HAND && (
                            <>
                                <canvas 
                                    ref={magicCanvasRef}
                                    width={1024}
                                    height={1024}
                                    className="absolute inset-0 w-full h-full z-10 touch-none opacity-50"
                                    onMouseDown={(e) => { setIsDrawing(true); handleMagicHandDraw(e); }}
                                    onMouseMove={handleMagicHandDraw}
                                    onMouseUp={stopMagicHandDraw}
                                    onMouseLeave={stopMagicHandDraw}
                                    onTouchStart={(e) => { setIsDrawing(true); handleMagicHandDraw(e); }}
                                    onTouchMove={handleMagicHandDraw}
                                    onTouchEnd={stopMagicHandDraw}
                                />
                                {/* Custom Brush Cursor */}
                                <div 
                                    className="fixed pointer-events-none z-50 rounded-full border-2 border-white bg-white/20 shadow-2xl"
                                    style={{
                                        width: `${brushSize}px`,
                                        height: `${brushSize}px`,
                                        left: `var(--mouse-x, 0px)`,
                                        top: `var(--mouse-y, 0px)`,
                                        transform: 'translate(-50%, -50%)',
                                        visibility: 'hidden' 
                                    }}
                                    ref={(el) => {
                                        if (!el) return;
                                        const update = (e: MouseEvent) => {
                                            el.style.left = `${e.clientX}px`;
                                            el.style.top = `${e.clientY}px`;
                                            el.style.visibility = 'visible';
                                        };
                                        window.addEventListener('mousemove', update);
                                    }}
                                />
                            </>
                        )}
                      </div>
                    )}
                    
                    {mode === AppMode.IDLE && !isComparing && (
                      <div className="absolute bottom-6 right-6 flex gap-3 opacity-0 group-hover:opacity-100 transition-all">
                        <a href={currentImage.url} download="clean-export.png" className="bg-emerald-600 hover:bg-emerald-700 p-3 rounded-xl text-white shadow-2xl">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-600 space-y-6"><div className="w-24 h-24 bg-slate-900 rounded-full flex items-center justify-center border border-slate-800 shadow-inner"><svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div><p className="text-sm">Paste images (Ctrl+V) or upload photos to start.</p></div>
              )}
            </div>
          </div>

          {/* Upscaled Result Library */}
          {results.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="bg-green-500/10 p-2 rounded-xl border border-green-500/20">
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Project Results</h2>
                    <p className="text-xs text-slate-500">All successfully cleaned and upscaled outputs</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="text-xs py-1.5" onClick={downloadAllResults}>Download All ({results.length})</Button>
                  <button onClick={() => setResults([])} className="text-xs text-red-500 hover:text-red-400 font-medium px-2">Clear Library</button>
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {results.map((res) => (
                  <div key={res.id} className="group relative aspect-square bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 hover:border-blue-500/50 transition-all shadow-lg hover:shadow-blue-900/10">
                    <img src={res.url} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" alt="" />
                    
                    <div className="absolute top-2 left-2 flex gap-1">
                      <span className="bg-black/60 backdrop-blur-md text-[8px] font-bold text-white px-1.5 py-0.5 rounded border border-white/10">{res.resolution}</span>
                    </div>

                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 gap-2">
                       <div className="flex items-center justify-between gap-1">
                          <Button variant="primary" className="flex-1 text-[10px] py-1 px-1" onClick={() => { setCurrentImage({ url: res.url, base64: res.base64, beforeUrl: null, resolution: res.resolution, isUpscaled: true }); setIsComparing(false); }}>View</Button>
                          <button onClick={() => removeResult(res.id)} className="p-1 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-lg transition-colors">
                             <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                       </div>
                       <div className="flex items-center justify-between">
                         <Button variant="secondary" className="flex-1 text-[10px] py-1 px-1" onClick={() => startCrop(res)}>Crop</Button>
                         <button onClick={() => addItemToCopyboard('image', res.base64, 'Upscaled Output')} className="ml-1 p-1 bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 rounded-lg transition-colors">
                           <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" /><path d="M5 5a2 2 0 012-2h6a2 2 0 012 2v2H7a2 2 0 00-2 2v6H3a2 2 0 01-2-2V7a2 2 0 012-2h2V5z" /></svg>
                         </button>
                       </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Interactive Zoom Viewer Modal */}
      {mode === AppMode.ZOOMING && currentImage.url && (
        <div 
          className="fixed inset-0 z-[200] bg-slate-950/98 flex flex-col items-center justify-center select-none"
          onWheel={handleZoomWheel}
        >
          {/* Zoom Header */}
          <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between bg-gradient-to-b from-black/50 to-transparent z-10">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-bold text-white">Pixel Explorer</h2>
              <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-xs border border-slate-700">Zoom: {(zoomScale * 100).toFixed(0)}%</span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="px-3" onClick={() => setZoomScale(prev => Math.max(0.5, prev - 0.5))} title="Zoom Out">-</Button>
              <Button variant="secondary" className="px-3" onClick={() => setZoomScale(1)} title="Reset Zoom">Reset</Button>
              <Button variant="secondary" className="px-3" onClick={() => setZoomScale(prev => Math.min(10, prev + 0.5))} title="Zoom In">+</Button>
              <button 
                onClick={() => setMode(AppMode.IDLE)} 
                className="ml-4 p-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          {/* Zoom Viewport */}
          <div 
            className={`w-full h-full flex items-center justify-center overflow-hidden ${zoomScale > 1 ? 'cursor-grab' : ''} ${isPanning ? 'cursor-grabbing' : ''}`}
            onMouseDown={handleZoomMouseDown}
            onMouseMove={handleZoomMouseMove}
            onMouseUp={handleZoomMouseUp}
            onMouseLeave={handleZoomMouseUp}
          >
            <img 
              ref={zoomImageRef}
              src={currentImage.url} 
              className="max-w-none transition-transform duration-75 ease-out pointer-events-none"
              style={{
                transform: `translate(${zoomTranslate.x}px, ${zoomTranslate.y}px) scale(${zoomScale})`,
                maxWidth: '90%',
                maxHeight: '90%'
              }}
              alt=""
            />
          </div>

          {/* Zoom Footer Hint */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-2 bg-black/50 backdrop-blur-md rounded-full border border-white/10 text-[10px] text-white/50">
             Scroll to Zoom • Drag to Pan • Escape to Close
          </div>
        </div>
      )}

      {/* Advanced Interactive Cropper Modal */}
      {mode === AppMode.CROPPING && (
        <div className="fixed inset-0 z-[100] bg-slate-950/95 flex flex-col items-center justify-center p-4 sm:p-8 animate-in zoom-in duration-200">
          <div className="max-w-6xl w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-3xl flex flex-col lg:flex-row gap-8">
            <div className="flex-1 flex flex-col gap-6">
              <div className="flex items-center justify-between w-full">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 11-4.243 4.243 3 3 0 014.243-4.243zm0-5.758a3 3 0 11-4.243-4.243 3 3 0 014.243 4.242z" /></svg>
                  Interactive Crop & Undo
                </h2>
                <div className="flex gap-2">
                   <button 
                    onClick={undoCrop} 
                    disabled={cropHistoryIndex <= 0}
                    className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    title="Undo Adjustment"
                   >
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                   </button>
                   <button 
                    onClick={redoCrop} 
                    disabled={cropHistoryIndex >= cropHistory.length - 1}
                    className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    title="Redo Adjustment"
                   >
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" /></svg>
                   </button>
                </div>
              </div>
              
              <div 
                ref={cropContainerRef}
                className="relative bg-slate-950 rounded-2xl p-0 border border-slate-800 overflow-hidden select-none flex items-center justify-center w-full max-h-[60vh]"
                onMouseMove={handleCropMouseMove}
                onTouchMove={handleCropMouseMove}
              >
                <img src={cropData?.base64} className="max-w-full max-h-full object-contain pointer-events-none opacity-40" alt="" />
                
                {/* Advanced Draggable Crop Box */}
                <div 
                  className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] flex items-center justify-center"
                  style={{
                    left: `${cropPos.x}%`,
                    top: `${cropPos.y}%`,
                    width: `${cropSize.w}%`,
                    height: `${cropSize.h}%`,
                    transform: 'translate(-50%, -50%)',
                    cursor: activeHandle ? 'grabbing' : 'grab'
                  }}
                  onMouseDown={() => setActiveHandle('center')}
                  onTouchStart={() => setActiveHandle('center')}
                >
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-20">
                    <div className="border-r border-b border-white"></div><div className="border-r border-b border-white"></div><div className="border-b border-white"></div>
                    <div className="border-r border-b border-white"></div><div className="border-r border-b border-white"></div><div className="border-b border-white"></div>
                    <div className="border-r border-white"></div><div className="border-r border-white"></div><div></div>
                  </div>

                  <div onMouseDown={(e) => { e.stopPropagation(); setActiveHandle('tl'); }} onTouchStart={(e) => { e.stopPropagation(); setActiveHandle('tl'); }} className="absolute -top-2 -left-2 w-5 h-5 bg-white rounded-sm cursor-nw-resize shadow-lg z-20"></div>
                  <div onMouseDown={(e) => { e.stopPropagation(); setActiveHandle('tr'); }} onTouchStart={(e) => { e.stopPropagation(); setActiveHandle('tr'); }} className="absolute -top-2 -right-2 w-5 h-5 bg-white rounded-sm cursor-ne-resize shadow-lg z-20"></div>
                  <div onMouseDown={(e) => { e.stopPropagation(); setActiveHandle('bl'); }} onTouchStart={(e) => { e.stopPropagation(); setActiveHandle('bl'); }} className="absolute -bottom-2 -left-2 w-5 h-5 bg-white rounded-sm cursor-sw-resize shadow-lg z-20"></div>
                  <div onMouseDown={(e) => { e.stopPropagation(); setActiveHandle('br'); }} onTouchStart={(e) => { e.stopPropagation(); setActiveHandle('br'); }} className="absolute -bottom-2 -right-2 w-5 h-5 bg-white rounded-sm cursor-se-resize shadow-lg z-20"></div>

                  <div className="bg-white/90 text-[10px] text-slate-950 px-2 py-0.5 rounded-full font-bold shadow-lg pointer-events-none select-none">ADJUST ME</div>
                </div>
              </div>
              <p className="text-xs text-slate-500 italic text-center">Drag corners to resize freely or center to move. Changes are saved for undo/redo.</p>
            </div>

            <div className="w-full lg:w-64 flex flex-col gap-6 justify-center bg-slate-800/20 p-6 rounded-2xl border border-slate-700">
              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Aspect Ratio</h3>
                <div className="grid grid-cols-1 gap-2">
                  <Button variant={cropRatio === 'Free' ? 'primary' : 'outline'} className="text-xs" onClick={() => updateCropBox('Free')}>Free Mode</Button>
                  <Button variant={cropRatio === '1:1' ? 'primary' : 'outline'} className="text-xs" onClick={() => updateCropBox('1:1')}>Square (1:1)</Button>
                  <Button variant={cropRatio === '16:9' ? 'primary' : 'outline'} className="text-xs" onClick={() => updateCropBox('16:9')}>Landscape (16:9)</Button>
                  <Button variant={cropRatio === '9:16' ? 'primary' : 'outline'} className="text-xs" onClick={() => updateCropBox('9:16')}>Portrait (9:16)</Button>
                </div>
              </div>
              <div className="flex flex-col gap-2 pt-6 border-t border-slate-700">
                <Button variant="primary" onClick={executeCrop} className="w-full py-3 shadow-blue-500/20 shadow-xl">Finalize Crop</Button>
                <Button variant="ghost" onClick={() => setMode(AppMode.IDLE)} className="w-full">Discard Changes</Button>
              </div>
            </div>
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}

      {/* Copyboard Sidebar */}
      {showCopyboard && (
        <div className="fixed top-0 right-0 w-80 h-full z-[80] bg-slate-900 border-l border-slate-800 shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50 backdrop-blur-md">
            <h2 className="font-bold flex items-center gap-2"><svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" /><path d="M5 5a2 2 0 012-2h6a2 2 0 012 2v2H7a2 2 0 00-2 2v6H3a2 2 0 01-2-2V7a2 2 0 012-2h2V5z" /></svg>Copyboard</h2>
            <button onClick={() => setShowCopyboard(false)} className="text-slate-400 hover:text-white"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
            {copyboard.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 opacity-40"><p className="text-sm">Board is empty. Paste (Ctrl+V) content here.</p></div>
            ) : (
              copyboard.map(item => (
                <div key={item.id} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden group shadow-lg">
                  <div className="p-2 flex items-center justify-between bg-slate-900/30">
                    <span className="text-[10px] font-bold uppercase tracking-tighter opacity-50">{item.type}</span>
                    <button onClick={() => setCopyboard(prev => prev.filter(i => i.id !== item.id))} className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </div>
                  <div className="p-2">
                    {item.type === 'image' && <img src={item.content} className="w-full h-32 object-cover rounded-lg" alt="" />}
                    {item.type === 'text' && <div className="w-full max-h-32 overflow-y-auto p-2 text-[10px] bg-slate-900 rounded-lg text-slate-300 font-mono whitespace-pre-wrap">{item.content}</div>}
                    <div className="mt-2 flex gap-1">
                      <Button variant="ghost" className="flex-1 text-[10px] py-1" onClick={() => {
                        if (item.type === 'image') { setCurrentImage({ url: item.content, base64: item.content, beforeUrl: null, resolution: 'Board', isUpscaled: false }); setIsComparing(false); }
                        else setPrompt(item.content);
                      }}>Transfer</Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Stored History Drawer Overlay */}
      {showHistory && history.length > 0 && (
        <div className="fixed inset-0 z-[90] bg-slate-950/80 backdrop-blur-sm flex items-end justify-center pointer-events-none">
          <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-t-3xl p-6 pointer-events-auto animate-in slide-in-from-bottom duration-300">
            <h2 className="text-sm font-semibold mb-4 text-slate-400 flex justify-between"><span>Session History ({history.length})</span><button onClick={() => setHistory([])} className="text-xs hover:text-red-400">Clear</button></h2>
            <div className="grid grid-cols-5 gap-4 max-h-[40vh] overflow-y-auto p-1">
              {history.map((item) => (
                <button key={item.id} onClick={() => { setCurrentImage({ url: item.url, base64: item.url, beforeUrl: null, resolution: '1K', isUpscaled: false }); setIsComparing(false); }} className="aspect-square bg-slate-950 rounded-xl overflow-hidden border border-slate-800 hover:border-blue-500 transition-all group relative">
                  <img src={item.url} className="w-full h-full object-cover" alt="" /><div className="absolute inset-0 bg-blue-600/20 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-center"><Button variant="ghost" onClick={() => setShowHistory(false)}>Close</Button></div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[101] bg-red-900/90 border border-red-500/50 backdrop-blur-md px-6 py-3 rounded-full flex items-center gap-3 shadow-2xl animate-in slide-in-from-bottom-4">
          <svg className="w-5 h-5 text-red-200" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
          <span className="text-white text-sm font-medium">{error}</span>
          <button onClick={() => setError(null)} className="ml-2 hover:bg-white/10 rounded-full p-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
      )}
    </div>
  );
};

export default App;