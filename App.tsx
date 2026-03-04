
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// Types
interface AnalysisResult {
  title: string;
  about: string; 
  nearbyLandmarks?: { name: string; distance: string; description: string; direction?: string }[];
  locationLink?: string; 
  notFound?: boolean;
}

const languages = [
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'zh', name: 'Chinese', native: '中文' }
];

const translations: Record<string, any> = {
  ar: {
    logoTextStart: "ياللا بينا",
    logoTextEnd: "Let's GO",
    searchPlaceholder: "ابحث عن معلم...",
    loading: "متعة الإكتشاف",
    waitingGeneration: "جاري عرض المعلومات...",
    newDiscovery: "استكشاف جديد",
    aboutTitle: "عن المعلم",
    nearbyTitlePrefix: "معالم محيطة بـ ",
    errorCamera: "يرجى تفعيل صلاحية الكاميرا.",
    expandHistory: "المزيد من المعلومات",
    expandNearby: "استكشاف المعالم المحيطة",
    loadingExpansion: "جاري التعمق...",
    directions: "اتجاه",
    share: "مشاركة",
    copy: "نسخ",
    copied: "تم النسخ",
    confirmImages: "تأكد من الصورة",
    loadImages: "تحميل الصور",
    needApiKey: "يجب اختيار مفتاح API خاص بك"
  },
  en: {
    logoTextStart: "ياللا بينا",
    logoTextEnd: "Let's GO",
    searchPlaceholder: "Search landmark...",
    loading: "Joy of Discovery",
    waitingGeneration: "Displaying info...",
    newDiscovery: "New Discovery",
    aboutTitle: "About the Site",
    nearbyTitlePrefix: "Nearby landmarks around ",
    errorCamera: "Please enable camera permissions.",
    expandHistory: "More Info",
    expandNearby: "Explore Nearby Landmarks",
    loadingExpansion: "Deep diving...",
    directions: "Direction",
    share: "Share",
    copy: "Copy",
    copied: "Copied",
    confirmImages: "Confirm Images",
    loadImages: "Load Photos",
    needApiKey: "Select your API Key"
  }
};

const App: React.FC = () => {
  const [searchText, setSearchText] = useState("");
  const [selectedLang, setSelectedLang] = useState('ar');
  const [isScanning, setIsScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [countdown, setCountdown] = useState(20);
  const [isWaitingForAI, setIsWaitingForAI] = useState(false);
  const [readingSection, setReadingSection] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [hasExpandedHistory, setHasExpandedHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState(false);
  const [landmarkImages, setLandmarkImages] = useState<string[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultGalleryInputRef = useRef<HTMLInputElement>(null);
  const countdownIntervalRef = useRef<number | null>(null);

  const t = translations[selectedLang] || translations.en;

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      window.speechSynthesis.cancel();
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [facingMode]);

  const startCamera = async () => {
    setIsScanning(true);
    setResult(null);
    setError(null);
    setCapturedImage(null);
    setHasExpandedHistory(false);
    setLandmarkImages([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: facingMode } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      setIsScanning(false);
      setError(t.errorCamera);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
  };

  const toggleCamera = () => {
    stopCamera();
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };

  const performAnalysis = async (prompt: string, imageData?: string, isExpansion = false, isNearbyExpansion = false) => {
    if (isExpansion || isNearbyExpansion) setExpanding(true);
    else setLoading(true);

    if (imageData) setCapturedImage(imageData);

    setCountdown(20);
    setError(null);
    setIsWaitingForAI(false);

    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = window.setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current!);
          setIsWaitingForAI(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      // Fix: Initializing GoogleGenAI with named parameter apiKey as per guidelines
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      let systemInstruction = `You are a world-class travel guide. Identify this landmark and provide details in JSON format. Language: ${selectedLang}.
      The JSON must contain:
      - title: name of the landmark.
      - about: 150 words describing it.
      - nearbyLandmarks: An array of 12 real landmarks within 1km. Each object MUST have 'name', 'distance' (e.g. "300 meters"), 'direction' (e.g. "North East"), and 'description'.`;
      
      if (isExpansion) {
        systemInstruction = `Provide an extremely deep historical and architectural study of ${result?.title}. This text MUST be minimum 400 words long. Use professional tone. Format: JSON {about: string}. Language: ${selectedLang}.`;
      } else if (isNearbyExpansion) {
        systemInstruction = `Find exactly 26 real landmarks and interesting spots within 1km radius of ${result?.title}. Format: JSON {nearbyLandmarks: Array<{name, distance, direction, description}>}. Language: ${selectedLang}.`;
      }

      // Fix: Using gemini-3-flash-preview as per guidelines
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: imageData 
          ? { parts: [{ inlineData: { mimeType: 'image/jpeg', data: imageData.split(',')[1] } }, { text: prompt }] }
          : { parts: [{ text: prompt }] },
        config: { 
          systemInstruction, 
          responseMimeType: "application/json"
        }
      });

      const text = response.text || "{}";
      const data = JSON.parse(text);
      
      if (isExpansion) {
        setResult(prev => prev ? { ...prev, about: data.about } : null);
        setHasExpandedHistory(true);
      } else if (isNearbyExpansion) {
        setResult(prev => prev ? { ...prev, nearbyLandmarks: data.nearbyLandmarks } : null);
      } else {
        setResult(data as AnalysisResult);
      }

      setLoading(false);
      setExpanding(false);
      setIsWaitingForAI(false);
    } catch (err: any) {
      setLoading(false);
      setExpanding(false);
      setError(err.message?.includes("403") ? t.needApiKey : "Connection Error");
    }
  };

  const handleMultipleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setLoadingImages(true);
    const newImages: string[] = [];
    let processedCount = 0;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        newImages.push(reader.result as string);
        processedCount++;
        if (processedCount === files.length) {
          setLandmarkImages(prev => [...prev, ...newImages]);
          setLoadingImages(false);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const copyToClipboard = () => {
    if (!result) return;
    const text = `${result.title}\n\n${result.about}\n\n${t.nearbyTitlePrefix}:\n${result.nearbyLandmarks?.map(l => `- ${l.name} (${l.distance} - ${l.direction})`).join('\n')}`;
    navigator.clipboard.writeText(text);
    setCopyStatus(true);
    setTimeout(() => setCopyStatus(false), 2000);
  };

  const shareAsHTML = async () => {
    if (!result) return;
    const allImgs = capturedImage ? [capturedImage, ...landmarkImages] : landmarkImages;
    const isRtl = selectedLang === 'ar' || selectedLang === 'zh';
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="${selectedLang}" dir="${isRtl ? 'rtl' : 'ltr'}">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@700;900&display=swap');
          body { font-family: 'Tajawal', sans-serif; padding: 15px; line-height: 1.6; color: #1a202c; background: #f7fafc; margin: 0; font-weight: 900; }
          h1 { color: #2d3748; text-align: center; font-size: 24px; margin-bottom: 20px; font-weight: 900; }
          .gallery { display: grid; grid-template-cols: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 25px; }
          .gallery img { width: 100%; height: 150px; object-fit: cover; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .about-text { background: #fff; padding: 20px; border-radius: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 30px; font-size: 16px; text-align: justify; font-weight: 700; }
          h2 { font-size: 20px; color: #2c5282; border-bottom: 3px solid #ebf8ff; padding-bottom: 10px; margin-top: 40px; font-weight: 900; }
          .landmark { margin-bottom: 15px; padding: 15px; background: linear-gradient(135deg, #e6fffa 0%, #ebf8ff 100%); border-radius: 18px; border: 1px solid #b2f5ea; }
          .landmark-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 900; }
          .distance-tag { background: #319795; color: white; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
          .description { font-size: 14px; color: #4a5568; font-weight: 700; }
          footer { text-align: center; margin-top: 50px; padding: 20px; font-size: 12px; color: #a0aec0; }
        </style>
      </head>
      <body>
        <h1>${result.title}</h1>
        <div class="gallery">${allImgs.map(url => `<img src="${url}" />`).join('')}</div>
        <div class="about-text">${result.about}</div>
        ${result.nearbyLandmarks && result.nearbyLandmarks.length > 0 ? `
          <h2>${t.nearbyTitlePrefix} ${result.title}</h2>
          ${result.nearbyLandmarks.map(l => `
            <div class="landmark">
              <div class="landmark-header">
                <span>${l.name}</span>
                <span class="distance-tag">${l.distance} ${l.direction ? `(${l.direction})` : ''}</span>
              </div>
              <div class="description">${l.description}</div>
            </div>
          `).join('')}
        ` : ''}
        <footer>Shared via ياللا بينا - Let's GO</footer>
      </body>
      </html>`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    // Fix: Cast blob correctly to BlobPart for the File constructor
    const file = new File([blob], `${result.title}.html`, { type: 'text/html' });
    const shareData: ShareData = { files: [file], title: result.title, text: result.title };
    const nav = navigator as any;
    if (nav.canShare && nav.canShare(shareData)) {
      try { await nav.share(shareData); } catch (e) { console.error(e); }
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${result.title}.html`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  const readText = (text: string, id: string) => {
    window.speechSynthesis.cancel();
    if (readingSection === id) { setReadingSection(null); return; }
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = selectedLang;
    utt.onstart = () => setReadingSection(id);
    utt.onend = () => setReadingSection(null);
    window.speechSynthesis.speak(utt);
  };

  return (
    <div className={`min-h-screen bg-[#021512] text-slate-100 flex flex-col items-center font-['Tajawal'] pb-10 ${selectedLang === 'ar' || selectedLang === 'zh' ? 'rtl' : 'ltr'}`}>
      <header className="w-full py-4 px-6 bg-[#021512]/95 backdrop-blur-md sticky top-0 z-50 flex flex-col gap-4 border-b border-cyan-600/30">
        <div className="flex flex-col md:flex-row gap-4 justify-between items-center w-full">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-2xl border border-white/10 relative overflow-hidden group min-w-[280px]">
              <span className="text-xl md:text-2xl font-black bg-gradient-to-r from-yellow-400 to-cyan-400 bg-clip-text text-transparent z-10">
                {t.logoTextStart}
              </span>
              
              <div className="flex items-center justify-center bg-gradient-to-br from-cyan-400 to-emerald-500 w-10 h-10 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.4)] z-10 relative overflow-hidden">
                {/* Mirroring the walking man icon to face left (inverse of default) */}
                <i className="fas fa-walking text-black text-xl scale-x-[-1]"></i>
              </div>

              <span className="text-xl md:text-2xl font-black bg-gradient-to-r from-cyan-400 to-yellow-400 bg-clip-text text-transparent z-10">
                {t.logoTextEnd}
              </span>

              {/* Animation moving from Right to Left (0% right to 100% left) */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-1/2 -translate-y-1/2 right-[-40px] animate-[walkRightToLeft_6s_linear_infinite] opacity-50 text-cyan-400">
                   <i className="fas fa-walking text-2xl scale-x-[-1]"></i>
                </div>
              </div>
              
              <style>{`
                @keyframes walkRightToLeft {
                  0% { transform: translateY(-50%) translateX(0); opacity: 0; }
                  10% { opacity: 0.8; }
                  90% { opacity: 0.8; }
                  100% { transform: translateY(-50%) translateX(-380px); opacity: 0; }
                }
              `}</style>
            </div>
            <select value={selectedLang} onChange={(e) => setSelectedLang(e.target.value)} className="bg-white/5 border border-cyan-600/30 rounded-full py-1 px-3 text-cyan-400 text-xs">
              {languages.map(l => <option key={l.code} value={l.code} className="bg-[#021512]">{l.native}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <form onSubmit={(e) => { e.preventDefault(); if(searchText) { stopCamera(); performAnalysis(searchText); } }} className="relative">
              <input type="text" placeholder={t.searchPlaceholder} value={searchText} onChange={(e) => setSearchText(e.target.value)} className="bg-white/5 border border-cyan-600/30 rounded-full py-2 px-10 text-cyan-100 focus:outline-none w-40 md:w-64 text-sm" />
              <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-cyan-600/50"></i>
            </form>
            <div className="flex items-center gap-2">
              <button onClick={() => fileInputRef.current?.click()} className="bg-emerald-600/20 w-10 h-10 rounded-full flex items-center justify-center text-emerald-400 border border-emerald-500/30">
                <i className="fas fa-image"></i>
              </button>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onloadend = () => { stopCamera(); performAnalysis("Identify", reader.result as string); };
                reader.readAsDataURL(file);
              }
            }} />
          </div>
        </div>
      </header>

      <main className="w-full max-w-4xl px-4 flex-1 flex flex-col pt-6">
        {(loading || expanding) && (
          <div className="fixed inset-0 bg-[#021512]/95 backdrop-blur-md z-[100] flex flex-col items-center justify-center text-center">
            <div className="relative w-48 h-48 flex items-center justify-center mb-8">
                <div className="absolute w-full h-full border-[10px] border-transparent border-t-cyan-400 rounded-full animate-[spin_1.5s_linear_infinite]"></div>
                <div className="absolute w-[80%] h-[80%] border-[8px] border-transparent border-b-emerald-400 rounded-full animate-[spin_2s_linear_infinite_reverse]"></div>
                <div className="text-4xl font-black text-white">{isWaitingForAI ? <i className="fas fa-magic animate-pulse"></i> : countdown}</div>
            </div>
            {capturedImage && (
                <div className="mb-6 animate-in zoom-in duration-500">
                    <img src={capturedImage} className="w-64 h-40 object-cover rounded-3xl border-4 border-cyan-500/30 shadow-2xl" alt="Analysing..." />
                </div>
            )}
            <p className="text-2xl font-black bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              {expanding ? t.loadingExpansion : (isWaitingForAI ? t.waitingGeneration : t.loading)}
            </p>
          </div>
        )}

        {isScanning && !loading && (
          <div className="relative rounded-[3rem] overflow-hidden border-4 border-cyan-600/20 aspect-[4/5] bg-black max-w-xl mx-auto w-full">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="w-full h-full object-cover" 
              style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }} 
            />
            <div className="absolute top-6 right-6">
              <button onClick={toggleCamera} className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/20 shadow-lg">
                <i className="fas fa-sync-alt text-lg"></i>
              </button>
            </div>
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
              <button onClick={() => {
                const canvas = document.createElement('canvas');
                canvas.width = videoRef.current!.videoWidth; canvas.height = videoRef.current!.videoHeight;
                const ctx = canvas.getContext('2d')!;
                if (facingMode === 'user') {
                  ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
                }
                ctx.drawImage(videoRef.current!, 0, 0);
                const data = canvas.toDataURL('image/jpeg');
                stopCamera(); performAnalysis("Identify", data);
              }} className="w-20 h-20 bg-gradient-to-br from-cyan-400 to-emerald-500 rounded-full flex items-center justify-center text-black shadow-2xl"><i className="fas fa-camera text-2xl"></i></button>
            </div>
          </div>
        )}

        {result && !loading && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-10 duration-500">
            <h2 className="text-4xl font-black text-center text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">{result.title}</h2>
            <div className="bg-[#FFFFE0] text-slate-900 rounded-[2.5rem] p-8 md:p-12 shadow-2xl border-l-[15px] border-emerald-600/40 relative">
              <div className="flex flex-col gap-4 mb-6">
                <div className="flex justify-between items-start">
                    <h3 className="text-3xl font-black text-[#3e2723]">{t.aboutTitle}</h3>
                    <button onClick={() => readText(result.about, 'main')} className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${readingSection === 'main' ? 'bg-red-700 text-white' : 'bg-[#3e2723] text-cyan-400'}`}>
                    <i className={`fas ${readingSection === 'main' ? 'fa-stop' : 'fa-volume-up'}`}></i>
                    </button>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(result.title)}&tbm=isch`, '_blank')} className="bg-zinc-800 text-yellow-400 px-4 py-2 rounded-xl text-xs font-bold shadow-md hover:bg-zinc-900 transition-colors border border-yellow-400/30">
                        <i className="fas fa-search-plus mr-1"></i> <span className="text-yellow-300 font-black">{t.confirmImages}</span>
                    </button>
                    <button onClick={() => resultGalleryInputRef.current?.click()} disabled={loadingImages} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md hover:bg-emerald-700 transition-colors disabled:opacity-50">
                        <i className={`fas ${loadingImages ? 'fa-spinner fa-spin' : 'fa-cloud-download-alt'} mr-1`}></i> 
                        {t.loadImages}
                    </button>
                    <input type="file" ref={resultGalleryInputRef} className="hidden" accept="image/*" multiple onChange={handleMultipleImageUpload} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                    {capturedImage && (
                        <div className="relative group">
                             <img src={capturedImage} className="w-full h-24 object-cover rounded-xl border-2 border-cyan-600 shadow-md" alt="Captured" />
                             <span className="absolute bottom-1 right-1 bg-cyan-600 text-white text-[8px] px-1 rounded">ORIGINAL</span>
                        </div>
                    )}
                    {landmarkImages.map((url, idx) => (
                        <div key={idx} className="relative group"><img src={url} className="w-full h-24 object-cover rounded-xl border border-black/10 shadow-sm" alt={`Web ${idx}`} /></div>
                    ))}
                </div>
              </div>
              <p className="text-[16px] leading-relaxed font-bold text-justify opacity-90">{result.about}</p>
              <div className="mt-8 flex flex-col gap-4">
                {!hasExpandedHistory && (
                  <button onClick={() => performAnalysis("", undefined, true)} className="bg-[#3e2723]/10 text-[#3e2723] py-4 rounded-2xl font-black"><i className="fas fa-info-circle mr-2"></i>{t.expandHistory}</button>
                )}
                {hasExpandedHistory && (
                   <button onClick={() => performAnalysis("", undefined, false, true)} className="bg-emerald-800 text-white py-4 rounded-2xl font-black shadow-md"><i className="fas fa-th-list mr-2"></i>{t.expandNearby}</button>
                )}
              </div>
              {result.nearbyLandmarks && result.nearbyLandmarks.length > 0 && (
                <div className="mt-12 pt-10 border-t-2 border-[#3e2723]/10">
                  <h4 className="text-2xl font-black mb-6 text-[#3e2723] flex items-center gap-3">
                    <i className="fas fa-map-marker-alt text-emerald-600"></i> {t.nearbyTitlePrefix} {result.title}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {result.nearbyLandmarks.map((item, i) => (
                      <div key={i} className="bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 p-5 rounded-2xl border border-emerald-500/20 transition-all hover:bg-white/60">
                        <div className="flex justify-between items-center font-black text-lg text-[#1b1b1b]">
                          <span>{item.name}</span>
                          <div className="flex flex-col items-end">
                            <span className="text-cyan-800 text-[10px] bg-cyan-100 px-2 py-0.5 rounded-full border border-cyan-200">{item.distance}</span>
                            <span className="text-emerald-800 text-[10px] mt-1 font-bold">{item.direction}</span>
                          </div>
                        </div>
                        <p className="text-[16px] font-medium opacity-80 mt-2 text-[#444]">{item.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-10 flex flex-wrap justify-center gap-6 border-t-2 border-[#3e2723]/10 pt-8">
                <div className="flex flex-col items-center gap-2">
                  <button onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(result.title)}`, '_blank')}
                    className="w-16 h-16 rounded-full bg-cyan-700 text-white flex items-center justify-center shadow-lg hover:bg-cyan-800 transition-colors" title={t.directions}>
                    <i className="fas fa-directions text-2xl"></i>
                  </button>
                  <span className="text-sm font-bold text-[#3e2723]">{t.directions}</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <button onClick={shareAsHTML} className="w-16 h-16 rounded-full bg-emerald-700 text-white flex items-center justify-center shadow-lg hover:bg-emerald-800 transition-colors" title={t.share}>
                    <i className="fas fa-share-nodes text-2xl"></i>
                  </button>
                  <span className="text-sm font-bold text-[#3e2723]">{t.share}</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <button onClick={copyToClipboard} className="w-16 h-16 rounded-full bg-yellow-400 text-black flex items-center justify-center shadow-lg hover:bg-yellow-500 transition-colors" title={t.copy}>
                    <i className={`fas ${copyStatus ? 'fa-check' : 'fa-copy'} text-2xl`}></i>
                  </button>
                  <span className="text-sm font-bold text-[#3e2723]">{copyStatus ? t.copied : t.copy}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-center"><button onClick={startCamera} className="bg-gradient-to-r from-cyan-600 to-emerald-600 text-white px-8 py-4 rounded-full font-black text-lg shadow-xl">{t.newDiscovery}</button></div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
