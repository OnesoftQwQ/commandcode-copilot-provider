/**
 * Stored image data for ask_image tool processing.
 */
export interface StoredImage {
    /** Raw image bytes */
    data: Uint8Array;
    /** MIME type (e.g. "image/png") */
    mimeType: string;
}

/**
 * Information about an intercepted ask_image / ask_with_multi_image tool call.
 */
export interface InterceptedToolCall {
    /** Tool call ID from the API */
    id: string;
    /** Tool name ("ask_image" or "ask_with_multi_image") */
    name: string;
    /** Parsed arguments */
    args: { imageIndex?: number; imageIndices?: number[]; query: string };
}

/**
 * The ask_image tool definition to inject into API requests.
 * Unlike a simple "describe_image" approach, this tool lets the model
 * ask a specific question about the image, which a vision-capable model
 * will answer. The model can ask about colors, text, UI elements, objects,
 * or any other visual detail it needs to know.
 */
export const ASK_IMAGE_TOOL_DEF = {
    type: "function" as const,
    function: {
        name: "ask_image",
        description: "READ THIS: The user sent an image. I am a text-only model and CANNOT see images. I MUST call this tool to learn about the image.\n\nSTRATEGY:\n1. First call ask_image with query='Describe this image briefly' to get a quick overview of what the image shows.\n2. Then, based on what the user needs, call ask_image again with specific questions (e.g., 'What color is the button?', 'What error message appears at the top?', 'Read all visible text', 'What UI elements are on the left panel?').\n\nThe vision model answers each query independently based on what it sees. I should ALWAYS call this tool when the user mentions an attached image or asks about image contents. Without calling this tool, I cannot know what the image contains.",
        parameters: {
            type: "object",
            properties: {
                imageIndex: {
                    type: "integer",
                    description: "The 0-based index of the image to ask about",
                },
                query: {
                    type: "string",
                    description: "The question to ask about the image.\n\nTIPS:\n- Start broad: 'Describe this image briefly' or 'What is shown in this screenshot?' to get context.\n- Then drill down: 'What color is the highlighted button?', 'What error message appears?', 'Read all visible text', 'What icons are in the toolbar?', 'Describe the layout of the dialog box'.\n- The vision model only sees the image, not your previous conversation — each call is independent, so include enough context in your query.\n\nExamples of good queries: 'Describe this image briefly', 'What error message appears?', 'List all visible UI elements with their labels', 'What is the main heading text?', 'Describe the chart or diagram shown'.",
                },
            },
            required: ["imageIndex", "query"],
        },
    },
};

export const ASK_IMAGE_TOOL_NAME = "ask_image";

/**
 * The ask_with_multi_image tool definition — same as ask_image but accepts
 * multiple image indices so the model can ask about differences, compare
 * screenshots, or analyze multiple images at once.
 */
export const ASK_WITH_MULTI_IMAGE_TOOL_DEF = {
    type: "function" as const,
    function: {
        name: "ask_with_multi_image",
        description: "Like ask_image, but accepts MULTIPLE images at once. Use this when you need to compare, contrast, or analyze multiple images together (e.g. 'what's different between these two screenshots?', 'which layout is better?', 'do these images show the same error?').\n\nIn your query, you can reference images by their attachment order (e.g., 'the first image shows A, the second image shows B — what's different?') for complex multi-step questions. The vision model sees all selected images simultaneously.\n\nIf you only need to ask about ONE image, use ask_image instead — it's simpler.",
        parameters: {
            type: "object",
            properties: {
                imageIndices: {
                    type: "array",
                    items: { type: "integer" },
                    description: "Array of 0-based image indices (attachment order) to analyze. At least 2 indices. Example: [0, 1] to compare the first and second attached image.",
                    minItems: 2,
                },
                query: {
                    type: "string",
                    description: "The question about the images. Since the vision model sees ALL selected images at once, ask about relationships, differences, or comparisons. Reference images by their attachment order for clarity, e.g.: 'The first image is a login page, the second image is a dashboard — is the color scheme consistent?' or 'Compare the error messages in the first and second image, are they the same error?'",
                },
            },
            required: ["imageIndices", "query"],
        },
    },
};

export const ASK_WITH_MULTI_IMAGE_TOOL_NAME = "ask_with_multi_image";

export const DEFAULT_VISION_PROMPT =
    "Analyze this image and answer the user's question based on visual content only. Be accurate and specific.";
