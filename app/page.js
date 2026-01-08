"use client";

import { useState, useRef } from "react";

export default function Home() {
  const [prompts, setPrompts] = useState("");
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [provider, setProvider] = useState("1.5-Fast");
  const [batchSize, setBatchSize] = useState(50);
  const abortControllerRef = useRef(null);
  const shouldStopRef = useRef(false);

  const aspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4"];
  const providers = ["1.5-Fast", "1.5-Pro"];

  // Format number with leading zeros (001, 002, etc.)
  const formatNumber = (num, totalDigits = 3) => {
    return String(num).padStart(totalDigits, "0");
  };

  // Generate a single image
  const generateSingleImage = async (prompt, index, signal) => {
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
          id: Date.now() + index,
          index: index + 1,
          success: true,
        };
      }
      return { prompt, index: index + 1, success: false };
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error(`Error generating image for prompt: ${prompt}`, error);
      }
      return { prompt, index: index + 1, success: false };
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
    setImages([]);
    setProgress({ current: 0, total: promptList.length });
    abortControllerRef.current = new AbortController();
    shouldStopRef.current = false;

    const allResults = [];

    // Process in batches of batchSize
    for (let batchStart = 0; batchStart < promptList.length; batchStart += batchSize) {
      if (shouldStopRef.current) break;

      const batchEnd = Math.min(batchStart + batchSize, promptList.length);
      const batchPrompts = promptList.slice(batchStart, batchEnd);

      // Create promises for all prompts in this batch (parallel)
      const batchPromises = batchPrompts.map((prompt, batchIndex) => {
        const globalIndex = batchStart + batchIndex;
        return generateSingleImage(prompt, globalIndex, abortControllerRef.current?.signal);
      });

      // Wait for all promises in this batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Filter successful results and add to allResults
      const successfulResults = batchResults.filter((r) => r.success);
      allResults.push(...successfulResults);

      // Update progress and images
      setProgress({ current: batchEnd, total: promptList.length });
      setImages([...allResults]);
    }

    setLoading(false);
  };

  const stopGeneration = () => {
    shouldStopRef.current = true;
    abortControllerRef.current?.abort();
    setLoading(false);
  };

  // Download via proxy to avoid CORS
  const downloadImage = async (url, index) => {
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
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const downloadAllAsZip = async () => {
    if (images.length === 0) return;

    setDownloading(true);
    try {
      const JSZip = (await import("jszip")).default;
      const { saveAs } = await import("file-saver");

      const zip = new JSZip();
      const folder = zip.folder("generated_images");

      // Download images in parallel batches to speed up
      const downloadBatchSize = 10;
      for (let i = 0; i < images.length; i += downloadBatchSize) {
        const batch = images.slice(i, i + downloadBatchSize);
        const batchPromises = batch.map(async (img, batchIndex) => {
          const proxyUrl = `/api/download?url=${encodeURIComponent(img.url)}`;
          const response = await fetch(proxyUrl);
          const blob = await response.blob();
          return { index: i + batchIndex + 1, blob };
        });

        const results = await Promise.all(batchPromises);
        results.forEach(({ index, blob }) => {
          folder.file(`image${formatNumber(index)}.png`, blob);
        });
      }

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, "generated_images.zip");
    } catch (error) {
      console.error("Zip download failed:", error);
    }
    setDownloading(false);
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
                {[10, 25, 50, 100].map((size) => (
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
                  ({images.length} images)
                </span>
              </h2>
              {images.length > 0 && (
                <button
                  onClick={downloadAllAsZip}
                  disabled={downloading}
                  className="px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-slate-600 disabled:to-slate-600 text-white font-semibold rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-cyan-500/25 flex items-center gap-2"
                >
                  {downloading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Creating ZIP...
                    </>
                  ) : (
                    <>
                      📦 Download All as ZIP
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Scrollable Gallery Container */}
            <div className="max-h-[600px] overflow-y-auto pr-2 gallery-scroll">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {images.map((image) => (
                  <div
                    key={image.id}
                    className="relative overflow-hidden rounded-2xl bg-white/5 border border-white/10 transition-all hover:border-purple-500/50 hover:shadow-xl hover:shadow-purple-500/10"
                  >
                    {/* Image Number Badge */}
                    <div className="absolute top-3 left-3 z-10 px-3 py-1 bg-black/60 backdrop-blur-sm rounded-full text-sm font-medium text-white">
                      #{formatNumber(image.index)}
                    </div>

                    {/* Image */}
                    <div className="aspect-video relative overflow-hidden">
                      <img
                        src={image.url}
                        alt={image.prompt}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>

                    {/* Info & Download Section */}
                    <div className="p-4">
                      <p className="text-sm text-slate-400 line-clamp-2 mb-3">
                        {image.prompt}
                      </p>
                      {/* Always Visible Download Button */}
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
