"use client";

import { useState, useRef } from "react";

export default function Home() {
  const [prompts, setPrompts] = useState("");
  const [images, setImages] = useState([]); // Array of {prompt, url, id, index, loading, success, failed}
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [provider, setProvider] = useState("1.5-Fast");
  const [batchSize, setBatchSize] = useState(50);
  const abortControllerRef = useRef(null);
  const shouldStopRef = useRef(false);
  const imagesRef = useRef([]); // Ref to track images during generation

  const aspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4"];
  const providers = ["1.5-Fast", "1.5-Pro"];

  // Format number with leading zeros (001, 002, etc.)
  const formatNumber = (num, totalDigits = 3) => {
    return String(num).padStart(totalDigits, "0");
  };

  // Check if all images are loaded (no loading state and at least one image)
  const allImagesLoaded = images.length > 0 && images.every(img => !img.loading);
  
  // Count of successfully loaded images
  const loadedImagesCount = images.filter(img => !img.loading && img.success).length;

  // Generate a single image and update state
  const generateSingleImage = async (prompt, index, id, signal) => {
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          aspect_ratio: aspectRatio,
          provider,
          n: 1,
        }),
        signal,
      });

      const data = await response.json();

      if (data.success && data.image_urls?.length > 0) {
        return {
          prompt: data.prompt,
          url: data.image_urls[0],
          id: id,
          index: index + 1,
          loading: false,
          success: true,
          failed: false,
        };
      }
      return { prompt, index: index + 1, id, loading: false, success: false, failed: true };
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error(`Error generating image for prompt: ${prompt}`, error);
      }
      return { prompt, index: index + 1, id, loading: false, success: false, failed: true };
    }
  };

  const generateImages = async () => {
    const promptList = prompts
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (promptList.length === 0) {
      alert("Please enter at least one prompt");
      return;
    }

    setLoading(true);
    setProgress({ current: 0, total: promptList.length });
    abortControllerRef.current = new AbortController();
    shouldStopRef.current = false;

    // Initialize all image slots with loading state
    const initialImages = promptList.map((prompt, index) => ({
      prompt,
      url: null,
      id: crypto.randomUUID(),
      index: index + 1,
      loading: true,
      success: false,
      failed: false,
    }));
    
    setImages(initialImages);
    imagesRef.current = [...initialImages];

    // Counter for completed images
    let completedCount = 0;

    // Process in batches of batchSize
    for (let batchStart = 0; batchStart < promptList.length; batchStart += batchSize) {
      if (shouldStopRef.current) break;

      const batchEnd = Math.min(batchStart + batchSize, promptList.length);
      const batchPrompts = promptList.slice(batchStart, batchEnd);

      // Create promises for all prompts in this batch (parallel)
      // Each promise updates progress immediately when it completes
      const batchPromises = batchPrompts.map(async (prompt, batchIndex) => {
        const globalIndex = batchStart + batchIndex;
        // Use the ID from the initialized image object to ensure stability
        const currentId = imagesRef.current[globalIndex].id;
        const result = await generateSingleImage(prompt, globalIndex, currentId, abortControllerRef.current?.signal);
        
        // Update immediately when this individual image completes
        const idx = result.index - 1;
        imagesRef.current[idx] = result;
        completedCount++;
        
        // Update progress and UI in real-time for each image!
        setProgress({ current: completedCount, total: promptList.length });
        setImages([...imagesRef.current]);
        
        return result;
      });

      // Wait for all promises in this batch to complete
      await Promise.all(batchPromises);
    }

    setLoading(false);
  };

  const stopGeneration = () => {
    shouldStopRef.current = true;
    abortControllerRef.current?.abort();
    setLoading(false);
  };

  // Download using cached image from browser - no API call needed!
  const downloadImage = async (url, index) => {
    try {
      // Try to fetch directly (should use browser cache)
      const response = await fetch(url, { mode: 'cors' });
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `image${formatNumber(index)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      // Fallback to proxy if CORS fails
      console.log("Direct fetch failed, using proxy...", error);
      try {
        const proxyUrl = `/api/download?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `image${formatNumber(index)}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch (proxyError) {
        console.error("Download failed:", proxyError);
      }
    }
  };

  const downloadAllAsZip = async () => {
    // Only download successful images with valid URLs
    const successfulImages = images.filter(img => img.success && img.url && img.url.startsWith('http'));
    if (successfulImages.length === 0) {
      alert("No images to download!");
      return;
    }

    setDownloading(true);
    setDownloadProgress({ current: 0, total: successfulImages.length });
    
    try {
      const JSZip = (await import("jszip")).default;
      const { saveAs } = await import("file-saver");

      const zip = new JSZip();
      const folder = zip.folder("generated_images");

      let downloadedCount = 0;
      let failedCount = 0;

      // Download images in parallel batches of 50
      const BATCH_SIZE = 50;
      for (let i = 0; i < successfulImages.length; i += BATCH_SIZE) {
        const batch = successfulImages.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (img) => {
          try {
            const proxyUrl = `/api/download?url=${encodeURIComponent(img.url)}`;
            const response = await fetch(proxyUrl);
            
            if (response.ok) {
              const blob = await response.blob();
              if (blob.size > 0) {
                folder.file(`image${formatNumber(img.index)}.png`, blob);
                downloadedCount++;
              } else {
                console.log(`Image ${img.index} - empty blob, retrying...`);
                // Retry once if empty blob
                const retryResponse = await fetch(proxyUrl);
                if (retryResponse.ok) {
                  const retryBlob = await retryResponse.blob();
                  if (retryBlob.size > 0) {
                    folder.file(`image${formatNumber(img.index)}.png`, retryBlob);
                    downloadedCount++;
                  } else {
                    console.log(`Image ${img.index} - still empty after retry`);
                    failedCount++;
                  }
                } else {
                  failedCount++;
                }
              }
            } else {
              console.log(`Image ${img.index} - status ${response.status}, retrying...`);
              // Retry once on failure
              const retryResponse = await fetch(proxyUrl);
              if (retryResponse.ok) {
                const blob = await retryResponse.blob();
                if (blob.size > 0) {
                  folder.file(`image${formatNumber(img.index)}.png`, blob);
                  downloadedCount++;
                } else {
                  failedCount++;
                }
              } else {
                failedCount++;
              }
            }
          } catch (error) {
            console.log(`Image ${img.index} - error: ${error.message}, retrying...`);
            // Retry once on error
            try {
              const proxyUrl = `/api/download?url=${encodeURIComponent(img.url)}`;
              const retryResponse = await fetch(proxyUrl);
              if (retryResponse.ok) {
                const blob = await retryResponse.blob();
                if (blob.size > 0) {
                  folder.file(`image${formatNumber(img.index)}.png`, blob);
                  downloadedCount++;
                } else {
                  failedCount++;
                }
              } else {
                failedCount++;
              }
            } catch (retryError) {
              console.log(`Image ${img.index} - retry also failed: ${retryError.message}`);
              failedCount++;
            }
          }
          
          // Update progress safely
          setDownloadProgress(prev => ({ ...prev, current: downloadedCount + failedCount }));
        }));
      }

      // Always create ZIP with whatever we got
      setDownloadProgress({ current: successfulImages.length, total: successfulImages.length });
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `generated_images${failedCount > 0 ? `_${downloadedCount}_of_${successfulImages.length}` : ''}.zip`);
      
      if (failedCount > 0) {
        alert(`Downloaded ${downloadedCount} images. Skipped ${failedCount}.`);
      }
    } catch (error) {
      console.error("Zip download failed:", error);
      alert("ZIP download failed: " + error.message);
    }
    setDownloading(false);
    setDownloadProgress({ current: 0, total: 0 });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-4">
            AI Image Generator
          </h1>
          <p className="text-slate-400 text-lg">
            Enter multiple prompts (one per line) to generate stunning AI images
          </p>
        </header>

        {/* Main Card */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl mb-8">
          {/* Settings Row */}
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex-1 min-w-[150px]">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Aspect Ratio
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              >
                {aspectRatios.map((ratio) => (
                  <option key={ratio} value={ratio} className="bg-slate-800">
                    {ratio}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Provider
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              >
                {providers.map((p) => (
                  <option key={p} value={p} className="bg-slate-800">
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Batch Size (Parallel)
              </label>
              <select
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              >
                {[10, 25, 50, 100, 200, 400].map((size) => (
                  <option key={size} value={size} className="bg-slate-800">
                    {size} at a time
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Prompt Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Prompts (one per line)
            </label>
            <textarea
              value={prompts}
              onChange={(e) => setPrompts(e.target.value)}
              placeholder="Enter your prompts here...&#10;Each line will generate a separate image&#10;Example: A majestic mountain at sunset"
              className="w-full h-48 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all resize-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-4">
            {!loading ? (
              <button
                onClick={generateImages}
                className="flex-1 min-w-[200px] px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-purple-500/25"
              >
                ✨ Generate Images
              </button>
            ) : (
              <button
                onClick={stopGeneration}
                className="flex-1 min-w-[200px] px-8 py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white font-semibold rounded-xl transition-all"
              >
                ⏹ Stop Generation
              </button>
            )}
          </div>

          {/* Progress Bar */}
          {loading && (
            <div className="mt-6">
              <div className="flex justify-between text-sm text-slate-400 mb-2">
                <span>Generating in batches of {batchSize}...</span>
                <span>
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Image Gallery */}
        {images.length > 0 && (
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl">
            {/* Gallery Header with Download All Button */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span>🖼️</span> Generated Images
                <span className="text-sm font-normal text-slate-400">
                  ({loadedImagesCount} / {images.length} ready)
                </span>
              </h2>
              <button
                onClick={downloadAllAsZip}
                disabled={downloading || !allImagesLoaded}
                className={`px-6 py-3 ${
                  allImagesLoaded 
                    ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-500/25' 
                    : 'bg-slate-600 cursor-not-allowed'
                } text-white font-semibold rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2 disabled:transform-none disabled:opacity-75`}
              >
                {downloading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {downloadProgress.current === downloadProgress.total 
                      ? 'Creating ZIP...' 
                      : `Downloading ${downloadProgress.current}/${downloadProgress.total}...`}
                  </>
                ) : !allImagesLoaded ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Waiting for all images...
                  </>
                ) : (
                  <>
                    📦 Download All as ZIP
                  </>
                )}
              </button>
            </div>

            {/* Scrollable Gallery Container */}
            <div className="max-h-[600px] overflow-y-auto pr-2 gallery-scroll">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {images.map((image) => (
                  <div
                    key={image.id}
                    className={`relative overflow-hidden rounded-2xl bg-white/5 border ${
                      image.failed 
                        ? 'border-red-500/50' 
                        : image.loading 
                          ? 'border-purple-500/30' 
                          : 'border-white/10 hover:border-purple-500/50'
                    } transition-all hover:shadow-xl hover:shadow-purple-500/10`}
                  >
                    {/* Image Number Badge */}
                    <div className={`absolute top-3 left-3 z-10 px-3 py-1 backdrop-blur-sm rounded-full text-sm font-medium text-white ${
                      image.loading ? 'bg-purple-500/60' : image.failed ? 'bg-red-500/60' : 'bg-black/60'
                    }`}>
                      #{formatNumber(image.index)}
                    </div>

                    {/* Image or Loading State */}
                    <div className="aspect-video relative overflow-hidden bg-slate-800/50">
                      {image.loading ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                          <div className="relative">
                            <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin"></div>
                          </div>
                          <span className="text-sm text-slate-400">Generating...</span>
                        </div>
                      ) : image.failed ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                          <span className="text-4xl">❌</span>
                          <span className="text-sm text-red-400">Generation failed</span>
                        </div>
                      ) : (
                        <img
                          src={image.url}
                          alt={image.prompt}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>

                    {/* Info & Download Section */}
                    <div className="p-4">
                      <p className="text-sm text-slate-400 line-clamp-2 mb-3">
                        {image.prompt}
                      </p>
                      {/* Download Button - only show when image is ready */}
                      {image.success && image.url ? (
                        <button
                          onClick={() => downloadImage(image.url, image.index)}
                          className="w-full px-4 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                            />
                          </svg>
                          Download image{formatNumber(image.index)}.png
                        </button>
                      ) : image.loading ? (
                        <div className="w-full px-4 py-2.5 bg-slate-600/50 text-slate-400 font-medium rounded-lg flex items-center justify-center gap-2">
                          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Loading...
                        </div>
                      ) : (
                        <div className="w-full px-4 py-2.5 bg-red-600/30 text-red-400 font-medium rounded-lg flex items-center justify-center gap-2">
                          ❌ Failed
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && images.length === 0 && (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🎨</div>
            <p className="text-slate-400 text-lg">
              Enter prompts above and click Generate to create amazing images
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
