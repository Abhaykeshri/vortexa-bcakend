module.exports = {
  apps: [
    {
      name: 'vortexa-backend',
      script: 'dist/apps/api/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '350M',
      watch: false,
      env: { NODE_ENV: 'production' },
    },
  ],
};
