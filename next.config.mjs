/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev only: lets http://127.0.0.1:3141 load dev scripts. localhost can hit
  // HTTP 431 when cookies from other local projects pile up on that host.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
