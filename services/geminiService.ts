import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

export class GeminiService {
  private static getClient() {
    // We recreate the client right before each API call to ensure we always use the latest API key from the environment.
    // Must use named parameter as required by guidelines.
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  static async generateImage(prompt: string): Promise<string> {
    const ai = this.getClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }]
      }
    });

    return this.extractImageUrlFromResponse(response);
  }

  static async editImage(base64Image: string, prompt: string): Promise<string> {
    const ai = this.getClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image.split(',')[1] || base64Image,
              mimeType: 'image/png'
            }
          },
          { text: prompt }
        ]
      }
    });

    return this.extractImageUrlFromResponse(response);
  }

  /**
   * Surgical edit using an explicit mask image.
   * Both original image and mask image are sent to the model for maximum accuracy.
   */
  static async editWithMask(base64Image: string, base64Mask: string, prompt: string): Promise<string> {
    const ai = this.getClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image.split(',')[1] || base64Image,
              mimeType: 'image/png'
            }
          },
          {
            inlineData: {
              data: base64Mask.split(',')[1] || base64Mask,
              mimeType: 'image/png'
            }
          },
          { text: prompt }
        ]
      }
    });

    return this.extractImageUrlFromResponse(response);
  }

  /**
   * Free enhancement using the Flash model.
   * Does not require a paid API key selection.
   */
  static async upscaleFree(base64Image: string): Promise<string> {
    const ai = this.getClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image.split(',')[1] || base64Image,
              mimeType: 'image/png'
            }
          },
          { text: "Smartly upscale and enhance this image. Sharpen details, reduce noise, and improve clarity while keeping the original composition perfectly intact. Make it look like a high-resolution professional photo." }
        ]
      }
    });

    return this.extractImageUrlFromResponse(response);
  }

  static async upscaleTo4K(base64Image: string): Promise<string> {
    const ai = this.getClient();
    // Use gemini-3-pro-image-preview for high-quality 4K resolution requests
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image.split(',')[1] || base64Image,
              mimeType: 'image/png'
            }
          },
          { text: "Enhance this image to ultra-high definition details, maintaining the original composition and content perfectly, but at 4K resolution." }
        ]
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "4K"
        }
      }
    });

    return this.extractImageUrlFromResponse(response);
  }

  /**
   * Iterates through all response parts to find and extract the base64 image data.
   */
  private static extractImageUrlFromResponse(response: GenerateContentResponse): string {
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("No candidates found in response");
    }

    const parts = candidates[0].content.parts;
    for (const part of parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }

    throw new Error("No image data found in response");
  }
}