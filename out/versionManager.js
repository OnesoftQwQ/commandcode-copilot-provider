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
exports.VersionManager = void 0;
const vscode = __importStar(require("vscode"));
class VersionManager {
    static _version = null;
    /**
     * Get the current extension version
     */
    static getVersion() {
        if (this._version === null) {
            const extension = vscode.extensions.getExtension("OnesoftQwQ.commandcode-copilot-provider");
            this._version = extension?.packageJSON?.version ?? "unknown";
        }
        return this._version;
    }
    /**
     * Build a descriptive User-Agent to help quantify API usage
     */
    static getUserAgent() {
        const vscodeVersion = vscode.version;
        return `commandcode-copilot/${this.getVersion()} VSCode/${vscodeVersion}`;
    }
    /**
     * Get the current extension information
     */
    static getClientInfo() {
        return {
            name: "commandcode-copilot",
            version: this.getVersion(),
            author: "my-company",
        };
    }
}
exports.VersionManager = VersionManager;
//# sourceMappingURL=versionManager.js.map