const API_URL = 'https://yousmind.com/api/image-generator/generate';
const BEARER_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJib29raGVhZGVyMDA3QGdtYWlsLmNvbSIsImV4cCI6MTc2OTA3NTA3Mn0.fMcByDgqS4bM-VwWCVxNnZhxJ5KV7MTdFDMxB1KJ3oA';
const BASE_URL = 'https://yousmind.com';

export async function POST(request) {
  try {
    const { prompt, aspect_ratio = '16:9', provider = '1.5-Fast', n = 1 } = await request.json();

    if (!prompt || prompt.trim() === '') {
      return Response.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({
        prompt: prompt.trim(),
        aspect_ratio,
        provider,
        n,
      }),
      duplex: 'half',
      signal: AbortSignal.timeout(300000), // 300 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Status:', response.status);
      console.error('API Error Headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));
      console.error('API Error Body:', errorText);
      return Response.json({ 
        error: 'Failed to generate image',
        details: `Status: ${response.status}, Body: ${errorText.substring(0, 200)}`
      }, { status: response.status });
    }

    const data = await response.json();
    
    // Convert relative URLs to absolute URLs
    const imageUrls = data.image_urls.map(url => `${BASE_URL}${url}`);
    
    return Response.json({ 
      success: true, 
      image_urls: imageUrls,
      prompt: prompt.trim()
    });
  } catch (error) {
    console.error('Generation error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
