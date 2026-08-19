# Stage 1: build the static production bundle. VITE_API_BASE_URL is baked
# in at BUILD time, not read at container runtime — Vite embeds env vars
# directly into the compiled JS during `vite build`, unlike the backend's
# runtime env vars (DB_HOST, JWT_SECRET) which are read fresh on every
# container start. That's why this is a --build-arg here, not a Cloud Run
# env var on the deployed service.
FROM node:20-slim AS build
WORKDIR /app
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# Stage 2: serve the built static files. nginx, not a Node server —
# purpose-built for exactly this (static file serving, gzip, caching
# headers), and the final image only carries the compiled output, not the
# Node toolchain or any source file.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
