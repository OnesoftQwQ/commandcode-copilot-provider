"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenizerManager = exports.TokenizerManager = void 0;
const vscode = __importStar(require("vscode"));
const tiktokenizer_1 = require("@microsoft/tiktokenizer");
const TOKENIZER_ENCODER = "o200k_base";
const CACHE_MAX_ENTRIES = 5000;
const CACHE_MAX_SIZE_BYTES = 5_000_000; // 5MB
// Simple LRU Cache for token counts
class TokenCache {
    cache = new Map();
    maxSize = CACHE_MAX_ENTRIES;
    maxSizeBytes = CACHE_MAX_SIZE_BYTES;
    currentSize = 0;
    get(key) {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }
    set(key, value) {
        const entrySize = key.length * 2 + 8;
        while ((this.cache.size >= this.maxSize || this.currentSize + entrySize > this.maxSizeBytes) &&
            this.cache.size > 0) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey === undefined)
                break;
            const evictedSize = firstKey.length * 2 + 8;
            this.cache.delete(firstKey);
            this.currentSize -= evictedSize;
        }
        this.cache.set(key, value);
        this.currentSize += entrySize;
    }
}
// Tokenizer singleton
class TokenizerManager {
    static instance = null;
    tokenizer = null;
    cache = new TokenCache();
    tokenizerReady = null;
    static extensionPath = null;
    constructor() { }
    /**
     * Initialize the tokenizer with extension path (call from activate)
     */
    static initialize(extensionPath) {
        TokenizerManager.extensionPath = extensionPath;
        return TokenizerManager.getInstance();
    }
    static setExtensionPath(path) {
        TokenizerManager.extensionPath = path;
    }
    static getInstance() {
        if (!TokenizerManager.instance) {
            TokenizerManager.instance = new TokenizerManager();
        }
        return TokenizerManager.instance;
    }
    async getTokenizer() {
        if (this.tokenizer) {
            return this.tokenizer;
        }
        if (!this.tokenizerReady) {
            this.tokenizerReady = (async () => {
                if (!TokenizerManager.extensionPath) {
                    throw new Error("Extension path not initialized. Call TokenizerManager.setExtensionPath() first.");
                }
                const basePath = vscode.Uri.file(TokenizerManager.extensionPath);
                const tokenizerPath = vscode.Uri.joinPath(basePath, "assets", "model", `${TOKENIZER_ENCODER}.tiktoken`).fsPath;
                return (0, tiktokenizer_1.createTokenizer)(tokenizerPath, (0, tiktokenizer_1.getSpecialTokensByEncoder)(TOKENIZER_ENCODER), (0, tiktokenizer_1.getRegexByEncoder)(TOKENIZER_ENCODER), 64000);
            })();
        }
        this.tokenizer = await this.tokenizerReady;
        return this.tokenizer;
    }
    async countTokens(text) {
        if (!text)
            return 0;
        const cached = this.cache.get(text);
        if (cached !== undefined) {
            return cached;
        }
        const tokenizer = await this.getTokenizer();
        const tokens = tokenizer.encode(text);
        const count = tokens.length;
        this.cache.set(text, count);
        return count;
    }
}
exports.TokenizerManager = TokenizerManager;
// Export singleton instance
exports.tokenizerManager = TokenizerManager.getInstance();
//# sourceMappingURL=tokenizerManager.js.map