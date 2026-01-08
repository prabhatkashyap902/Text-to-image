import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get("url");

    if (!imageUrl) {
      return NextResponse.json(
        { error: "Missing image URL" },
        { status: 400 }
      );
    }

    // Fetch the image from the external server
    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch image" },
        { status: response.status }
      );
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();

    // Return the image with proper headers
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": blob.type || "image/png",
        "Content-Disposition": "attachment",
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error) {
    console.error("Download proxy error:", error);
    return NextResponse.json(
      { error: "Download failed" },
      { status: 500 }
    );
  }
}
