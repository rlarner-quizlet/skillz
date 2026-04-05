import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow remote dev origins (e.g. ngrok) to access Next.js dev assets/HMR.
  allowedDevOrigins: ["*.ngrok.app"],
};

export default nextConfig;
