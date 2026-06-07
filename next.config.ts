import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Action request-body ceiling — this bounds POSTs to "use server"
      // functions ONLY. The file-upload Route Handlers (/api/analyze,
      // /api/extract-text) are not Server Actions, so this does NOT gate them;
      // they enforce the one per-file max-input contract (MAX_FILE_BYTES, 8 MB,
      // rejected at intake with HTTP 413) defined in
      // app/_lib/upload-constraints.ts. 10mb is held a step above that 8 MB
      // per-file limit so any future Server-Action upload path still clears one
      // max-size document plus multipart overhead. If you raise MAX_FILE_MB
      // past ~9, raise this too. (idea-36cc4b87)
      bodySizeLimit: "10mb"
    }
  }
};

export default nextConfig;
