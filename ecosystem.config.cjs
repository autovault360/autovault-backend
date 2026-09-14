module.exports = {
  apps: [
    {
      name: "autovault-api",
      script: "src/server.js",
      exec_mode: "cluster",
      instances: process.env.WEB_CONCURRENCY || "max",
      max_memory_restart: "700M",
      kill_timeout: 10000,
      listen_timeout: 15000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};