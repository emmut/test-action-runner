# Realistic CI image build: pull base, install deps, build a Next.js app.
FROM node:22-slim
WORKDIR /app
RUN npx --yes create-next-app@latest . --yes --skip-install \
 && npm install --no-audit --no-fund \
 && npm run build
