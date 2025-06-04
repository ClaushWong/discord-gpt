/**
 * Segments a long text into chunks that fit within Discord's message limit
 * @param text The text to segment
 * @param maxLength The maximum length of each segment (default: 2000 for Discord)
 * @returns An array of text segments
 */
export function segmentText(text: string, maxLength: number = 2000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const segments: string[] = [];
  let currentSegment = '';
  
  // Split text into sentences using regex that handles multiple punctuation cases
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  for (const sentence of sentences) {
    // If adding this sentence would exceed maxLength chars, start a new segment
    if ((currentSegment + sentence).length > maxLength) {
      segments.push(currentSegment);
      currentSegment = sentence;
    } else {
      currentSegment += sentence;
    }
  }
  
  // Push the last segment if it has content
  if (currentSegment) {
    segments.push(currentSegment);
  }
  
  return segments;
} 