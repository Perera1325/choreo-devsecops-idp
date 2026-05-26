# Stage 1: Build TypeScript into JavaScript
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
RUN npm run build

# Stage 2: Minimal runtime image
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist

# Expose microservice port
EXPOSE 5000
ENV PORT=5000
ENV NODE_ENV=production

# Start backend server
CMD ["node", "dist/index.js"]
