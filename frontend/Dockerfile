# Stage 1: Build React assets
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve with lightweight Nginx server
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose standard web port
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
